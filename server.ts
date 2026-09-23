import { isTimeframe, TIMEFRAMES } from './shared/timeframes';
import { getWeeklyCalendar, CalendarError } from './server/services/forexFactory';
import { tiingoStatus } from './server/services/tiingo';
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { createServer } from 'node:http';
import dotenv from 'dotenv';
import { log, warn, error as logError } from './server/lib/logger';
import { fetchJsonWithTimeout } from './server/lib/fetch';
import { isRateLimited, policyForRequest, retryAfterSeconds } from './server/lib/rateLimit';
import { securityHeadersMiddleware, sanitizeClientIp, applyTrustProxy } from './server/lib/security';
import { priceCache } from './server/lib/cache';
import { cachedLoad } from './server/lib/singleFlight';
import { BudgetError, reserveMarketBudget } from './server/lib/paidBudget';
import { serverWatchlist, fetchRealLatestPrices, marketSource, marketRates, getYahooFailureStreak } from './server/services/market';
import { fetchMarketHistory } from './server/services/yahoo';
import { startMarketServices } from './server/services/background';
import { attachReadOnlySockets, websocketEnabled } from './server/services/socket';
import { registerChat } from './server/routes/chat';
import { isExecutableQuote, isSymbol, quoteQuality, QUOTE_MAX_AGE_MS, type MarketQuote } from './shared/market';

dotenv.config({ quiet: true });
const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple');
const trustProxyMode = applyTrustProxy(app);
export const httpServer = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, app);
httpServer.maxConnections = 1000;
httpServer.keepAliveTimeout = 5000;
let stopMarket: (() => void) | null = null;
let closeVite: (() => Promise<void>) | undefined;

app.use(securityHeadersMiddleware);
// Liveness has NO provider/Redis dependency and is deliberately separate from market readiness.
app.get(['/api/live', '/healthz'], (_req, res) => res.json({ status: 'alive', uptime: process.uptime() }));
let activeRequests = 0;
app.use('/api', (req, res, next) => {
  if (activeRequests >= 128) { res.setHeader('Retry-After', '5'); res.status(503).json({ error: 'Server busy' }); return; }
  activeRequests++;
  let released = false;
  const release = () => { if (!released) { released = true; activeRequests--; } };
  res.once('finish', release); res.once('close', release);
  const policy = policyForRequest(req);
  const key = `${policy.label}:${sanitizeClientIp(req)}`;
  res.setHeader('X-RateLimit-Limit', String(policy.max));
  res.setHeader('X-RateLimit-Policy', `${policy.label};window=${policy.windowMs / 1000}s`);
  void isRateLimited(key, policy.max, policy.windowMs).then(limited => {
    if (res.destroyed) return;
    if (limited) {
      const retry = retryAfterSeconds(key, policy.windowMs);
      res.setHeader('Retry-After', String(retry));
      res.status(429).json({ error: 'Too many requests. Retry later.', code: 'RATE_LIMITED', retryAfterSeconds: retry });
    } else next();
  }).catch(next);
});
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '384kb' }));
const sockets = attachReadOnlySockets(httpServer, app);

function health() {
  const now = Date.now();
  const fresh = serverWatchlist.filter(q => isExecutableQuote(q, now)).length;
  const required = (process.env.REQUIRED_MARKET_SYMBOLS || serverWatchlist.map(q => q.symbol).join(',')).split(',').map(s => s.trim());
  const ready = required.length > 0 && required.every(symbol => isExecutableQuote(serverWatchlist.find(q => q.symbol === symbol), now));
  return { status: ready ? 'ok' : 'degraded', uptime: process.uptime(), timestamp: new Date(now).toISOString(),
    feed: { source: marketSource(), preferredProvider: 'tiingo', tiingo: tiingoStatus(), fresh, priced: serverWatchlist.filter(q => q.price > 0).length, total: serverWatchlist.length,
      required, yahooFailureStreak: getYahooFailureStreak(), instruments: serverWatchlist.map(q => ({ symbol: q.symbol, provider: q.provider,
        providerSymbol: q.providerSymbol, instrumentKind: q.instrumentKind, asOf: q.asOf, quality: quoteQuality(q, now) })) },
    wsClients: sockets.count() };
}
app.get('/api/health', (_req, res) => res.json(health()));
app.get('/api/ready', (_req, res) => { const body = health(); res.status(body.status === 'ok' ? 200 : 503).json(body); });
app.get('/api/capabilities', (_req, res) => res.json({ websocket: websocketEnabled(), wsPath: '/ws', wsTokenMethod: 'POST',
  quoteMaxAgeMs: QUOTE_MAX_AGE_MS, timeframes: TIMEFRAMES, calendar: 'forexfactory-weekly', preferredProvider: 'tiingo', aiRequiresAccount: process.env.AI_ALLOW_GUESTS !== 'true', deployment: process.env.VERCEL ? 'request-driven-polling' : 'node' }));

