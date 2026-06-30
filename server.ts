import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { PAIRS_CONFIG } from './src/constants/config';

// ============================================================================
// Environment Configuration & Validation
// ============================================================================

dotenv.config({ override: true });

const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  TWELVEDATA_API_KEY: process.env.TWELVEDATA_API_KEY,
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,
  FOREXRATE_API_KEY: process.env.FOREXRATE_API_KEY,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
} as const;

const isProduction = ENV.NODE_ENV === 'production';

// ============================================================================
// Logger Configuration
// ============================================================================

const logger = pino({
  level: isProduction ? 'info' : 'debug',
  transport: isProduction ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true },
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Validate required environment variables
function validateEnvironment(): void {
  if (!ENV.TWELVEDATA_API_KEY) {
    logger.error('TWELVEDATA_API_KEY is required for live market data');
    process.exit(1);
  }

  if (!ENV.GEMINI_API_KEY) {
    logger.warn('GEMINI_API_KEY not set - AI chat will be unavailable');
  }
  if (!ENV.FINNHUB_API_KEY) {
    logger.warn('FINNHUB_API_KEY not set - news feed will be unavailable');
  }
}

validateEnvironment();

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// ============================================================================
// Security & Performance Middleware
// ============================================================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:", "https://api.twelvedata.com", "https://finnhub.io"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
}));

// Compression
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024,
}));

// CORS
app.use(cors({
  origin: ENV.CORS_ORIGIN === '*' ? true : ENV.CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: ENV.RATE_LIMIT_WINDOW_MS,
  max: ENV.RATE_LIMIT_MAX_REQUESTS,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
    retryAfter: Math.ceil(ENV.RATE_LIMIT_WINDOW_MS / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to API routes
app.use('/api/', limiter);

// Stricter rate limit for AI chat (expensive operations)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: {
    success: false,
    error: 'AI chat rate limit exceeded. Please wait before sending another message.',
    retryAfter: 60,
  },
});

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ============================================================================
// Request Logging (Production)
// ============================================================================

if (isProduction) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      };

      // Log errors and slow requests
      if (res.statusCode >= 400 || duration > 5000) {
        logger.error(logEntry, 'Request failed or slow');
      } else if (duration > 1000) {
        logger.warn(logEntry, 'Slow request');
      }
    });

    next();
  });
}

// ============================================================================
// Health Check Endpoint
// ============================================================================

app.get('/health', (req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: ENV.NODE_ENV,
    services: {
      websocket: wss.clients.size,
      twelveData: !!ENV.TWELVEDATA_API_KEY,
      gemini: !!ENV.GEMINI_API_KEY,
      finnhub: !!ENV.FINNHUB_API_KEY,
    },
  };

  res.json(health);
});

// ============================================================================
// WebSocket Price Streaming
// ============================================================================

const PAIRS_CONFIG_WS: Record<string, { name: string; basePrice: number; pipDecimal: number }> = PAIRS_CONFIG;

// Initialize watchlist with base prices (will be overwritten by real data)
const serverWatchlist = Object.keys(PAIRS_CONFIG_WS).map(symbol => {
  const config = PAIRS_CONFIG_WS[symbol];
  return {
    symbol,
    name: config.name,
    price: config.basePrice,
    change: 0,
    high: config.basePrice,
    low: config.basePrice,
  };
});

