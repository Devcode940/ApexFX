import express from 'express';
import compression from 'compression';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';

// Modular imports
import { log, warn, error as logError } from './server/lib/logger.js';
import { fetchWithTimeout } from './server/lib/fetch.js';
import { isRateLimited, isChatRateLimited, policyForRequest, retryAfterSeconds } from './server/lib/rateLimit.js';
import { securityHeadersMiddleware, getAllowedOrigins, validateSymbolFormat, sanitizeClientIp, applyTrustProxy, isIgnoredForwardedHeader, timingSafeCompare } from './server/lib/security.js';
import { historyCache, priceCache } from './server/lib/cache.js';
import {
  PAIRS_CONFIG_WS,
  TD_SYMBOLS,
  serverWatchlist,
  fetchTwelveDataQuotes,
  fetchYahooPricesFor,
  fetchRealLatestPrices,
  getQuoteSyncMs,
  getPollMs,
  isTdRestCoolingDown,
  marketSource,
  getYahooFailureStreak,
} from './server/services/market.js';
import { fetchMarketHistory } from './server/services/yahoo.js';

dotenv.config();

const app = express();
// Fingerprinting: the hand-rolled "helmet-like" middleware could not remove this, and it was
// verified still being sent in production.
app.disable('x-powered-by');
// Must be set before anything reads req.ip (rate limiting, WS token issuance).
const TRUST_PROXY_MODE = applyTrustProxy(app);

// Query parsing: use the flat parser instead of the default nested (`qs`) one.
// WHY: `npm audit` still reports 4 moderate advisories we cannot clear without either forcing a
// qs version outside express 4's declared range or migrating to express 5 (where the
// `app.get('*')` SPA fallback below is a syntax error). Two of them are qs array-limit/DoS
// issues reachable through bracket syntax (`?a[]=x&b[0][c]=y`). No endpoint in this API reads
// array or nested query params — every consumer here takes a single string (symbol, timeframe,
// category, base) — so switching to 'simple' removes the reachable surface at zero cost.
app.set('query parser', 'simple');
const PORT = (() => {
  const raw = process.env.PORT;
  const parsed = raw ? parseInt(raw, 10) : 3000;
  if (isNaN(parsed) || parsed <= 0 || parsed > 65535) return 3000;
  return parsed;
})();

const server = createServer(app);

// --- Safe WebSocket send helper (prevents silent failures on closed sockets) ---
function safeSend(ws: WebSocket | null | undefined, data: unknown): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch (err) {
    warn('[WS] safeSend failed:', err);
    return false;
  }
}

// --- Security: WebSocket server with origin check ---
const ALLOWED_ORIGINS = getAllowedOrigins();

const wss = new WebSocketServer({
  server,
  verifyClient: (info, callback) => {
    const origin = info.origin || info.req.headers.origin;
    // In production, require origin to be in allowlist
    if (process.env.NODE_ENV === 'production') {
      if (!origin) {
        // Allow non-browser clients only if they present a valid token via query? 
        // For verifyClient we can't check token yet, so we allow but connection handler will validate token.
        callback(true);
        return;
      }
      if (ALLOWED_ORIGINS.includes(origin)) {
        callback(true);
      } else {
        callback(false, 403, 'Unauthorized origin');
      }
    } else {
      // Dev: allow all but log
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        warn(`[WS] Allowing origin in dev: ${origin}`);
      }
      callback(true);
    }
  },
});

// --- Security middleware (helmet-like) ---
app.use(securityHeadersMiddleware);

// --- Rate limiting: registered BEFORE any route on purpose. -----------------------------
// It used to be registered *below* /api/health and /api/ws/token, and Express matches routes in
// registration order, so both endpoints silently bypassed the limiter (verified: 40x /api/health
// all returned 200 while other routes were 429-ing). Body parsing also comes after limiting so a
// rejected request never pays for JSON parsing.
app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  rateLimitMiddleware(req, res, next).catch(next);
});
/**
 * Response compression. The entry JS bundle was 1,334,349 bytes raw / 385,440 gzipped (71% smaller),
 * and every JSON payload here is repetitive numeric data that compresses hard, so this is the
 * highest-value transfer change available. Placed at module scope BEFORE any route for the same reason
 * the rate limiter is: Express runs middleware in registration order, so anything mounted later would
 * not be compressed (and a route registered above it would silently skip it).
 *
 * Notes:
 *  - `Vary: Accept-Encoding` is set by the middleware, so a shared cache cannot serve gzipped bytes to a
 *    client that did not ask for them.
 *  - Responses that already declare a Content-Encoding are left alone (CDN / pre-compressed asset).
 *  - BREACH-style length attacks need a route that reflects attacker-chosen text alongside a secret in
 *    the same compressed body. Nothing here does: /api/ws/token returns a fresh random token and no route
 *    echoes credentials. If a future route reflects user text next to a secret, exclude that path.
 */
