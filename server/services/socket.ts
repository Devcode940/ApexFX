import crypto from 'node:crypto';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Express } from 'express';
import proxyaddr from 'proxy-addr';
import { WebSocket, WebSocketServer } from 'ws';
import { sanitizeClientIp, timingSafeCompare, isAllowedBrowserOrigin } from '../lib/security';
import { requireAccount, AccessError } from '../lib/auth';
import { marketRates, marketSource } from './market';

const TOKEN_TTL = 120_000;
export class WsTokenStore {
  private tokens = new Map<string, { expires: number; ip: string; origin: string | null }>();
  issue(ip: string, origin: string | null, now = Date.now()): string {
    for (const [id, entry] of this.tokens) if (entry.expires <= now) this.tokens.delete(id);
    if (this.tokens.size >= 1000) throw new Error('Token capacity reached');
    const token = crypto.randomBytes(32).toString('hex');
    this.tokens.set(token, { ip, origin, expires: now + TOKEN_TTL });
    return token;
  }
  consume(token: string | null, ip: string, origin: string | null, now = Date.now()): boolean {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
    const entry = this.tokens.get(token);
    if (!entry || entry.expires <= now || entry.ip !== ip || entry.origin !== origin) return false;
    this.tokens.delete(token);
    return true;
  }
  clear() { this.tokens.clear(); }
}
export const websocketEnabled = () => !process.env.VERCEL && process.env.WS_DISABLED !== 'true';
export function attachReadOnlySockets(server: Server, app: Express) {
  const tokens = new WsTokenStore();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const byIp = new Map<string, number>();
  const clients = new WeakMap<WebSocket, string>();
  const payload = (type: string) => JSON.stringify({ type, rates: marketRates(), source: marketSource(), sentAt: Date.now() });
  const send = (ws: WebSocket, data: string) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 256_000) { ws.close(1013, 'Slow client'); return; }
    try { ws.send(data); } catch { ws.terminate(); }
  };
  app.post('/api/ws/token', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!websocketEnabled()) return res.status(404).json({ error: 'WebSocket transport is not enabled for this deployment; use polling.' });
    try {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
      if (origin && !isAllowedBrowserOrigin(origin, req.headers.host)) return res.status(403).json({ error: 'Origin not allowed' });
      const supplied = typeof req.headers['x-ws-secret'] === 'string' ? req.headers['x-ws-secret'] : undefined;
      const service = !!process.env.WS_SHARED_SECRET && timingSafeCompare(supplied, process.env.WS_SHARED_SECRET);
      if (!service && (process.env.WS_SHARED_SECRET || process.env.WS_REQUIRE_AUTH === 'true' || req.headers.authorization)) await requireAccount(req);
      else if (!service && !origin) return res.status(403).json({ error: 'Browser Origin or verified account required. Use POST from the app.' });
      const token = tokens.issue(sanitizeClientIp(req), origin);
      res.json({ token, expiresIn: TOKEN_TTL / 1000 });
    } catch (error) {
      if (error instanceof AccessError) return res.status(error.status).json({ code: error.code, error: error.message });
      res.status(503).json({ error: 'Token service busy; use polling.' });
    }
  });
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try { url = new URL(req.url || '/', 'http://socket.local'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/ws') {
      if (process.env.NODE_ENV === 'production') socket.destroy(); // dev Vite owns its separate HMR path
      return;
    }
    const deny = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (!websocketEnabled()) { deny(404); return; }
    // Use Express's compiled trust function for the UPGRADE too, rather than trusting raw XFF.
    const ip = sanitizeClientIp({ ip: proxyaddr(req, app.get('trust proxy fn')), socket: req.socket });
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    if (origin && !isAllowedBrowserOrigin(origin, req.headers.host)) { deny(403); return; }
    if (wss.clients.size >= 200 || (byIp.get(ip) ?? 0) >= 5) { deny(429); return; }
    if (!tokens.consume(url.searchParams.get('token'), ip, origin)) { deny(401); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      byIp.set(ip, (byIp.get(ip) ?? 0) + 1); clients.set(ws, ip);
      wss.emit('connection', ws, req);
    });
  };
  server.on('upgrade', upgrade);
  wss.on('connection', ws => {
    let alive = true;
    const openedAt = Date.now();
    const heartbeat = setInterval(() => {
      if (!alive || ws.bufferedAmount > 256_000) { ws.terminate(); return; }
      if (Date.now() - openedAt > 15 * 60_000) { ws.close(1012, 'Reconnect required'); return; }
      alive = false; ws.ping();
    }, 30_000);
    heartbeat.unref();
    ws.on('pong', () => { alive = true; });
    ws.on('message', () => ws.close(1008, 'Read-only feed'));
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      clearInterval(heartbeat);
      const ip = clients.get(ws);
      if (ip) { const remaining = (byIp.get(ip) ?? 1) - 1; if (remaining) byIp.set(ip, remaining); else byIp.delete(ip); }
    });
    send(ws, payload('INITIAL_RATES'));
  });
  return {
    broadcast: () => { const data = payload('PRICE_UPDATE'); wss.clients.forEach(ws => send(ws, data)); },
    count: () => wss.clients.size,
    stop: () => { tokens.clear(); server.off('upgrade', upgrade); wss.clients.forEach(ws => ws.terminate()); wss.close(); },
  };
}
