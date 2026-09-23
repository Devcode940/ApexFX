import { tiingoConfigured } from './tiingo';
import { reserveMarketBudget, type BudgetLease } from '../lib/paidBudget';
import { WebSocket } from 'ws';
import { applyMarketQuote, fetchRealLatestPrices, fetchYahooPricesFor, getPollMs, getQuoteSyncMs, getYahooFailureStreak, serverWatchlist, TD_SYMBOLS, allowMarketFallbacks } from './market';
import { isExecutableQuote, providerTimestamp } from '../../shared/market';
import { warn } from '../lib/logger';

/** Explicit process lifecycle, never started by importing the Express/Vercel app. */
export function startMarketServices(broadcast: () => void): () => void {
  if (process.env.VERCEL || process.env.MARKET_DATA_MODE === 'offline') return () => {};
  let running = true;
  let stream: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let lastRestSync = 0;
  let connecting = false;
  const connect = async () => {
    if (!running || stream || connecting || tiingoConfigured() || !allowMarketFallbacks() || !process.env.TWELVEDATA_API_KEY) return;
    connecting = true;
    let lease: BudgetLease | undefined;
    try {
    lease = await reserveMarketBudget('twelvedata', Object.keys(TD_SYMBOLS).length);
    if (!running) return;
    const ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${process.env.TWELVEDATA_API_KEY}`, { handshakeTimeout: 8000, maxPayload: 64_000 });
    stream = ws;
    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: Object.values(TD_SYMBOLS).join(',') } }));
      heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'heartbeat' })); }, 10_000);
    });
    ws.on('message', data => {
      if (!running) return;
      try {
        const event = JSON.parse(data.toString());
        if (event.event !== 'price') return;
        const symbol = Object.keys(TD_SYMBOLS).find(s => TD_SYMBOLS[s] === event.symbol);
        const item = serverWatchlist.find(q => q.symbol === symbol);
        if (!item) return;
        const price = Number(event.price);
        const accepted = applyMarketQuote(item, { price, high: item.provider === 'twelvedata' ? Math.max(item.high, price) : price, low: item.provider === 'twelvedata' && item.low > 0 ? Math.min(item.low, price) : price, change: item.provider === 'twelvedata' ? item.change : 0,
          provider: 'twelvedata', providerSymbol: event.symbol, instrumentKind: 'spot', asOf: providerTimestamp(event.timestamp), receivedAt: Date.now() });
        if (accepted) { if (isExecutableQuote(item)) attempts = 0; broadcast(); }
      } catch { /* invalid provider frames are not quotes */ }
    });
    ws.on('error', () => { /* close schedules the bounded reconnect */ });
    ws.on('close', () => {
      clearInterval(heartbeat); stream = null;
      if (running) reconnect = setTimeout(connect, Math.min(60_000, 5000 * 2 ** Math.min(attempts++, 4)));
    });
    await new Promise<void>(resolve => { ws.once('open', () => resolve()); ws.once('close', () => resolve()); });
    } catch (error) {
      if (running) { warn('[TwelveData] Stream not started:', error); reconnect = setTimeout(connect, 60_000); }
    } finally { connecting = false; await lease?.release(); }
  };
  const tick = async () => {
    try {
      // A subscribed fresh instrument should not force REST credits to be spent for every tick.
      // Check every OTHER instrument independently; one active stream cannot mask a partial outage.
      const hasStreamData = !tiingoConfigured() && stream?.readyState === WebSocket.OPEN && serverWatchlist.some(q => q.provider === 'twelvedata' && isExecutableQuote(q));
      if (hasStreamData && Date.now() - lastRestSync < getQuoteSyncMs()) {
        await fetchYahooPricesFor(serverWatchlist.filter(q => q.provider !== 'twelvedata' || !isExecutableQuote(q)));
      } else {
        await fetchRealLatestPrices(); lastRestSync = Date.now();
      }
      if (running) broadcast();
    } catch (error) { warn('[Feed] Refresh failed:', error); }
    finally {
      if (running) {
        const base = !tiingoConfigured() && process.env.TWELVEDATA_API_KEY ? getPollMs() : 5000;
        // A failing fallback must not slow preferred Tiingo checks past the quote freshness window.
        pollTimer = setTimeout(tick, tiingoConfigured() ? 10_000 : Math.min(60_000, base * 2 ** Math.min(getYahooFailureStreak(), 4)));
      }
    }
  };
  void connect(); void tick();
  return () => {
    running = false; clearTimeout(pollTimer); clearTimeout(reconnect); clearInterval(heartbeat);
    stream?.terminate(); stream = null;
  };
}