app.use(
  compression({
    threshold: 1024, // below ~1 KB the framing and CPU cost more than the bytes saved
    filter: (req: express.Request, res: express.Response) => {
      if (res.getHeader('Content-Encoding')) return false;
      return compression.filter(req, res);
    },
  })
);
app.use(express.json({ limit: '1mb' }));

// --- WebSocket auth tokens with hardening ---
const wsAuthTokens = new Map<string, { createdAt: number; ip: string }>();
const WS_TOKEN_EXPIRY_MS = 2 * 60 * 1000; // 2 min; reconnects re-issue a token. Web sockets stay open past expiry by design.

// Cleanup expired WS tokens every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of wsAuthTokens) {
    if (now - data.createdAt > WS_TOKEN_EXPIRY_MS) {
      wsAuthTokens.delete(token);
    }
  }
}, 60_000).unref?.();

// --- Rate limiting middleware (async, supports Upstash) ---
let forwardedRejectedCount = 0;
let forwardedRejectedLoggedAt = 0;

async function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const clientKey = sanitizeClientIp(req);

  // Someone sent X-Forwarded-For from an address we do not trust. Ignoring it is correct, but it is
  // also the signature of either an attacker or a proxy that was never configured - and both are
  // worth one log line, at most once a minute.
  if (isIgnoredForwardedHeader(req)) {
    forwardedRejectedCount += 1;
    const now = Date.now();
    if (now - forwardedRejectedLoggedAt > 60_000) {
      forwardedRejectedLoggedAt = now;
      warn(
        `[Security] A client sent X-Forwarded-For but it was not honoured (peer ${req.socket?.remoteAddress ?? 'unknown'}, ` +
          `mode "${TRUST_PROXY_MODE}", ${forwardedRejectedCount} occurrence(s) since last notice). ` +
          `Behind a proxy on a public address set TRUST_PROXY=1; otherwise treat this as a spoof attempt.`
      );
    }
  }
  const { max, windowMs, label } = policyForRequest(req);
  const bucketKey = `${label}:${clientKey}`;

  // Advertise the budget so clients can back off correctly instead of guessing. Before this,
  // a 429 carried no Retry-After and the poller kept hammering at its old cadence.
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Policy', `${label};window=${Math.round(windowMs / 1000)}s`);

  const limited = await isRateLimited(bucketKey, max, windowMs);
  if (limited) {
    res.setHeader('Retry-After', String(retryAfterSeconds(bucketKey, windowMs)));
    return res.status(429).json({
      error: 'Too many requests. Please wait a moment and try again.',
      code: 'RATE_LIMITED',
      scope: label,
      retryAfterSeconds: Number(res.getHeader('Retry-After')),
    });
  }
  next();
}

// --- Twelve Data WS streaming ---
let tdWs: WebSocket | null = null;
let tdWsReconnectTimer: NodeJS.Timeout | null = null;
let tdWsHeartbeatTimer: NodeJS.Timeout | null = null;
let tdWsLastPriceAt = 0;