async function fetchRealLatestPrices(): Promise<void> {
  if (!ENV.TWELVEDATA_API_KEY) {
    logger.error('TWELVEDATA_API_KEY is required for live prices');
    return;
  }

  const symbolsMap: Record<string, string> = {
    'EURUSD': 'EUR/USD',
    'GBPUSD': 'GBP/USD',
    'USDJPY': 'USD/JPY',
    'AUDUSD': 'AUD/USD',
    'USDCAD': 'USD/CAD',
    'GBPJPY': 'GBP/JPY',
    'XAUUSD': 'XAU/USD',
    'XAGUSD': 'XAG/USD',
  };

  const fetchPromises = serverWatchlist.map(async (item) => {
    try {
      const symbol = symbolsMap[item.symbol];
      if (!symbol) return;

      const res = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${ENV.TWELVEDATA_API_KEY}`);
      if (res.ok) {
        const data = (await res.json()) as any;
        const currentPrice = parseFloat(data.price);
        const prevClose = parseFloat(data.previous_close);
        
        if (!isNaN(currentPrice)) {
          const config = PAIRS_CONFIG_WS[item.symbol];
          item.price = parseFloat(currentPrice.toFixed(config.pipDecimal + 1));
          item.high = parseFloat((parseFloat(data.fifty_two_week?.high) || currentPrice).toFixed(config.pipDecimal + 1));
          item.low = parseFloat((parseFloat(data.fifty_two_week?.low) || currentPrice).toFixed(config.pipDecimal + 1));
          item.change = prevClose ? parseFloat((((currentPrice - prevClose) / prevClose) * 100).toFixed(2)) : 0;
        }
      }
    } catch (e) {
      // Silent catch to prevent console spam
    }
  });

  await Promise.allSettled(fetchPromises);
}

function broadcastPrices(): void {
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
  logger.info('Initial price sync completed');
  broadcastPrices();
});

// Sync real latest quotes every 5 seconds
const priceSyncInterval = setInterval(() => {
  fetchRealLatestPrices().then(() => broadcastPrices());
}, 5000);

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

// ============================================================================
// Gemini AI Client
// ============================================================================

let ai: GoogleGenAI | null = null;

if (ENV.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: ENV.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'ApexFX-Terminal/1.0',
      },
    },
  });
}

// ============================================================================
// API Routes
// ============================================================================

// Standardized API response helper
const apiResponse = {
  success: <T>(data: T) => ({ success: true, ...data }),
  error: (message: string, status = 500) => ({ success: false, error: message }),
};

// 1. Frankfurter Forex Rates
app.get('/api/forex', async (req: Request, res: Response) => {
  try {
    const response = await fetch('https://api.frankfurter.app/latest?from=USD');
    if (!response.ok) {
      throw new Error(`Frankfurter API returned status ${response.status}`);
    }
    const data = await response.json();
    const r = data.rates || {};

    res.json(apiResponse.success({
      source: 'Frankfurter Real-time API',
      timestamp: data.date,
      rates: {
        EURUSD: r.EUR ? parseFloat((1 / r.EUR).toFixed(5)) : null,
        GBPUSD: r.GBP ? parseFloat((1 / r.GBP).toFixed(5)) : null,
        USDJPY: r.JPY ? parseFloat(r.JPY.toFixed(3)) : null,
        AUDUSD: r.AUD ? parseFloat((1 / r.AUD).toFixed(5)) : null,
        USDCAD: r.CAD ? parseFloat(r.CAD.toFixed(5)) : null,
        USDCHF: r.CHF ? parseFloat(r.CHF.toFixed(5)) : null,
      }
    }));
  } catch (error: any) {
    res.status(500).json(apiResponse.error(error.message || 'Failed to fetch live rates'));
  }
});

// 2. Watchlist Prices (HTTP Fallback)
app.get('/api/market/prices', (req: Request, res: Response) => {
  res.json(apiResponse.success({
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
  }));
});

// 3. Historical Chart Data (Twelve Data)
app.get('/api/market/history', async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe } = req.query;
    if (!symbol || !timeframe) {
      return res.status(400).json(apiResponse.error('Symbol and timeframe are required', 400));
    }

    if (!ENV.TWELVEDATA_API_KEY) {
      return res.status(503).json(apiResponse.error('Twelve Data API key not configured', 503));
    }

    const symbolsMap: Record<string, string> = {
      'EURUSD': 'EUR/USD',
      'GBPUSD': 'GBP/USD',
      'USDJPY': 'USD/JPY',
      'AUDUSD': 'AUD/USD',
      'USDCAD': 'USD/CAD',
      'GBPJPY': 'GBP/JPY',
      'XAUUSD': 'XAU/USD',
      'XAGUSD': 'XAG/USD',
    };

    const ticker = symbolsMap[symbol as string];
    if (!ticker) {
      return res.status(400).json(apiResponse.error('Invalid symbol', 400));
    }

    const intervalMap: Record<string, string> = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '1H': '1hour',
      '4H': '4hour',
      'D': '1day',
    };

    const interval = intervalMap[timeframe as string] || '1hour';

    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=${interval}&outputsize=200&apikey=${ENV.TWELVEDATA_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`Twelve Data returned status ${response.status}`);
    }

    const data = await response.json() as any;
    
    if (data.status === 'error' || !data.values) {
      throw new Error(data.message || 'Invalid response from Twelve Data');
    }

    const candlesticks = data.values.map((candle: any) => ({
      time: Math.floor(new Date(candle.datetime).getTime() / 1000),
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseInt(candle.volume) || 0,
    })).reverse();

    res.json(apiResponse.success({
      symbol,
      timeframe,
      data: candlesticks,
    }));
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch historical data');
    res.status(500).json(apiResponse.error(error.message || 'Failed to fetch historical data'));
  }
});

// 4. AI Chat (with rate limiting)
app.post('/api/chat', chatLimiter, async (req: Request, res: Response) => {
  try {
    const { messages, selectedSymbol, selectedTimeframe, activeSignal } = req.body;
    
    if (!ai) {
      return res.status(503).json(apiResponse.error('AI service unavailable', 503));
    }

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json(apiResponse.error('Invalid or missing messages array', 400));
    }

    const contextStr = `You are the ApexFX AI Analyst in a professional trading platform.
Current instrument: ${selectedSymbol}
Timeframe: ${selectedTimeframe}
Signal: ${activeSignal ? JSON.stringify(activeSignal) : 'None'}
Provide concise, professional trading analysis.`;

    const lastMessage = messages[messages.length - 1];
    let imagePart: any = null;
    
    if (lastMessage?.image) {
      const matches = lastMessage.image.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        imagePart = {
          inlineData: { mimeType: matches[1], data: matches[2] }
        };
      }
    }

    const textPart = { text: `${contextStr}\n\nUser: ${lastMessage?.text || 'Analyze this chart.'}` };
    const contents = [{
      role: 'user',
      parts: imagePart ? [imagePart, textPart] : [textPart],
    }];

    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
    });

    res.json({ text: result.text || "Unable to generate response." });
  } catch (error: any) {
    logger.error({ error: error.message }, 'AI chat request failed');
    res.status(500).json(apiResponse.error(error.message || 'AI request failed'));
  }
});

// 5. Finnhub News Proxy
app.get('/api/market/news', async (req: Request, res: Response) => {
  try {
    if (!ENV.FINNHUB_API_KEY) {
      return res.status(503).json(apiResponse.error('News service unavailable', 503));
    }
    const { category = 'forex' } = req.query;
    const response = await fetch(`https://finnhub.io/api/v1/news?category=${category}&token=${ENV.FINNHUB_API_KEY}`);
    if (!response.ok) throw new Error('Failed to fetch news');
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json(apiResponse.error(error.message));
  }
});

// 6. Twelve Data Quote Proxy
app.get('/api/market/quote', async (req: Request, res: Response) => {
  try {
    if (!ENV.TWELVEDATA_API_KEY) {
      return res.status(503).json(apiResponse.error('Quote service unavailable', 503));
    }
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json(apiResponse.error('Symbol is required', 400));
    const response = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${ENV.TWELVEDATA_API_KEY}`);
    if (!response.ok) throw new Error('Failed to fetch quote');
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json(apiResponse.error(error.message));
  }
});

// 7. ForexRate Proxy
app.get('/api/market/forexrate', async (req: Request, res: Response) => {
  try {
    if (!ENV.FOREXRATE_API_KEY) {
      return res.status(503).json(apiResponse.error('ForexRate service unavailable', 503));
    }
    const { base = 'USD' } = req.query;
    const response = await fetch(`https://api.forexrateapi.com/v1/latest?api_key=${ENV.FOREXRATE_API_KEY}&base=${base}`);
    if (!response.ok) throw new Error('Failed to fetch forex rates');
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json(apiResponse.error(error.message));
  }
});

// ============================================================================
// Static Files & SPA Fallback
// ============================================================================

async function startServer(): Promise<void> {
  if (!isProduction) {
    logger.info('Dev mode: run `npx vite` for the frontend dev server with HMR');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      maxAge: '1y',
      etag: true,
      lastModified: true,
    }));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(ENV.PORT, '0.0.0.0', () => {
    logger.info({ port: ENV.PORT, env: ENV.NODE_ENV }, 'Server started');
    logger.info({ url: `http://localhost:${ENV.PORT}/health` }, 'Health check endpoint');
  });
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

function gracefulShutdown(signal: string): void {
  logger.info({ signal }, 'Shutdown signal received');
  
  clearInterval(priceSyncInterval);
  
  wss.clients.forEach(client => client.close());
  
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================================
// Export & Start
// ============================================================================

export default app;

if (!process.env.VERCEL) {
  startServer();
}
