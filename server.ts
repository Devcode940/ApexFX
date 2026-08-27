import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- Live Server Watchlist and WebSocket Streaming ---
const PAIRS_CONFIG_WS: Record<string, { name: string; pipDecimal: number }> = {
  'EURUSD': { name: 'EUR / USD', pipDecimal: 4 },
  'GBPUSD': { name: 'GBP / USD', pipDecimal: 4 },
  'USDJPY': { name: 'USD / JPY', pipDecimal: 2 },
  'AUDUSD': { name: 'AUD / USD', pipDecimal: 4 },
  'USDCAD': { name: 'USD / CAD', pipDecimal: 4 },
  'GBPJPY': { name: 'GBP / JPY', pipDecimal: 2 },
  'XAUUSD': { name: 'Gold / USD', pipDecimal: 2 },
  'XAGUSD': { name: 'Silver / USD', pipDecimal: 4 },
};

// Watchlist starts empty (no placeholder/fake prices); real quotes are filled
// in by fetchRealLatestPrices() immediately on server start.
const serverWatchlist = Object.keys(PAIRS_CONFIG_WS).map(symbol => {
  const config = PAIRS_CONFIG_WS[symbol];
  return {
    symbol,
    name: config.name,
    price: 0,
    change: 0,
    high: 0,
    low: 0,
  };
});

// --- Twelve Data integration (primary market source when TWELVEDATA_API_KEY is set) ---
const TD_SYMBOLS: Record<string, string> = {
  'EURUSD': 'EUR/USD',
  'GBPUSD': 'GBP/USD',
  'USDJPY': 'USD/JPY',
  'AUDUSD': 'AUD/USD',
  'USDCAD': 'USD/CAD',
  'GBPJPY': 'GBP/JPY',
  'XAUUSD': 'XAU/USD',
  'XAGUSD': 'XAG/USD',
};
const tdApiKey = process.env.TWELVEDATA_API_KEY;
// When Twelve Data returns 429 (per-minute credit limit reached), REST work
// pauses until the next minute; the WebSocket stream keeps delivering ticks
// at no API credit cost.
let tdRESTCooldownUntil = 0;
// REST quote costs 1 API credit per symbol (8 for the full watchlist). Free tier
// allows 8 credits/minute and 800/day. Default the OHLC/change sync to 15 min
// (8 credits per call = ~96/day, well under the 800/day cap); the WebSocket
// stream covers tick-level updates at no API credit cost. Paid plans can lower
// this via TWELVEDATA_QUOTE_SYNC_MS.
const TD_QUOTE_SYNC_MS = Number(process.env.TWELVEDATA_QUOTE_SYNC_MS) || 900_000;
// REST polling interval used when the WebSocket stream is not delivering ticks.
const TD_POLL_MS = Number(process.env.TWELVEDATA_POLL_MS) || 15_000;