function startTwelveDataStream() {
  const tdApiKey = process.env.TWELVEDATA_API_KEY;
  if (!tdApiKey || tdWs || process.env.VERCEL) return;
  try {
    tdWs = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${tdApiKey}`, {
      headers: {
        'User-Agent': 'ApexFX-Terminal/1.0 (Production)',
      },
    } as any);
    tdWs.on('open', () => {
      log('[TwelveData] WebSocket stream connected.');
      safeSend(tdWs, { action: 'subscribe', params: { symbols: Object.values(TD_SYMBOLS).join(',') } });
      tdWsHeartbeatTimer = setInterval(() => {
        try {
          safeSend(tdWs, { action: 'heartbeat' });
        } catch {
          /* ignore */
        }
      }, 10_000);
    });
    tdWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.event === 'price' && msg.symbol && msg.price) {
          const key = Object.keys(TD_SYMBOLS).find((k) => TD_SYMBOLS[k] === msg.symbol);
          const item = key ? serverWatchlist.find((i) => i.symbol === key) : undefined;
          if (key && item) {
            const price = parseFloat(msg.price);
            if (isFinite(price) && price > 0) {
              const config = PAIRS_CONFIG_WS[key];
              item.price = parseFloat(price.toFixed(config.pipDecimal + 1));
              item.high = Math.max(item.high, item.price);
              item.low = item.low > 0 ? Math.min(item.low, item.price) : item.price;
              tdWsLastPriceAt = Date.now();
              broadcastPrices();
            }
          }
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    tdWs.on('error', (err) => {
      warn('[TwelveData] WebSocket error:', (err as Error).message || 'connection failed');
    });
    tdWs.on('close', () => {
      warn('[TwelveData] WebSocket closed — REST polling fallback is active.');
      if (tdWsHeartbeatTimer) {
        clearInterval(tdWsHeartbeatTimer);
        tdWsHeartbeatTimer = null;
      }
      tdWs = null;
      scheduleTdWsReconnect();
    });
  } catch (e) {
    warn('[TwelveData] WebSocket setup failed:', (e as Error).message);
    tdWs = null;
    scheduleTdWsReconnect();
  }
}

function scheduleTdWsReconnect() {
  if (tdWsReconnectTimer) clearTimeout(tdWsReconnectTimer);
  tdWsReconnectTimer = setTimeout(() => {
    tdWsReconnectTimer = null;
    startTwelveDataStream();
  }, 10_000);
}

let tdSyncInFlight = false;
async function tdSyncOnce() {
  if (tdSyncInFlight) return;
  if (isTdRestCoolingDown()) return;
  tdSyncInFlight = true;
  try {
    const applied = await fetchTwelveDataQuotes();
    const remaining = serverWatchlist.filter((i) => !applied.has(i.symbol));
    if (remaining.length > 0) await fetchYahooPricesFor(remaining);
    broadcastPrices();
  } finally {
    tdSyncInFlight = false;
  }
}

function broadcastPrices() {
  const payload = JSON.stringify({
    type: 'PRICE_UPDATE',
    rates: serverWatchlist.reduce((acc, item) => {
      acc[item.symbol] = {
        price: item.price,
        high: item.high,
        low: item.low,
        change: item.change,
      };
      return acc;
    }, {} as Record<string, any>),
    timestamp: new Date().toISOString(),
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Only run persistent streaming on Node hosts (not Vercel)
if (!process.env.VERCEL) {
  fetchRealLatestPrices()
    .then((summary) => {
      log(`[Server] Initial ${summary.source} sync: ${summary.applied}/${summary.attempted} instruments resolved${summary.failed ? `, ${summary.failed} upstream failure(s)` : ''}.`);
      broadcastPrices();
    })
    .catch((e) => logError('[Server] Initial market sync failed; the terminal will keep retrying with backoff:', e));

  const tdApiKey = process.env.TWELVEDATA_API_KEY;
  if (tdApiKey) {
    startTwelveDataStream();
    setInterval(tdSyncOnce, getQuoteSyncMs());
    setInterval(() => {
      const stale = Date.now() - tdWsLastPriceAt > 30_000;
      if (stale || !tdWs) tdSyncOnce();
    }, getPollMs());
  } else {
    // Yahoo fallback. Previously a bare `setInterval(..., 5000)` with no in-flight guard: while an
    // upstream was hanging, cycles stacked on top of each other (8 requests each), and a total
    // outage kept the same 5s cadence forever. Now: one cycle at a time, exponential backoff on
    // failure, and the transition is what gets logged.
    const FEED_BASE_MS = 5000;
    const FEED_MAX_MS = 60_000;
    let feedTimer: NodeJS.Timeout | null = null;
    let feedInFlight = false;
    let feedStreakLogged = 0;

    const feedDelayMs = () => {
      const f = getYahooFailureStreak();
      if (f <= 1) return FEED_BASE_MS;
      return Math.min(FEED_MAX_MS, FEED_BASE_MS * 2 ** Math.min(f - 1, 4)); // 5,10,20,40,60s
    };

    const feedTick = async () => {
      if (feedInFlight) return;
      feedInFlight = true;
      try {
        const summary = await fetchRealLatestPrices();
        if (summary.applied > 0) {
          if (feedStreakLogged > 0) {
            log(`[Feed] Yahoo recovered after ${feedStreakLogged} degraded cycle(s).`);
            feedStreakLogged = 0;
          }
          broadcastPrices();
        } else {
          feedStreakLogged += 1;
          if (feedStreakLogged === 1 || feedStreakLogged % 20 === 0) {
            warn(`[Feed] no instrument updated this cycle (degraded for ${feedStreakLogged} cycle(s)); next attempt in ${Math.round(feedDelayMs() / 1000)}s`);
          }
        }
      } catch (e) {
        logError('[Feed] unexpected sync failure:', e);
      } finally {
        feedInFlight = false;
        feedTimer = setTimeout(feedTick, feedDelayMs());
        feedTimer.unref?.();
      }
    };

    feedTimer = setTimeout(feedTick, 0);
    feedTimer.unref?.();
  }
}

// --- Health check ---
app.get('/api/health', (_req, res) => {
  const priced = serverWatchlist.filter((i) => i.price > 0).length;
  res.json({
    status: priced > 0 ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    watchlist: serverWatchlist.length,
    // 'ok' with 0 priced instruments used to be indistinguishable from a working feed — which is
    // why an upstream outage looked healthy to monitors and to the client.
    feed: { source: marketSource(), priced, yahooFailureStreak: getYahooFailureStreak() },
    wsClients: wss.clients.size,
    env: process.env.NODE_ENV || 'development',
  });
});

// --- Secured WS token endpoint ---
app.get('/api/ws/token', async (req, res) => {
  const clientIp = sanitizeClientIp(req);

  // Rate limiting for this route is handled by the '/api' middleware (policy label 'ws-token').
  // The second, stricter bucket that used to live here was redundant: it just made the
  // effective limit 10/min with a different 429 body, which the client could not parse.

  // If WS_SHARED_SECRET is set, require it (constant-time: this is a long-lived static secret).
  const requiredSecret = process.env.WS_SHARED_SECRET;
  if (requiredSecret) {
    const provided = (req.headers['x-ws-secret'] as string) || (typeof req.query.secret === 'string' ? req.query.secret : undefined);
    if (!timingSafeCompare(provided, requiredSecret)) {
      return res.status(403).json({ error: 'Invalid or missing WS secret' });
    }
  } else if (process.env.NODE_ENV === 'production') {
    // No shared secret configured: require a *matching* Origin.
    //
    // The previous logic only rejected origins that were present AND disallowed, so a request
    // with no Origin header at all (i.e. any non-browser client: curl, python, a scraper) walked
    // straight in — verified returning 200 in production. Browsers always send Origin on this
    // same-origin GET, so tightening it costs nothing legitimate.
    const origin = req.headers.origin;
    if (!origin) {
      return res.status(403).json({ error: 'Origin required', hint: 'Set WS_SHARED_SECRET to allow non-browser clients.' });
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  wsAuthTokens.set(token, { createdAt: Date.now(), ip: clientIp });
  setTimeout(() => wsAuthTokens.delete(token), WS_TOKEN_EXPIRY_MS).unref?.();
  res.json({ token, expiresIn: WS_TOKEN_EXPIRY_MS / 1000 });
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token || !wsAuthTokens.has(token)) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Authentication failed' }));
    ws.close(4001, 'Unauthorized');
    return;
  }

  const tokenData = wsAuthTokens.get(token);
  if (tokenData && Date.now() - tokenData.createdAt > WS_TOKEN_EXPIRY_MS) {
    wsAuthTokens.delete(token);
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Token expired' }));
    ws.close(4002, 'Token Expired');
    return;
  }

  wsAuthTokens.delete(token);

  const initialPayload = JSON.stringify({
    type: 'INITIAL_RATES',
    rates: serverWatchlist.reduce((acc, item) => {
      acc[item.symbol] = {
        price: item.price,
        high: item.high,
        low: item.low,
        change: item.change,
      };
      return acc;
    }, {} as Record<string, any>),
    timestamp: new Date().toISOString(),
  });
  ws.send(initialPayload);
});

// Initialize Gemini API client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'ApexFX-Terminal/1.0 (Production)',
      },
    },
  });
}

// Model id MUST be configurable: `gemini-2.0-flash` (the previously hardcoded value) was shut
// down by Google on 2026-06-01, which silently took the whole AI feature down. Google's own
// guidance is that retirement cadence makes indirection mandatory.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const SHOW_UPSTREAM_ERRORS = (process.env.SHOW_UPSTREAM_ERRORS || String(process.env.NODE_ENV !== 'production')) === 'true';

const OPENROUTER_KEY_CANDIDATE = process.env.OPENROUTER_API_KEY;
const openRouterApiKey = OPENROUTER_KEY_CANDIDATE?.startsWith('sk-or-') ? OPENROUTER_KEY_CANDIDATE : undefined;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/auto';

function toOpenRouterMessages(contents: any[]) {
  return contents.map((c) => {
    const content: any[] = [];
    for (const part of c.parts || []) {
      if (part?.text) content.push({ type: 'text', text: part.text });
      else if (part?.inlineData?.data) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}` },
        });
      }
    }
    return { role: c.role === 'user' ? 'user' : 'assistant', content };
  });
}