async function refreshForRequest() {
  if (process.env.MARKET_DATA_MODE === 'offline' || stopMarket) return;
  // Instance-local cache + single-flight. Paid budgets are shared in production even on cold replicas.
  await cachedLoad(priceCache, 'market:poll-cycle', 4000, fetchRealLatestPrices);
}
app.get('/api/market/prices', async (_req, res) => {
  try {
    await refreshForRequest();
    const fresh = serverWatchlist.some(q => isExecutableQuote(q));
    res.status(fresh ? 200 : 503).json({ success: fresh, source: marketSource(), rates: marketRates(), sentAt: Date.now(),
      ...(fresh ? {} : { code: 'MARKET_STALE', error: 'No fresh, timestamped market quotes.' }) });
  } catch { res.status(502).json({ success: false, code: 'MARKET_UNAVAILABLE', error: 'Market data unavailable.' }); }
});
// This legacy quote route now shares the watchlist provider/cache instead of multiplying paid calls.
app.get('/api/market/quote', async (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.replace('/', '').toUpperCase() : '';
  if (!isSymbol(symbol)) return res.status(400).json({ error: 'Unsupported symbol' });
  try {
    await refreshForRequest();
    const quote = serverWatchlist.find(q => q.symbol === symbol)!;
    const success = isExecutableQuote(quote);
    res.status(success ? 200 : 503).json({ ...quote, success, source: quote.provider, quality: quoteQuality(quote), close: String(quote.price) });
  } catch { res.status(502).json({ error: 'Quote unavailable.' }); }
});
app.get('/api/market/history', async (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : '';
  const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : '';
  if (!isSymbol(symbol) || !isTimeframe(timeframe)) return res.status(400).json({ error: 'Unsupported symbol/timeframe' });
  if (process.env.MARKET_DATA_MODE === 'offline') return res.status(503).json({ success: false, error: 'Market data disabled by operator' });
  try { res.json(await fetchMarketHistory(symbol, timeframe)); }
  catch (error) { logError('[History] Request failed:', error); res.status(502).json({ success: false, error: 'Historical providers unavailable.' }); }
});
app.get('/api/market/calendar', async (req, res) => {
  if (req.query.week !== undefined && req.query.week !== 'this') return res.status(400).json({ error: 'Only the current Forex Factory weekly export is supported.' });
  try {
    const result = await getWeeklyCalendar();
    res.setHeader('Cache-Control', result.stale ? 'no-store' : 'public, max-age=60, s-maxage=300');
    res.json(result);
  } catch (error) {
    const failure = error instanceof CalendarError ? error : new CalendarError('Weekly calendar unavailable.');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Retry-After', String(failure.retryAfterSeconds));
    res.status(503).json({ success: false, source: 'forexfactory', code: failure.code, error: failure.message });
  }
});
app.get('/api/forex', async (_req, res) => {
  try {
    if (process.env.MARKET_DATA_MODE === 'offline') return res.status(503).json({ success: false, error: 'Market data disabled by operator' });
    const result = await cachedLoad(priceCache, 'reference:frankfurter:USD', 3_600_000, async () => {
      const data = await fetchJsonWithTimeout('https://api.frankfurter.app/latest?from=USD', { timeoutMs: 6000 });
      const rates = data?.rates ?? {};
      const values: Record<string, number> = { EURUSD: 1 / rates.EUR, GBPUSD: 1 / rates.GBP, AUDUSD: 1 / rates.AUD,
        USDJPY: rates.JPY, USDCAD: rates.CAD, GBPJPY: rates.JPY / rates.GBP };
      const quotes: Record<string, MarketQuote> = {};
      for (const [symbol, price] of Object.entries(values)) if (Number.isFinite(price) && price > 0) {
        quotes[symbol] = { symbol, price, high: price, low: price, change: 0, provider: 'frankfurter', providerSymbol: symbol,
          instrumentKind: 'reference', asOf: null, receivedAt: Date.now() };
      }
      if (!Object.keys(quotes).length) throw new Error('No usable reference rates');
      return { success: true, source: 'frankfurter', description: 'Daily working-day reference rates — not executable market prices.', referenceDate: data.date, rates: quotes };
    });
    res.json(result);
  } catch { res.status(502).json({ success: false, error: 'Daily reference rates unavailable.' }); }
});
registerChat(app);