/** Refresh the watchlist from the Twelve Data REST quote endpoint (all 8 symbols in one request). */
async function fetchTwelveDataQuotes(): Promise<Set<string>> {
  const applied = new Set<string>();
  if (!tdApiKey) return applied;
  try {
    const symbols = Object.values(TD_SYMBOLS).join(',');
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${tdApiKey}`);
    const raw = await res.json();
    if (raw?.code) {
      console.error('[TwelveData] quote error:', raw?.message || `code ${raw?.code}`);
      if (raw.code === 429) tdRESTCooldownUntil = Date.now() + 60_000;
      return applied;
    }
    // Response shapes: a single-symbol response carries a `symbol` key with the
    // quote fields at the top level; a multi-symbol response uses the symbols
    // themselves as top-level keys (no `data` wrapper, no `status` field).
    const data: Record<string, any> = {};
    if (raw?.symbol && typeof raw.close !== 'undefined') {
      data[raw.symbol] = raw;
    } else {
      for (const s of Object.values(TD_SYMBOLS)) {
        if (raw?.[s] && typeof raw[s] === 'object' && typeof raw[s].close !== 'undefined') data[s] = raw[s];
      }
    }
    if (Object.keys(data).length === 0) return applied;

    for (const item of serverWatchlist) {
      const tdSymbol = TD_SYMBOLS[item.symbol];
      const q = tdSymbol ? data[tdSymbol] : null;
      if (!q) continue;
      const close = parseFloat(q.close);
      if (!isFinite(close) || close <= 0) continue;
      const high = parseFloat(q.high);
      const low = parseFloat(q.low);
      const pct = parseFloat(q.percent_change);
      const config = PAIRS_CONFIG_WS[item.symbol];
      item.price = parseFloat(close.toFixed(config.pipDecimal + 1));
      if (isFinite(high) && high > 0) item.high = parseFloat(high.toFixed(config.pipDecimal + 1));
      else item.high = Math.max(item.high, item.price);
      if (isFinite(low) && low > 0) item.low = parseFloat(low.toFixed(config.pipDecimal + 1));
      else item.low = item.low > 0 ? Math.min(item.low, item.price) : item.price;
      if (isFinite(pct)) item.change = parseFloat(pct.toFixed(2));
      applied.add(item.symbol);
    }
  } catch (e) {
    console.error('[TwelveData] quote fetch failed:', (e as Error).message);
  }
  return applied;
}

/** Yahoo Finance fallback for a subset of the watchlist (used when Twelve Data is unavailable). */
async function fetchYahooPricesFor(items: typeof serverWatchlist) {
  const symbolsMap: Record<string, string> = {
    'EURUSD': 'EURUSD=X',
    'GBPUSD': 'GBPUSD=X',
    'USDJPY': 'USDJPY=X',
    'AUDUSD': 'AUDUSD=X',
    'USDCAD': 'USDCAD=X',
    'GBPJPY': 'GBPJPY=X',
    'XAUUSD': 'XAUUSD=X',
    // Twelve Data free plans don't include XAG/USD and Yahoo has no XAGUSD=X
    // spot feed — COMEX silver futures (SI=F) is the real-data fallback.
    'XAGUSD': 'SI=F',
  };

  // Fetch in parallel so a serverless cold start doesn't serialize 8 upstream calls.
  await Promise.all(items.map(async (item) => {
    try {
      const ticker = symbolsMap[item.symbol] || `${item.symbol}=X`;
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const result = data?.chart?.result?.[0];
        const meta = result?.meta;
        const currentPrice = meta?.regularMarketPrice || result?.indicators?.quote?.[0]?.close?.filter((c: any) => c !== null).pop();
        if (currentPrice) {
          const config = PAIRS_CONFIG_WS[item.symbol];
          item.price = parseFloat(currentPrice.toFixed(config.pipDecimal + 1));
          item.high = parseFloat((meta?.high || Math.max(item.high, currentPrice)).toFixed(config.pipDecimal + 1));
          // First real quote: seed the low with the current price instead of 0
          item.low = parseFloat((meta?.low || (item.low > 0 ? Math.min(item.low, currentPrice) : currentPrice)).toFixed(config.pipDecimal + 1));
          const prevClose = meta?.chartPreviousClose || currentPrice;
          item.change = parseFloat((((currentPrice - prevClose) / prevClose) * 100).toFixed(2));
        }
      }
    } catch (e) {
      console.error(`Failed to fetch real price for ${item.symbol}:`, e);
    }
  }));
}

/** Live source dispatcher: Twelve Data first, Yahoo as a per-symbol fallback. */
async function fetchRealLatestPrices() {
  if (tdApiKey) {
    const applied = await fetchTwelveDataQuotes();
    // Any instrument Twelve Data didn't cover (invalid key, rate limit, or a
    // plan without metals) is fetched from Yahoo so the feed never goes stale.
    const remaining = serverWatchlist.filter((i) => !applied.has(i.symbol));
    if (remaining.length > 0) {
      await fetchYahooPricesFor(remaining);
    }
    return;
  }
  await fetchYahooPricesFor(serverWatchlist);
}

/** Twelve Data WebSocket stream: low-latency ticks (WS credits, not API credits). */
let tdWs: WebSocket | null = null;
let tdWsReconnectTimer: NodeJS.Timeout | null = null;
let tdWsHeartbeatTimer: NodeJS.Timeout | null = null;
let tdWsLastPriceAt = 0;

function startTwelveDataStream() {
  if (!tdApiKey || tdWs || process.env.VERCEL) return;
  try {
    tdWs = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${tdApiKey}`);
    tdWs.on('open', () => {
      console.log('[TwelveData] WebSocket stream connected.');
      tdWs?.send(JSON.stringify({ action: 'subscribe', params: { symbols: Object.values(TD_SYMBOLS).join(',') } }));
      tdWsHeartbeatTimer = setInterval(() => {
        try { tdWs?.send(JSON.stringify({ action: 'heartbeat' })); } catch { /* ignore */ }
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
        // `subscribe-status` events are informational; ignore them.
      } catch { /* ignore malformed frames */ }
    });
    tdWs.on('error', (err) => {
      console.warn('[TwelveData] WebSocket error:', (err as Error).message || 'connection failed');
    });
    tdWs.on('close', () => {
      console.warn('[TwelveData] WebSocket closed — REST polling fallback is active.');
      if (tdWsHeartbeatTimer) { clearInterval(tdWsHeartbeatTimer); tdWsHeartbeatTimer = null; }
      tdWs = null;
      scheduleTdWsReconnect();
    });
  } catch (e) {
    console.warn('[TwelveData] WebSocket setup failed:', (e as Error).message);
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

/** One full Twelve Data sync cycle (REST quote + per-symbol Yahoo fallback + broadcast). */
let tdSyncInFlight = false;
async function tdSyncOnce() {
  if (tdSyncInFlight) return;
  if (Date.now() < tdRESTCooldownUntil) return; // credits resetting — WebSocket still streams ticks
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

/** Twelve Data historical candles for a symbol/timeframe, or null to fall back to Yahoo. */
const TD_INTERVALS: Record<string, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '1H': '1h', '4H': '4h', 'D': '1day',
};
async function fetchTwelveDataHistory(symbol: string, timeframe: string) {
  if (!tdApiKey) return null;
  const tdInterval = TD_INTERVALS[timeframe];
  const tdSymbol = TD_SYMBOLS[symbol];
  if (!tdInterval || !tdSymbol) return null;
  try {
    const res = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${tdInterval}&outputsize=800&timezone=UTC&order=asc&apikey=${tdApiKey}`
    );
    const raw = await res.json();
    if (raw?.status === 'error' || raw?.code || !Array.isArray(raw.values)) {
      console.warn('[TwelveData] time_series error:', raw?.message || raw?.code || 'no values');
      if (raw?.code === 429) tdRESTCooldownUntil = Date.now() + 60_000;
      return null;
    }
    const candles = raw.values
      .map((v: any) => {
        const time = Date.parse(`${String(v.datetime).replace(' ', 'T')}Z`) / 1000;
        const open = parseFloat(v.open);
        const high = parseFloat(v.high);
        const low = parseFloat(v.low);
        const close = parseFloat(v.close);
        if (!isFinite(time) || !isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close) || open <= 0) return null;
        return { time, open, high, low, close, volume: Math.floor(parseFloat(v.volume) || 0) };
      })
      .filter((c: any) => c !== null);
    if (candles.length === 0) {
      console.warn('[TwelveData] time_series returned no valid candles');
      return null;
    }
    return { success: true, symbol, timeframe, data: candles };
  } catch (e) {
    console.warn('[TwelveData] time_series fetch failed:', (e as Error).message);
    return null;
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
    timestamp: new Date().toISOString()
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Only run the persistent streaming loop on Node hosts. On Vercel (serverless),
// these module-level timers would spin up on every cold import — the stateless
// HTTP endpoints remain available and the client falls back to polling.
if (!process.env.VERCEL) {
  // Initial sync on server start
  fetchRealLatestPrices().then(() => {
    console.log('[Server] Successfully synchronized initial real Forex and Commodity quotes.');
    broadcastPrices();
  });

  if (tdApiKey) {
    // Primary low-latency feed: Twelve Data WebSocket ticks.
    startTwelveDataStream();
    // Slow REST refresh for OHLC/change (8 API credits per full watchlist sync).
    setInterval(tdSyncOnce, TD_QUOTE_SYNC_MS);
    // REST polling fallback whenever the WebSocket is not delivering ticks.
    setInterval(() => {
      const stale = Date.now() - tdWsLastPriceAt > 30_000;
      if (stale || !tdWs) tdSyncOnce();
    }, TD_POLL_MS);
  } else {
    // No Twelve Data key: Yahoo Finance is the single live source, polled every 5s.
    setInterval(() => {
      fetchRealLatestPrices().then(() => {
        broadcastPrices();
      });
    }, 5000);
  }
}

wss.on('connection', (ws) => {
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
    timestamp: new Date().toISOString()
  });
  ws.send(initialPayload);
});

app.use(express.json());

// Initialize Gemini API client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// OpenRouter: alternative AI provider (OpenAI-compatible). When OPENROUTER_API_KEY
// is set, /api/chat routes through OpenRouter instead of Gemini.
const OPENROUTER_KEY_CANDIDATE = process.env.OPENROUTER_API_KEY;
// Only treat OpenRouter as configured when the key looks like a real OpenRouter
// key (sk-or-v1-...). Placeholders/truncated values are ignored so the app falls
// back to Gemini instead of failing on a bad key.
const openRouterApiKey = OPENROUTER_KEY_CANDIDATE?.startsWith('sk-or-') ? OPENROUTER_KEY_CANDIDATE : undefined;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/auto';

/** Convert Gemini-style contents [{role, parts:[{text}|{inlineData}]}] to OpenAI chat messages. */
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

/** Generate a chat completion via OpenRouter (OpenAI-compatible chat completions API). */
async function generateOpenRouter(system: string, contents: any[]) {
  const messages = [{ role: 'system', content: system }, ...toOpenRouterMessages(contents)];
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://localhost:3000',
      'X-Title': 'ApexFX',
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages, max_tokens: 1024 }),
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
    const response = await fetch('https://api.frankfurter.app/latest?from=USD');
    if (!response.ok) {
      throw new Error(`Frankfurter API returned status ${response.status}`);
    }
    const data = await response.json();
    
    // Map rates to standard currency pairs
    // base: USD, rates: { EUR: 0.9324, JPY: 158.45, GBP: 0.7891, ... }
    const r = data.rates || {};
    
    // Convert to standard formats:
    // EURUSD = 1 / EUR
    // GBPUSD = 1 / GBP
    // AUDUSD = 1 / AUD
    // USDJPY = JPY
    // USDCAD = CAD
    // USDCHF = CHF
    const eurRates = r.EUR ? parseFloat((1 / r.EUR).toFixed(5)) : null;
    const gbpRates = r.GBP ? parseFloat((1 / r.GBP).toFixed(5)) : null;
    const audRates = r.AUD ? parseFloat((1 / r.AUD).toFixed(5)) : null;
    const jpyRates = r.JPY ? parseFloat(r.JPY.toFixed(3)) : null;
    const cadRates = r.CAD ? parseFloat(r.CAD.toFixed(5)) : null;
    const gbpjpyRates = (r.GBP && r.JPY) ? parseFloat((r.JPY / r.GBP).toFixed(3)) : null;

    res.json({
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
      }
    });
  } catch (error: any) {
    res.json({
      success: false,
      error: error.message || 'Failed to fetch live rates',
    });
  }
});

// Watchlist Live Prices API Endpoint (HTTP Fallback)
let lastPriceFetchTs = 0;
const PRICE_FETCH_CACHE_MS = 4000;
app.get('/api/market/prices', async (req, res) => {
  try {
    // On serverless (Vercel) the streaming loop doesn't run, so the watchlist is
    // only filled on demand. Use a short TTL cache and the free Yahoo path (not
    // Twelve Data) so each client poll request doesn't drain REST credits.
    if (process.env.VERCEL && Date.now() - lastPriceFetchTs > PRICE_FETCH_CACHE_MS) {
      await fetchYahooPricesFor(serverWatchlist);
      lastPriceFetchTs = Date.now();
    }
    res.json({
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
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch market prices', detail: (e as Error).message });
  }
});

// 4. REAL HISTORICAL CHART DATA API (Yahoo Finance)
app.get('/api/market/history', async (req, res) => {
  try {
    const { symbol, timeframe } = req.query;
    if (!symbol || !timeframe) {
      return res.status(400).json({ error: 'Symbol and timeframe are required' });
    }

    const symbolsMap: Record<string, string> = {
      'EURUSD': 'EURUSD=X',
      'GBPUSD': 'GBPUSD=X',
      'USDJPY': 'USDJPY=X',
      'AUDUSD': 'AUDUSD=X',
      'USDCAD': 'USDCAD=X',
      'GBPJPY': 'GBPJPY=X',
      'XAUUSD': 'XAUUSD=X',
      'XAGUSD': 'XAGUSD=X',
    };

    const ticker = symbolsMap[symbol as string] || `${symbol}=X`;

    // Twelve Data is the primary history source when an API key is configured;
    // fall through to Yahoo Finance on any failure.
    if (tdApiKey) {
      const tdResult = await fetchTwelveDataHistory(symbol as string, timeframe as string);
      if (tdResult) return res.json(tdResult);
    }

    // Map timeframe to Yahoo Finance interval and range
    let interval = '1h';
    let range = '30d';

    switch (timeframe) {
      case '1m':
        interval = '1m';
        range = '2d'; // 2 days of 1-minute data
        break;
      case '5m':
        interval = '5m';
        range = '5d';
        break;
      case '15m':
        interval = '15m';
        range = '10d';
        break;
      case '1H':
        interval = '1h';
        range = '60d';
        break;
      case '4H':
        // Fetch 1h and aggregate to 4H
        interval = '1h';
        range = '120d';
        break;
      case 'D':
        interval = '1d';
        range = '365d';
        break;
      default:
        interval = '1h';
        range = '60d';
    }

    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance returned status ${response.status}`);
    }

    const data = await response.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) {
      throw new Error('Invalid response structure from Yahoo Finance');
    }

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    let candlesticks: any[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      const v = volumes[i] || 0;

      if (t !== undefined && o !== null && h !== null && l !== null && c !== null && o !== undefined && h !== undefined && l !== undefined && c !== undefined) {
        candlesticks.push({
          time: t,
          open: parseFloat(o.toFixed(5)),
          high: parseFloat(h.toFixed(5)),
          low: parseFloat(l.toFixed(5)),
          close: parseFloat(c.toFixed(5)),
          volume: Math.floor(v),
        });
      }
    }

    // If 4H is requested, aggregate hourly data to 4H candles
    if (timeframe === '4H') {
      const aggregated: any[] = [];
      // Group hourly candles in 4-hour chunks (14400 seconds)
      for (let i = 0; i < candlesticks.length; i += 4) {
        const chunk = candlesticks.slice(i, i + 4);
        if (chunk.length === 0) continue;
        const open = chunk[0].open;
        const close = chunk[chunk.length - 1].close;
        const high = Math.max(...chunk.map(c => c.high));
        const low = Math.min(...chunk.map(c => c.low));
        const volume = chunk.reduce((sum, c) => sum + (c.volume || 0), 0);
        const time = chunk[0].time;
        aggregated.push({ time, open, high, low, close, volume });
      }
      candlesticks = aggregated;
    }

    res.json({
      success: true,
      symbol,
      timeframe,
      data: candlesticks,
    });
  } catch (error: any) {
    console.error('Failed to fetch historical data from Yahoo:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch historical data',
    });
  }
});