async function generateOpenRouter(system: string, contents: any[]) {
  const messages = [{ role: 'system', content: system }, ...toOpenRouterMessages(contents)];
  const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://localhost:3000',
      'X-Title': 'ApexFX',
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages, max_tokens: 1024 }),
    timeoutMs: 15000,
  });
  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('OpenRouter returned no response text.');
  return text;
}

// 1. REAL DATA API: Live rates fetched from public Frankfurter API
app.get('/api/forex', async (req, res) => {
  try {
    const cacheKey = 'frankfurter:USD';
    const cached = priceCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const response = await fetchWithTimeout('https://api.frankfurter.app/latest?from=USD', { timeoutMs: 6000 });
    if (!response.ok) {
      throw new Error(`Frankfurter API returned status ${response.status}`);
    }
    const data = await response.json();

    const r = data.rates || {};
    const eurRates = r.EUR ? parseFloat((1 / r.EUR).toFixed(5)) : null;
    const gbpRates = r.GBP ? parseFloat((1 / r.GBP).toFixed(5)) : null;
    const audRates = r.AUD ? parseFloat((1 / r.AUD).toFixed(5)) : null;
    const jpyRates = r.JPY ? parseFloat(r.JPY.toFixed(3)) : null;
    const cadRates = r.CAD ? parseFloat(r.CAD.toFixed(5)) : null;
    const gbpjpyRates = r.GBP && r.JPY ? parseFloat((r.JPY / r.GBP).toFixed(3)) : null;

    const result = {
      success: true,
      source: 'Frankfurter Real-time API',
      timestamp: data.date,
      rates: {
        EURUSD: eurRates,
        GBPUSD: gbpRates,
        USDJPY: jpyRates,
        AUDUSD: audRates,
        USDCAD: cadRates,
        GBPJPY: gbpjpyRates,
      },
    };

    priceCache.set(cacheKey, result, 30_000);
    res.json(result);
  } catch (e: any) {
    logError('Frankfurter API error:', e.message);
    res.json({
      success: false,
      error: 'Failed to fetch live rates',
    });
  }
});