async function paidProxy(provider: string, key: string, url: string) {
  return cachedLoad(priceCache, key, 60_000, async () => {
    const lease = await reserveMarketBudget(provider);
    try { return await fetchJsonWithTimeout(url, { timeoutMs: 6000 }); }
    finally { await lease.release(); }
  });
}
function proxyError(res: express.Response, error: unknown) {
  if (error instanceof BudgetError) return res.status(error.status).json({ error: error.message, code: 'PAID_BUDGET' });
  return res.status(502).json({ error: 'Upstream unavailable.' });
}
app.get('/api/market/news', async (req, res) => {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return res.status(503).json({ error: 'News provider is not configured.' });
  const category = typeof req.query.category === 'string' ? req.query.category : 'forex';
  if (!['forex', 'general', 'crypto', 'merger'].includes(category)) return res.status(400).json({ error: 'Unsupported news category' });
  try { res.json(await paidProxy('finnhub', `news:${category}`, `https://finnhub.io/api/v1/news?category=${category}&token=${key}`)); }
  catch (error) { proxyError(res, error); }
});
app.get('/api/market/forexrate', async (req, res) => {
  const key = process.env.FOREXRATE_API_KEY;
  if (!key) return res.status(503).json({ error: 'Rate provider is not configured.' });
  const base = typeof req.query.base === 'string' ? req.query.base : 'USD';
  if (!['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'].includes(base)) return res.status(400).json({ error: 'Unsupported base currency' });
  try { res.json(await paidProxy('forexrate', `rates:${base}`, `https://api.forexrateapi.com/v1/latest?base=${base}&api_key=${key}`)); }
  catch (error) { proxyError(res, error); }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
// Keep parser failures in the JSON API contract. Never reflect a malformed body or stack trace.
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
  if (!res.headersSent) res.status(status).json({ code: status === 413 ? 'BODY_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : 'SERVER_ERROR', error: status === 413 ? 'Request body too large.' : status === 400 ? 'Malformed JSON body.' : 'Request failed.' });
});

/** Explicit entry point. Importing this module (including from Vercel) does not bind, fetch, or start timers. */
export async function startServer() {
  if (httpServer.listening) return httpServer;
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    // Share the public HTTP server: a separate HMR port is not reachable through the preview proxy.
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer } },
      appType: 'spa',
    });
    closeVite = () => vite.close(); app.use(vite.middlewares);
  } else {
    const clientPath = path.resolve('dist/client');
    // Backend bundle/maps live OUTSIDE the static root; reserve their old public paths too.
    app.get(['/server.cjs', '/server.cjs.map', '/server.js', '/server.js.map'], (_req, res) => res.status(404).end());
    app.use(express.static(clientPath, { dotfiles: 'deny' }));
    app.get('*', (req, res) => {
      if (req.path.includes('.') || req.path.startsWith('/api')) return res.status(404).end();
      res.sendFile(path.join(clientPath, 'index.html'));
    });
  }
  const parsed = Number(process.env.PORT ?? 3000);
  const port = Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 3000;
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', () => { httpServer.off('error', reject); resolve(); });
  });
  stopMarket = startMarketServices(sockets.broadcast);
  log(`[Server] Listening on 0.0.0.0:${port}; liveness /api/live; market readiness /api/ready; trustProxy=${trustProxyMode}`);
  if (process.env.NODE_ENV === 'production' && !process.env.UPSTASH_REDIS_REST_URL && process.env.PAID_BUDGET_MODE !== 'single-process') warn('[Server] Shared budgets are not configured: paid upstream calls fail closed. Yahoo fallback remains available.');
  return httpServer;
}
export async function stopServer() {
  stopMarket?.(); stopMarket = null; sockets.stop(); await closeVite?.();
  if (httpServer.listening) {
    const closed = new Promise<void>(resolve => httpServer.close(() => resolve()));
    httpServer.closeAllConnections(); await closed;
  }
}
export default app;
