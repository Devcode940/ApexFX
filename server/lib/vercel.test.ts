import { describe, it, expect, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { normalizeVercelUrl } from './vercel';

/**
 * The Vercel entry point is the one part of this repo that cannot be exercised from the sandbox
 * (no deploy, no platform), so the risky piece — what `req.url` looks like inside the function — is
 * handled by normalising every plausible shape and proving both the normaliser and the app behind it.
 */
describe('normalizeVercelUrl', () => {
  it('passes an already-correct api path through', () => {
    expect(normalizeVercelUrl({ url: '/api/market/prices' })).toBe('/api/market/prices');
    expect(normalizeVercelUrl({ url: '/api/health?x=1' })).toBe('/api/health?x=1');
  });

  it('maps the rewrite destination back to /api', () => {
    expect(normalizeVercelUrl({ url: '/api/index' })).toBe('/api');
    expect(normalizeVercelUrl({ url: '/api/index.ts' })).toBe('/api');
    expect(normalizeVercelUrl({ url: '/index' })).toBe('/api');
  });

  it('re-adds the /api prefix when the platform strips the mount', () => {
    expect(normalizeVercelUrl({ url: '/market/prices' })).toBe('/api/market/prices');
    expect(normalizeVercelUrl({ url: '/' })).toBe('/api');
  });

  it('prefers x-invoke-path when it carries a real api path', () => {
    expect(
      normalizeVercelUrl({ url: '/api/index', headers: { 'x-invoke-path': '/api/market/history?symbol=EURUSD&timeframe=1H' } })
    ).toBe('/api/market/history?symbol=EURUSD&timeframe=1H');
  });

  it('keeps /healthz reachable at the bare path', () => {
    expect(normalizeVercelUrl({ url: '/healthz' })).toBe('/healthz');
  });
});

describe('vercel handler against the real express app', () => {
  let srv: http.Server | null = null;

  it('answers /api/health through all three url shapes', async () => {
    const prevVercel = process.env.VERCEL;
    process.env.VERCEL = '1'; // server.ts skips startServer()/listen under Vercel
    const { default: handler } = await import('../../api/index');
    srv = http.createServer((req, res) => handler(req as never, res as never));
    srv.listen(0, '127.0.0.1');
    await new Promise((r) => srv!.once('listening', r as () => void));
    const port = (srv.address() as AddressInfo).port;

    // shape 1: original path preserved by the rewrite
    const a = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(a.status).toBe(200);
    expect((await a.json()).status).toMatch(/ok|degraded/);

    // shape 2: only the destination arrives, original path in x-invoke-path
    const b = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'x-invoke-path': '/api/health' } });
    expect(b.status).toBe(200);

    // shape 3: an unknown api path must still be JSON, never index.html
    const c = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
    expect(c.status).toBe(404);
    expect(c.headers.get('content-type')).toContain('application/json');

    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  });

  afterAll(() => {
    srv?.close();
  });
});