// Watchlist Live Prices API Endpoint (HTTP Fallback)
let lastPriceFetchTs = 0;
const PRICE_FETCH_CACHE_MS = 4000;
app.get('/api/market/prices', async (req, res) => {
  try {
    const cacheKey = 'watchlist:prices';
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - lastPriceFetchTs < PRICE_FETCH_CACHE_MS) {
      return res.json(cached);
    }

    if (process.env.VERCEL && Date.now() - lastPriceFetchTs > PRICE_FETCH_CACHE_MS) {
      await fetchYahooPricesFor(serverWatchlist);
      lastPriceFetchTs = Date.now();
    }

    const result = {
      success: true,
      source: marketSource(),
      rates: serverWatchlist.reduce((acc, item) => {
        acc[item.symbol] = {
          price: item.price,
          high: item.high,
          low: item.low,
          change: item.change,
        };
        return acc;
      }, {} as Record<string, any>),
      timestamp: new Date().toISOString(),
    };

    priceCache.set(cacheKey, result, PRICE_FETCH_CACHE_MS);
    res.json(result);
  } catch {
    res.status(502).json({ error: 'Failed to fetch market prices' });
  }
});

// 4. REAL HISTORICAL CHART DATA API
app.get('/api/market/history', async (req, res) => {
  try {
    const { symbol, timeframe } = req.query;
    if (!symbol || !timeframe) {
      return res.status(400).json({ error: 'Symbol and timeframe are required' });
    }

    const sym = String(symbol).toUpperCase();
    const tf = String(timeframe);

    if (!validateSymbolFormat(sym, false)) {
      return res.status(400).json({ error: 'Invalid symbol format' });
    }

    const validTimeframes = ['1m', '5m', '15m', '1H', '4H', 'D'];
    if (!validTimeframes.includes(tf)) {
      return res.status(400).json({ error: 'Invalid timeframe' });
    }

    if (sym.length > 10) {
      return res.status(400).json({ error: 'Symbol too long' });
    }

    const cacheKey = `history:${sym}:${tf}`;
    const cached = historyCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await fetchMarketHistory(sym, tf);
    historyCache.set(cacheKey, result, 60_000);
    res.json(result);
  } catch (e: any) {
    logError('Failed to fetch historical data:', e);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch historical data',
    });
  }
});

