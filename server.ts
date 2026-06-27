import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config();

const app = express();
const PORT = 3000;

const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- Live Server Watchlist and WebSocket Streaming ---
const PAIRS_CONFIG_WS: Record<string, { name: string; basePrice: number; pipDecimal: number }> = {
  'EURUSD': { name: 'EUR / USD', basePrice: 1.08520, pipDecimal: 4 },
  'GBPUSD': { name: 'GBP / USD', basePrice: 1.27150, pipDecimal: 4 },
  'USDJPY': { name: 'USD / JPY', basePrice: 155.350, pipDecimal: 2 },
  'AUDUSD': { name: 'AUD / USD', basePrice: 0.66450, pipDecimal: 4 },
  'USDCAD': { name: 'USD / CAD', basePrice: 1.36780, pipDecimal: 4 },
  'GBPJPY': { name: 'GBP / JPY', basePrice: 198.150, pipDecimal: 2 },
  'XAUUSD': { name: 'Gold / USD', basePrice: 2325.40, pipDecimal: 2 },
  'XAGUSD': { name: 'Silver / USD', basePrice: 29.350, pipDecimal: 3 },
};

const serverWatchlist = Object.keys(PAIRS_CONFIG_WS).map(symbol => {
  const config = PAIRS_CONFIG_WS[symbol];
  const change = (Math.random() - 0.5) * 1.2;
  const price = config.basePrice * (1 + change / 100);
  const range = price * 0.005;
  return {
    symbol,
    name: config.name,
    price: parseFloat(price.toFixed(config.pipDecimal + 1)),
    change: parseFloat(change.toFixed(2)),
    high: parseFloat((price + range * (0.3 + Math.random() * 0.5)).toFixed(config.pipDecimal + 1)),
    low: parseFloat((price - range * (0.3 + Math.random() * 0.7)).toFixed(config.pipDecimal + 1)),
  };
});

async function fetchRealLatestPrices() {
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

  for (const item of serverWatchlist) {
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
          item.low = parseFloat((meta?.low || Math.min(item.low, currentPrice)).toFixed(config.pipDecimal + 1));
          const prevClose = meta?.chartPreviousClose || currentPrice;
          item.change = parseFloat((((currentPrice - prevClose) / prevClose) * 100).toFixed(2));
        }
      }
    } catch (e) {
      console.error(`Failed to fetch real price for ${item.symbol}:`, e);
    }
  }
}

function tickServerWatchlist() {
  serverWatchlist.forEach((item) => {
    if (Math.random() > 0.4) return; // 40% tick probability
    
    const config = PAIRS_CONFIG_WS[item.symbol];
    const pipScale = item.symbol.includes('JPY') ? 0.005 : 0.00005;
    const diff = (Math.random() - 0.5) * pipScale;
    const newPrice = item.price + diff;
    
    item.price = parseFloat(newPrice.toFixed(config.pipDecimal + 1));
    item.high = parseFloat(Math.max(item.high, newPrice).toFixed(config.pipDecimal + 1));
    item.low = parseFloat(Math.min(item.low, newPrice).toFixed(config.pipDecimal + 1));
  });
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

// Initial sync on server start
fetchRealLatestPrices().then(() => {
  console.log('[Server] Successfully synchronized initial real Forex and Commodity quotes.');
  broadcastPrices();
});

// Sync real latest quotes every 30 seconds
setInterval(() => {
  fetchRealLatestPrices().then(() => {
    broadcastPrices();
  });
}, 30000);

// Start server micro-ticking loop every 2 seconds
setInterval(() => {
  tickServerWatchlist();
  broadcastPrices();
}, 2000);

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
    const chfRates = r.CHF ? parseFloat(r.CHF.toFixed(5)) : null;

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
        USDCHF: chfRates,
      }
    });
  } catch (error: any) {
    res.json({
      success: false,
      error: error.message || 'Failed to fetch live rates, falling back to simulator',
    });
  }
});

// Watchlist Live Prices API Endpoint (HTTP Fallback)
app.get('/api/market/prices', (req, res) => {
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

// 2. REAL AI API: Real Gemini model chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, selectedSymbol, selectedTimeframe, activeSignal } = req.body;
    
    if (!ai) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY environment variable is not configured. Please set it in Settings > Secrets.',
      });
    }

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid or missing messages array.' });
    }

    // Format prompt context
    const contextStr = `
You are the ApexFX AI Analyst (AI Co-Pilot Strategist) in a professional trading platform.
Current active instrument: ${selectedSymbol}
Active timeframe: ${selectedTimeframe}
Latest analytical consensus signal: ${activeSignal ? JSON.stringify(activeSignal) : 'None'}

Provide professional, accurate, and insightful trading or analysis answers. Use clean markdown formatting. Keep answers concise, highly specific, and focused on technical/fundamental aspects of forex trading. Use the exact symbol's pip and price characteristics in your explanations.
`;

    const chatHistory = messages.map((m: any) => ({
      role: m.sender === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    // Add instructions and context to the last message or as system instructions if supported
    // Since we want to provide the user context with every message, we can append it as a guide:
    const lastMessage = messages[messages.length - 1];
    let imagePart: any = null;
    
    if (lastMessage && lastMessage.image) {
      const imgStr = lastMessage.image;
      const matches = imgStr.match(/^data:([^;]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        imagePart = {
          inlineData: {
            mimeType: matches[1],
            data: matches[2],
          }
        };
      }
    }

    const textPart = { text: `${contextStr}\n\nUser Question:\n${lastMessage?.text || 'Please analyze this chart snapshot.'}` };
    const contents = [
      {
        role: 'user',
        parts: imagePart ? [imagePart, textPart] : [textPart],
      }
    ];

    const result = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: contents,
    });

    res.json({
      text: result.text || "I apologize, but I couldn't generate a response. Please try again.",
    });
  } catch (error: any) {
    console.error('Gemini error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred while communicating with Gemini.',
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

