/**
 * Optional upstream Tiingo FX WebSocket (firehose at wss://api.tiingo.com/fx).
 *
 * Off by default: enable with TIINGO_WS_ENABLED=true once the account's
 * redistribution tier is confirmed to include websocket access. Frames are
 * parsed defensively — unknown or malformed payloads are ignored, never turned
 * into quotes. The REST /fx/top poller stays the source of truth for freshness;
 * this stream only shortens latency and reduces REST credits while healthy.
 * Never enabled on Vercel (no persistent processes) or in offline mode.
 */
import { WebSocket } from 'ws';
import { applyMarketQuote, serverWatchlist } from './market';
import { isExecutableQuote, providerTimestamp, type MarketQuote } from '../../shared/market';
import { TIINGO_SYMBOLS, tiingoConfigured } from './tiingo';
import { warn } from '../lib/logger';

export type TiingoStreamEvent =
  | { kind: 'quote'; symbol: string; bid: number; ask: number; mid: number; asOf: number | null }
  | { kind: 'heartbeat' };

const tickerToSymbol = new Map<string, string>(Object.entries(TIINGO_SYMBOLS).map(([symbol, ticker]) => [ticker, symbol]));

/** Pure frame interpreter: a Q top-of-book array is the only quote-bearing payload we accept. */
export function interpretTiingoMessage(raw: string): TiingoStreamEvent | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const message = parsed as { service?: unknown; messageType?: unknown; data?: unknown };
  if (message.service !== 'fx') return null;
  if (message.messageType === 'H') return { kind: 'heartbeat' };
  if (message.messageType !== 'A') return null;
  const events = Array.isArray(message.data) ? (Array.isArray(message.data[0]) ? message.data : [message.data]) : [];
  for (const event of events as unknown[][]) {
    if (!Array.isArray(event) || event[0] !== 'Q' || event.length < 5) continue;
    const [, ticker, timestamp, bidSize, bidPrice, , , askPrice] = event as unknown[]; // Q: [tag,ticker,ts,bidSize,bid,mid,askSize,ask]
    const symbol = typeof ticker === 'string' ? tickerToSymbol.get(ticker.toLowerCase()) : undefined;
    if (!symbol) continue;
    const bid = Number(bidPrice); const ask = Number(askPrice);
    // Same contract as the REST parser: midpoint is derived, never trusted from the payload.
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || bid > ask) continue;
    if (!Number.isFinite(Number(bidSize))) continue; // not a top-of-book shape we recognize
    const asOf = providerTimestamp(timestamp);
    if (!asOf) continue;
    return { kind: 'quote', symbol, bid, ask, mid: bid + (ask - bid) / 2, asOf };
  }
  return null;
}

export function tiingoStreamEnabled(): boolean {
  return process.env.TIINGO_WS_ENABLED === 'true' && tiingoConfigured() && !process.env.VERCEL && process.env.MARKET_DATA_MODE !== 'offline';
}

let streamOpen = false;
let lastFrameAt = 0;
/** The REST poller may skip its Tiingo fetch only while the stream is demonstrably live. */
export function tiingoStreamHealthy(): boolean {
  return streamOpen && Date.now() - lastFrameAt < 45_000;
}
export const __tiingoStreamTestHooks = {
  reset() { streamOpen = false; lastFrameAt = 0; },
  noteFrame(at: number) { lastFrameAt = at; },
};

export function startTiingoStream(broadcast: () => void): () => void {
  if (!tiingoStreamEnabled()) return () => {};
  let running = true;
  let ws: WebSocket | null = null;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let guard: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  const threshold = Math.min(5, Math.max(0, Math.round(Number(process.env.TIINGO_WS_THRESHOLD) || 5)));
  // Coalesce frame-driven broadcasts so a busy firehose cannot thrash every SSE/WS client.
  const scheduleBroadcast = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; if (running) broadcast(); }, 500);
  };
  const applyQuote = (event: Extract<TiingoStreamEvent, { kind: 'quote' }>) => {
    const item = serverWatchlist.find(entry => entry.symbol === event.symbol);
    if (!item) return;
    const receivedAt = Date.now();
    const quote: MarketQuote = { ...item,
      bid: event.bid, ask: event.ask, price: event.mid,
      provider: 'tiingo', providerSymbol: TIINGO_SYMBOLS[item.symbol], instrumentKind: 'spot', priceBasis: 'mid',
      dayStatsAvailable: false, asOf: event.asOf, receivedAt };
    if (applyMarketQuote(item, quote)) { streamOpen = true; lastFrameAt = receivedAt; scheduleBroadcast(); }
  };
  const connect = () => {
    if (!running) return;
    try {
      const socket = new WebSocket('wss://api.tiingo.com/fx', { handshakeTimeout: 8000, maxPayload: 64_000 });
      ws = socket;
      socket.on('open', () => {
        socket.send(JSON.stringify({
          action: 'subscribe',
          eventData: { eventName: 'subscribe', authToken: process.env.TIINGO_API_KEY, service: 'fx', symbols: Object.values(TIINGO_SYMBOLS), threshold },
        }));
        // No subscribe acknowledgement within 12 s => entitlement/protocol mismatch; back off.
        guard = setTimeout(() => { if (!streamOpen) { warn('[TiingoStream] No frames after subscribe; closing'); socket.close(); } }, 12_000);
      });
      socket.on('message', data => {
        if (!running) return;
        const event = interpretTiingoMessage(String(data));
        if (!event) return;
        if (event.kind === 'heartbeat') { streamOpen = true; lastFrameAt = Date.now(); return; }
        applyQuote(event);
      });
      socket.on('error', () => { /* close schedules reconnect */ });
      socket.on('close', () => {
        clearTimeout(guard); guard = undefined;
        streamOpen = false;
        if (!running) return;
        const delay = Math.min(60_000, 5_000 * 2 ** Math.min(attempts++, 4));
        // bounded exponential backoff; 5 s -> 60 s ceiling
        reconnect = setTimeout(connect, delay);
      });
    } catch (error) {
      warn('[TiingoStream] Could not open socket:', error);
      if (running) reconnect = setTimeout(connect, 60_000);
    }
  };
  connect();
  return () => {
    running = false;
    clearTimeout(reconnect); clearTimeout(guard);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    streamOpen = false;
    ws?.terminate();
    ws = null;
  };
}

/** Whether the stream currently makes the REST Tiingo poll redundant (used by background tick). */
export function canSkipTiingoRest(): boolean {
  return tiingoStreamEnabled() && tiingoStreamHealthy()
    && serverWatchlist.every(q => (q.provider === 'tiingo' && isExecutableQuote(q)) || false);
}