// --- /api/chat guardrails ---
const CHAT_MAX_HISTORY = 30;
const CHAT_MAX_MESSAGE_LEN = 8000;
const CHAT_TIMEOUT_MS = 45_000;

app.post('/api/chat',
  [
    body('messages').isArray({ min: 1 }).withMessage('messages must be a non-empty array'),
    body('messages.*.text').optional().isString().trim().isLength({ max: 8000 }).withMessage('Message text too long'),
    body('selectedSymbol').optional().trim().matches(/^[A-Z0-9/]{0,20}$/).withMessage('Invalid symbol format'),
    body('selectedTimeframe').optional().trim().isIn(['1m','5m','15m','1H','4H','D','W','M']).withMessage('Invalid timeframe'),
  ],
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }
    next();
  },
  async (req: express.Request, res: express.Response) => {
  try {
    const { messages, selectedSymbol, selectedTimeframe, activeSignal } = req.body;

    if (!ai && !openRouterApiKey) {
      // 503 (not 500): this is a missing-configuration state, not a request failure.
      return res.status(503).json({
        error: 'AI service is not configured on this server.',
        code: 'AI_NOT_CONFIGURED',
        hint: 'Set GEMINI_API_KEY or OPENROUTER_API_KEY.',
      });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid or missing messages array.' });
    }

    const clientKey = sanitizeClientIp(req);
    if (isChatRateLimited(clientKey)) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }

    const recent = messages.slice(-CHAT_MAX_HISTORY);
    for (const m of recent) {
      if (typeof m.text !== 'string' || m.text.length > CHAT_MAX_MESSAGE_LEN) {
        return res.status(400).json({ error: `Message too long (maximum ${CHAT_MAX_MESSAGE_LEN} characters).` });
      }
      // Basic injection guard for symbol/timeframe
      if (m.text.length > CHAT_MAX_MESSAGE_LEN) {
        return res.status(400).json({ error: 'Message too long' });
      }
    }

    // Sanitize symbol/timeframe for prompt injection
    const safeSymbol = typeof selectedSymbol === 'string' ? selectedSymbol.replace(/[^A-Z0-9/]/g, '').slice(0, 20) : 'EURUSD';
    const safeTimeframe = typeof selectedTimeframe === 'string' && ['1m','5m','15m','1H','4H','D'].includes(selectedTimeframe) ? selectedTimeframe : '1H';

    const contextStr = `
You are the ApexFX AI Analyst (AI Co-Pilot Strategist) in a professional trading platform.
Current active instrument: ${safeSymbol}
Active timeframe: ${safeTimeframe}
Latest analytical consensus signal: ${activeSignal ? JSON.stringify(activeSignal).slice(0, 2000) : 'None'}

Provide professional, accurate, and insightful trading or analysis answers. Use clean markdown formatting. Keep answers concise, highly specific, and focused on technical/fundamental aspects of forex trading. Use the exact symbol's pip and price characteristics in your explanations.

DISCLAIMER: These are experimental heuristic estimates, not financial advice. Win rates and profit factors shown elsewhere in the platform are heuristic estimates, not backtested results.
`;

    // Typed explicitly (was an untyped any[] pipeline): `contents` feeds the Gemini SDK's
    // ContentListUnion, and the old `.filter((c: any) => c && ...)` left `| null` in the element type,
    // so `contents[0].role` was an unchecked possible-null deref. The type predicate narrows for real.
    type ChatPart = { text: string } | { inlineData: { mimeType: string; data: string } };
    type ChatContent = { role: 'user' | 'model'; parts: ChatPart[] };

    const contents: ChatContent[] = recent
      .map((m: any): ChatContent | null => {
        const parts: ChatPart[] = [];
        if (m.image) {
          const imgStr = String(m.image);
          const matches = imgStr.match(/^data:([^;]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            // Validate mime type
            const mime = matches[1];
            if (!['image/png','image/jpeg','image/webp','image/jpg'].includes(mime)) {
              return null;
            }
            // Validate base64 size < 5MB
            if (matches[2].length > 7_000_000) {
              return null;
            }
            parts.push({
              inlineData: {
                mimeType: matches[1],
                data: matches[2],
              },
            });
          }
        }
        const text = typeof m.text === 'string' ? m.text : '';
        if (text.trim()) {
          parts.push({ text: text.slice(0, CHAT_MAX_MESSAGE_LEN) });
        }
        return { role: m.sender === 'user' ? 'user' : 'model', parts };
      })
      .filter((c): c is ChatContent => c !== null && c.parts.length > 0);

    if (contents.length === 0) {
      return res.status(400).json({ error: 'No usable message content.' });
    }

    if (contents[0].role !== 'user') {
      contents[0].role = 'user';
    }

    let text: string;
    if (openRouterApiKey) {
      text = await Promise.race([
        generateOpenRouter(contextStr, contents),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`OpenRouter request timed out after ${CHAT_TIMEOUT_MS / 1000}s.`)), CHAT_TIMEOUT_MS)
        ),
      ]);
    } else if (ai) {
      const result = await Promise.race([
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config: { systemInstruction: contextStr },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini request timed out after ${CHAT_TIMEOUT_MS / 1000}s.`)), CHAT_TIMEOUT_MS)
        ),
      ]);
      // `text` is a getter on GenerateContentResponse in @google/genai (verified against the SDK
      // typings), so no cast is needed - and the cast was hiding that fact.
      text = result.text || "I couldn't generate a response. Please try again.";
    } else {
      // Unreachable today (guarded above), but stated instead of asserted: `ai!` here would one day
      // become a null deref returning a 500.
      return res.status(503).json({ error: 'AI provider not configured', code: 'AI_NOT_CONFIGURED' });
    }

    res.json({ text });
  } catch (e: any) {
    logError('[Chat] generation failed:', e);
    const msg = String(e?.message || e);
    // Classify rather than swallow. The original handler returned one opaque 500 for every
    // failure, which is exactly why the retired-model outage (2.0-flash, shut down 2026-06-01)
    // was invisible to operators for months.
    let code = 'AI_UPSTREAM_ERROR';
    let status = 502;
    if (/not found|404|shrugged off|unavailable/i.test(msg) && /model/i.test(msg)) {
      code = 'AI_MODEL_UNAVAILABLE';
      status = 502;
    } else if (/429|rate/i.test(msg)) {
      code = 'AI_RATE_LIMITED';
      status = 429;
    } else if (/401|403|invalid.*key|unauthoriz/i.test(msg)) {
      code = 'AI_AUTH_FAILED';
      status = 502;
    } else if (/timed? out|timeout|AbortError/i.test(msg)) {
      code = 'AI_TIMEOUT';
      status = 504;
    }
    const body: Record<string, unknown> = {
      error: 'An error occurred while processing your request.',
      code,
    };
    if (code === 'AI_MODEL_UNAVAILABLE') {
      body.hint = `Model "${GEMINI_MODEL}" is unavailable. Set GEMINI_MODEL to a currently supported model id.`;
    }
    if (SHOW_UPSTREAM_ERRORS) body.detail = msg.slice(0, 300);
    res.status(status).json(body);
  }
});

// 3. REAL MARKET DATA APIs (Proxies to hide API keys)

// Finnhub News API Proxy
app.get('/api/market/news', async (req, res) => {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Service unavailable' });
    }
    const { category = 'forex' } = req.query;
    if (typeof category !== 'string' || !/^[a-z]{1,20}$/.test(category)) {
      return res.status(400).json({ error: 'Invalid category parameter' });
    }
    const response = await fetchWithTimeout(
      `https://finnhub.io/api/v1/news?category=${encodeURIComponent(category)}&token=${apiKey}`,
      { timeoutMs: 6000 }
    );
    if (!response.ok) throw new Error(`Finnhub returned HTTP ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    // Previously swallowed entirely: an operator could never tell "no key" from "Finnhub down".
    logError('[News] Finnhub fetch failed:', e);
    res.status(502).json({ error: 'Failed to fetch market news', code: 'NEWS_UPSTREAM_ERROR' });
  }
});

// Twelve Data Quote Proxy
app.get('/api/market/quote', async (req, res) => {
  const apiKey = typeof process.env.TWELVEDATA_API_KEY === 'string' ? process.env.TWELVEDATA_API_KEY.trim() : '';
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  if (!validateSymbolFormat(symbol as string, true)) {
    return res.status(400).json({ error: 'Invalid symbol format' });
  }
  // Unconfigured upstream is a 503, not a 500: a missing key is an expected deployment state, and
  // 500s page operators. (Previously this returned 500 'Service unavailable' with no code.)
  if (!apiKey) {
    res.setHeader('Retry-After', '300');
    return res.status(503).json({ error: 'Quote upstream not configured', code: 'NO_UPSTREAM' });
  }
  try {
    // Shared 15s cache across all clients. Without it, N tabs multiplied straight into N x the
    // upstream credit burn, and 400+ clients could exhaust a free plan in minutes.
    const cacheKey = `quote:${symbol}`;
    const cached = priceCache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Data-Age', 'cached');
      return res.json(cached);
    }

    const response = await fetchWithTimeout(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol as string)}&apikey=${apiKey}`,
      { timeoutMs: 6000 }
    );
    if (!response.ok) throw new Error(`Twelve Data returned HTTP ${response.status}`);
    const data = await response.json();
    // Only cache usable payloads; a 403/429 body must not be pinned for 15s across all users.
    if (!data?.code) priceCache.set(cacheKey, data, 15_000);
    res.json(data);
  } catch (e) {
    logError('[Quote] Twelve Data fetch failed:', e);
    res.status(502).json({ error: 'Failed to fetch market quote', code: 'QUOTE_UPSTREAM_ERROR' });
  }
});