// --- /api/chat guardrails: rate limiting + payload caps ---
const chatRateBuckets = new Map<string, number[]>();
const CHAT_MAX_PER_WINDOW = 10;
const CHAT_WINDOW_MS = 60_000;
const CHAT_MAX_HISTORY = 30;
const CHAT_MAX_MESSAGE_LEN = 8000;
const CHAT_TIMEOUT_MS = 45_000;

function isChatRateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - CHAT_WINDOW_MS;
  const hits = (chatRateBuckets.get(key) || []).filter((t) => t > cutoff);
  if (hits.length === 0) {
    chatRateBuckets.delete(key);
    return false;
  }
  if (hits.length >= CHAT_MAX_PER_WINDOW) {
    chatRateBuckets.set(key, hits);
    return true;
  }
  hits.push(now);
  chatRateBuckets.set(key, hits);
  return false;
}

// 2. REAL AI API: Real Gemini model chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, selectedSymbol, selectedTimeframe, activeSignal } = req.body;

    if (!ai && !openRouterApiKey) {
      return res.status(500).json({
        error: 'No AI provider configured. Set OPENROUTER_API_KEY or GEMINI_API_KEY in Settings > Secrets.',
      });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid or missing messages array.' });
    }

    // Rate limit by client IP (cheap in-memory sliding window)
    const clientKey =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    if (isChatRateLimited(clientKey)) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }

    // Cap history length and per-message size
    const recent = messages.slice(-CHAT_MAX_HISTORY);
    for (const m of recent) {
      if (typeof m.text !== 'string' || m.text.length > CHAT_MAX_MESSAGE_LEN) {
        return res.status(400).json({ error: `Message too long (maximum ${CHAT_MAX_MESSAGE_LEN} characters).` });
      }
    }

    // Format prompt context
    const contextStr = `
You are the ApexFX AI Analyst (AI Co-Pilot Strategist) in a professional trading platform.
Current active instrument: ${selectedSymbol}
Active timeframe: ${selectedTimeframe}
Latest analytical consensus signal: ${activeSignal ? JSON.stringify(activeSignal) : 'None'}

Provide professional, accurate, and insightful trading or analysis answers. Use clean markdown formatting. Keep answers concise, highly specific, and focused on technical/fundamental aspects of forex trading. Use the exact symbol's pip and price characteristics in your explanations.
`;

    // Send the full conversation history so the model keeps multi-turn context.
    // Attach any inline chart snapshot to the user message that carries it.
    const contents = recent
      .map((m: any) => {
        const parts: any[] = [];
        if (m.image) {
          const imgStr = String(m.image);
          const matches = imgStr.match(/^data:([^;]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
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
          parts.push({ text });
        }
        return { role: m.sender === 'user' ? 'user' : 'model', parts };
      })
      .filter((c: any) => c.parts.length > 0);

    if (contents.length === 0) {
      return res.status(400).json({ error: 'No usable message content.' });
    }

    // Gemini requires the first turn to come from the user role
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
          model: 'gemini-3.5-flash',
          contents,
          config: { systemInstruction: contextStr },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini request timed out after ${CHAT_TIMEOUT_MS / 1000}s.`)), CHAT_TIMEOUT_MS)
        ),
      ]);
      text = result.text || "I apologize, but I couldn't generate a response. Please try again.";
    }

    res.json({ text });
  } catch (error: any) {
    console.error('AI error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred while communicating with the AI provider.',
    });
  }
});

// 3. REAL MARKET DATA APIs (Proxies to hide API keys)

// Finnhub News API Proxy
app.get('/api/market/news', async (req, res) => {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'FINNHUB_API_KEY is not configured. Please add it to your secrets.' });
    }
    const { category = 'forex' } = req.query;
    const response = await fetch(`https://finnhub.io/api/v1/news?category=${category}&token=${apiKey}`);
    if (!response.ok) throw new Error('Failed to fetch from Finnhub');
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Twelve Data Quote Proxy
app.get('/api/market/quote', async (req, res) => {
  try {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'TWELVEDATA_API_KEY is not configured. Please add it to your secrets.' });
    }
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
    const response = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${apiKey}`);
    if (!response.ok) throw new Error('Failed to fetch from Twelve Data');
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ForexRate API Proxy
app.get('/api/market/forexrate', async (req, res) => {
  try {
    const apiKey = process.env.FOREXRATE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'FOREXRATE_API_KEY is not configured. Please add it to your secrets.' });
    }
    const { base = 'USD' } = req.query;
    const response = await fetch(`https://api.forexrateapi.com/v1/latest?api_key=${apiKey}&base=${base}`);
    if (!response.ok) throw new Error('Failed to fetch from ForexRate API');
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running full-stack environment on http://localhost:${PORT}`);
  });
}

export default app;

if (!process.env.VERCEL) {
  startServer();
}

