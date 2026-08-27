import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';

// Modular imports
import { log, warn, error as logError } from './server/lib/logger.js';
import { fetchWithTimeout } from './server/lib/fetch.js';
import { isRateLimited, isRateLimitedSync, isChatRateLimited } from './server/lib/rateLimit.js';
import { securityHeadersMiddleware, getAllowedOrigins, validateSymbolFormat, sanitizeClientIp } from './server/lib/security.js';
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
} from './server/services/market.js';
import { fetchMarketHistory } from './server/services/yahoo.js';

dotenv.config();

const app = express();
const PORT = (() => {
  const raw = process.env.PORT;
  const parsed = raw ? parseInt(raw, 10) : 3000;
  if (isNaN(parsed) || parsed <= 0 || parsed > 65535) return 3000;
  return parsed;
})();

const server = createServer(app);

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

// --- WebSocket auth tokens with hardening ---
const wsAuthTokens = new Map<string, { createdAt: number; ip: string }>();
const WS_TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 min
const WS_TOKEN_RATE_LIMIT_MAX = 10;
const WS_TOKEN_RATE_LIMIT_WINDOW = 60_000;

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
async function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const clientKey = sanitizeClientIp(req);
  const limited = await isRateLimited(clientKey);
  if (limited) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
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
    tdWs = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price`, {
      headers: {
        Authorization: `Bearer ${tdApiKey}`,
        'User-Agent': 'ApexFX-Terminal/1.0 (Production)',
      },
    } as any);
    tdWs.on('open', () => {
      log('[TwelveData] WebSocket stream connected.');
      tdWs?.send(JSON.stringify({ action: 'subscribe', params: { symbols: Object.values(TD_SYMBOLS).join(',') } }));
      tdWsHeartbeatTimer = setInterval(() => {
        try {
          tdWs?.send(JSON.stringify({ action: 'heartbeat' }));
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
  fetchRealLatestPrices().then(() => {
    log('[Server] Successfully synchronized initial real Forex and Commodity quotes.');
    broadcastPrices();
  });

  const tdApiKey = process.env.TWELVEDATA_API_KEY;
  if (tdApiKey) {
    startTwelveDataStream();
    setInterval(tdSyncOnce, getQuoteSyncMs());
    setInterval(() => {
      const stale = Date.now() - tdWsLastPriceAt > 30_000;
      if (stale || !tdWs) tdSyncOnce();
    }, getPollMs());
  } else {
    setInterval(() => {
      fetchRealLatestPrices().then(() => {
        broadcastPrices();
      });
    }, 5000);
  }
}

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    watchlist: serverWatchlist.length,
    wsClients: wss.clients.size,
    env: process.env.NODE_ENV || 'development',
  });
});

// --- Secured WS token endpoint ---
app.get('/api/ws/token', async (req, res) => {
  const clientIp = sanitizeClientIp(req);

  // Rate limit token issuance
  if (isRateLimitedSync(`ws_token:${clientIp}`, WS_TOKEN_RATE_LIMIT_MAX, WS_TOKEN_RATE_LIMIT_WINDOW)) {
    return res.status(429).json({ error: 'Too many token requests. Please wait.' });
  }

  // If WS_SHARED_SECRET is set, require it
  const requiredSecret = process.env.WS_SHARED_SECRET;
  if (requiredSecret) {
    const provided = (req.headers['x-ws-secret'] as string) || (req.query.secret as string);
    if (!provided || provided !== requiredSecret) {
      return res.status(403).json({ error: 'Invalid or missing WS secret' });
    }
  } else if (process.env.NODE_ENV === 'production') {
    // In prod without shared secret, require origin to be allowed
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
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

app.use(express.json({ limit: '1mb' }));

// Apply rate limiting to ALL /api/* routes (no exceptions) - async version
app.use('/api', (req, res, next) => {
  rateLimitMiddleware(req, res, next).catch(next);
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
  } catch (e) {
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

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, selectedSymbol, selectedTimeframe, activeSignal } = req.body;

    if (!ai && !openRouterApiKey) {
      return res.status(500).json({
        error: 'AI service unavailable',
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
    const safeSymbol = typeof selectedSymbol === 'string' ? selectedSymbol.replace(/[^A-Z0-9\/]/g, '').slice(0, 20) : 'EURUSD';
    const safeTimeframe = typeof selectedTimeframe === 'string' && ['1m','5m','15m','1H','4H','D'].includes(selectedTimeframe) ? selectedTimeframe : '1H';

    const contextStr = `
You are the ApexFX AI Analyst (AI Co-Pilot Strategist) in a professional trading platform.
Current active instrument: ${safeSymbol}
Active timeframe: ${safeTimeframe}
Latest analytical consensus signal: ${activeSignal ? JSON.stringify(activeSignal).slice(0, 2000) : 'None'}

Provide professional, accurate, and insightful trading or analysis answers. Use clean markdown formatting. Keep answers concise, highly specific, and focused on technical/fundamental aspects of forex trading. Use the exact symbol's pip and price characteristics in your explanations.

DISCLAIMER: These are experimental heuristic estimates, not financial advice. Win rates and profit factors shown elsewhere in the platform are heuristic estimates, not backtested results.
`;

    const contents = recent
      .map((m: any) => {
        const parts: any[] = [];
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
      .filter((c: any) => c && c.parts.length > 0);

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
    } else {
      const result = await Promise.race([
        ai!.models.generateContent({
          model: 'gemini-2.0-flash',
          contents,
          config: { systemInstruction: contextStr },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini request timed out after ${CHAT_TIMEOUT_MS / 1000}s.`)), CHAT_TIMEOUT_MS)
        ),
      ]);
      text = (result as any).text || "I apologize, but I couldn't generate a response. Please try again.";
    }

    res.json({ text });
  } catch (e: any) {
    logError('AI error:', e);
    res.status(500).json({
      error: 'An error occurred while processing your request.',
    });
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
    const response = await fetchWithTimeout(`https://finnhub.io/api/v1/news?category=${encodeURIComponent(category)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      timeoutMs: 6000,
    });
    if (!response.ok) throw new Error('Failed to fetch from Finnhub');
    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to fetch market news' });
  }
});

// Twelve Data Quote Proxy
app.get('/api/market/quote', async (req, res) => {
  try {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Service unavailable' });
    }
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
    if (!validateSymbolFormat(symbol as string, true)) {
      return res.status(400).json({ error: 'Invalid symbol format' });
    }
    const response = await fetchWithTimeout(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol as string)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeoutMs: 6000,
      }
    );
    if (!response.ok) throw new Error('Failed to fetch from Twelve Data');
    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to fetch market quote' });
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
    const response = await fetchWithTimeout(`https://api.forexrateapi.com/v1/latest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base: base || 'USD' }),
      timeoutMs: 6000,
    });
    if (!response.ok) throw new Error('Failed to fetch from ForexRate API');
    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to fetch forex rate' });
  }
});

// Vite middleware or production serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
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
  });
}

export default app;

if (!process.env.VERCEL) {
  startServer();
}