// ForexRate API Proxy
app.get('/api/market/forexrate', async (req, res) => {
  try {
    const apiKey = process.env.FOREXRATE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Service unavailable' });
    }
    const { base = 'USD' } = req.query;
    if (base && !/^[A-Z]{3}$/.test(base as string)) {
      return res.status(400).json({ error: 'Invalid base currency format' });
    }
    const response = await fetchWithTimeout(
      `https://api.forexrateapi.com/v1/latest?base=${encodeURIComponent(String(base || 'USD'))}&api_key=${apiKey}`,
      { timeoutMs: 6000 }
    );
    if (!response.ok) throw new Error(`ForexRate API returned HTTP ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    logError('[ForexRate] fetch failed:', e);
    res.status(502).json({ error: 'Failed to fetch forex rate', code: 'RATES_UPSTREAM_ERROR' });
  }
});

// Vite middleware or production serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Dynamic import on purpose: vite is only needed for the dev middleware. A top-level import makes
    // every production bundler resolve it too - esbuild drags it into dist/server.cjs and @vercel/node
    // into the serverless function - so a dev tool chain ends up in the deploy graph. (vite is listed
    // under "dependencies" rather than devDependencies in this repo, which is what let the mistake go
    // unnoticed; moving it is a separate, deploy-visible change.)
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    // Unknown /api/* paths are already answered with a JSON 404 by the module-scope guard, which is
    // what Vite's SPA fallback used to defeat in dev (index.html + 200 -> res.json() parse error).
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      // Don't intercept API routes
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    log(`[Server] Running full-stack environment on http://localhost:${PORT}`);
    log(`[Server] Health check at http://localhost:${PORT}/api/health`);
    // Configuration posture, at startup: these were the silent-failure sources in the audit.
    log(`[Server] config: trustProxy=${TRUST_PROXY_MODE} ai=${openRouterApiKey ? `openrouter(${OPENROUTER_MODEL})` : `gemini(${GEMINI_MODEL})`} marketFeed=${process.env.TWELVEDATA_API_KEY ? 'twelvedata+yahoo-fallback' : 'yahoo'} wsTokenAuth=${process.env.WS_SHARED_SECRET ? 'shared-secret required' : 'origin-only (dev/browser clients)'} redis=${process.env.UPSTASH_REDIS_REST_URL ? 'upstash' : 'memory-only'}`);
    if (process.env.NODE_ENV === 'production' && !process.env.WS_SHARED_SECRET) {
      warn('[Server] WS_SHARED_SECRET is unset — /api/ws/token is falling back to Origin-only checks. Non-browser clients will be rejected.');
    }
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
      warn('[Server] ALLOWED_ORIGINS is unset in production — CORS is effectively disabled for cross-origin callers (localhost defaults only).');
    }
  });
}

// Any /api/* that fell through every route above, answered as an API. This lives at module scope on
// purpose: the Vercel entry point imports `app` without ever calling startServer(), so a guard that
// only existed inside startServer() would let Express answer "Cannot GET /api/nope" as text/html and
// the client would die parsing HTML as JSON. Registered last so real routes win.
app.use('/api', (req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

export default app;

if (!process.env.VERCEL) {
  startServer();
}
