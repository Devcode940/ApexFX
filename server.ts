import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createServer } from 'http';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { z } from 'zod';
import { PAIRS_CONFIG } from './src/constants/config';

// ============================================================================
// Environment Configuration & Validation
// ============================================================================

dotenv.config({ override: true });

// ============================================================================
// Environment Configuration & Validation with Zod
// ============================================================================

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional().default('openai/gpt-4o'),
  TWELVEDATA_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),
  FOREXRATE_API_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().optional().default('*'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
});

const ENV = envSchema.parse(process.env);

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

// Log warnings for optional API keys
if (!ENV.GEMINI_API_KEY && !ENV.OPENROUTER_API_KEY) {
  logger.warn('No AI API key set (GEMINI_API_KEY or OPENROUTER_API_KEY) - AI chat will be unavailable');
} else if (ENV.OPENROUTER_API_KEY) {
  logger.info({ model: ENV.OPENROUTER_MODEL }, 'OpenRouter AI configured');
}
if (!ENV.FINNHUB_API_KEY) {
  logger.warn('FINNHUB_API_KEY not set - news feed will be unavailable');
}

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
const server = createServer(app);

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
      connectSrc: ["'self'", "https://api.twelvedata.com", "https://api.frankfurter.app", "https://finnhub.io"],
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

// CORS - Secure configuration
// In production, never allow wildcard origin with credentials
const allowedOrigins = isProduction
  ? ENV.CORS_ORIGIN === '*' 
    ? ['https://apexfx-terminal.vercel.app', 'https://www.apexfx-terminal.com']
    : ENV.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: allowedOrigins,
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
// Input Validation Schemas with Zod
// ============================================================================

// Symbol and timeframe validation
const symbolSchema = z.enum(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'GBPJPY', 'XAUUSD', 'XAGUSD']);
const timeframeSchema = z.enum(['1m', '5m', '15m', '1H', '4H', 'D']);

// Query parameter schemas
const historyQuerySchema = z.object({
  symbol: symbolSchema,
  timeframe: timeframeSchema,
});

const quoteQuerySchema = z.object({
  symbol: z.string().min(1),
});

const newsQuerySchema = z.object({
  category: z.string().default('forex'),
});

const forexRateQuerySchema = z.object({
  base: z.string().default('USD'),
});

// Body schemas
const chatBodySchema = z.object({
  messages: z.array(
    z.object({
      text: z.string().optional(),
      image: z.string().optional(),
    })
  ).min(1),
  selectedSymbol: z.string().optional(),
  selectedTimeframe: z.string().optional(),
  activeSignal: z.any().optional(),
});

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
// Health Check Endpoints
// ============================================================================

// Main server health check
app.get('/health', (req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: ENV.NODE_ENV,
    services: {
      twelveData: !!ENV.TWELVEDATA_API_KEY,
      gemini: !!ENV.GEMINI_API_KEY,
      finnhub: !!ENV.FINNHUB_API_KEY,
    },
  };

  res.json(health);
});

// Forex API health check - checks all configured forex APIs
app.get('/health/forex', async (req: Request, res: Response) => {
  const apiChecks: Record<string, { available: boolean; responseTime?: number; error?: string }> = {};

  // Check Frankfurter API (always available, no API key required)
  try {
    const start = Date.now();
    const response = await fetch('https://api.frankfurter.app/latest?from=USD', {
      method: 'HEAD', // HEAD request for health check only
      headers: { 'User-Agent': 'ApexFX-Terminal/1.0' }
    });
    const responseTime = Date.now() - start;
    
    apiChecks['Frankfurter'] = {
      available: response.ok,
      responseTime,
      error: response.ok ? undefined : `HTTP ${response.status}`
    };
  } catch (error: any) {
    apiChecks['Frankfurter'] = {
      available: false,
      error: error.message
    };
  }

  // Check Twelve Data API (if configured)
  if (ENV.TWELVEDATA_API_KEY) {
    try {
      const start = Date.now();
      const response = await fetch(`https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=${ENV.TWELVEDATA_API_KEY}`, {
        method: 'HEAD'
      });
      const responseTime = Date.now() - start;
      
      apiChecks['TwelveData'] = {
        available: response.ok,
        responseTime,
        error: response.ok ? undefined : `HTTP ${response.status}`
      };
    } catch (error: any) {
      apiChecks['TwelveData'] = {
        available: false,
        error: error.message
      };
    }
  } else {
    apiChecks['TwelveData'] = {
      available: false,
      error: 'API key not configured'
    };
  }

  // Check ForexRate API (if configured - this would need to be implemented)
  if (ENV.FOREXRATE_API_KEY) {
    try {
      const start = Date.now();
      const response = await fetch(`https://api.forexrateapi.com/v1/latest?api_key=${ENV.FOREXRATE_API_KEY}&base=USD`, {
        method: 'HEAD'
      });
      const responseTime = Date.now() - start;
      
      apiChecks['ForexRate'] = {
        available: response.ok,
        responseTime,
        error: response.ok ? undefined : `HTTP ${response.status}`
      };
    } catch (error: any) {
      apiChecks['ForexRate'] = {
        available: false,
        error: error.message
      };
    }
  } else {
    apiChecks['ForexRate'] = {
      available: false,
      error: 'API key not configured'
    };
  }

  // Calculate overall status
  const availableApis = Object.values(apiChecks).filter(api => api.available).length;
  const totalApis = Object.keys(apiChecks).length;
  const status = availableApis > 0 ? 'degraded' : 'unhealthy';

  res.json({
    status,
    timestamp: new Date().toISOString(),
    availableApis: `${availableApis}/${totalApis}`,
    apiChecks
  });
});

// ============================================================================
// Server Watchlist State (API-only, no WebSocket)
// ============================================================================

const PAIRS_CONFIG_WS: Record<string, { name: string; basePrice: number; pipDecimal: number }> = PAIRS_CONFIG;

// Server watchlist state - updated via API polling
let serverWatchlist = Object.keys(PAIRS_CONFIG_WS).map(symbol => {
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

// Fetch latest prices from Twelve Data or Frankfurter and update server watchlist
async function fetchAndUpdatePrices(): Promise<void> {
  const hasTwelveData = !!ENV.TWELVEDATA_API_KEY;

  if (hasTwelveData) {
    await fetchFromTwelveData();
  } else {
    await fetchFromFrankfurter();
  }
  logger.debug('Price sync completed');
}

async function fetchFromTwelveData(): Promise<void> {
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
      logger.debug({ error: e }, 'Failed to fetch Twelve Data price');
    }
  });

  await Promise.allSettled(fetchPromises);
}

async function fetchFromFrankfurter(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch('https://api.frankfurter.app/latest?from=USD', {
      headers: { 'User-Agent': 'ApexFX-Terminal/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return;
    const data = await res.json();
    const rates = data.rates || {};

    // Calculate change from previous sync price
    for (const item of serverWatchlist) {
      const config = PAIRS_CONFIG_WS[item.symbol];
      let currentPrice: number | null = null;

      switch (item.symbol) {
        case 'USDJPY': currentPrice = rates.JPY ? parseFloat(rates.JPY.toFixed(3)) : null; break;
        case 'USDCAD': currentPrice = rates.CAD ? parseFloat(rates.CAD.toFixed(5)) : null; break;
        case 'EURUSD': currentPrice = rates.EUR ? parseFloat((1 / rates.EUR).toFixed(5)) : null; break;
        case 'GBPUSD': currentPrice = rates.GBP ? parseFloat((1 / rates.GBP).toFixed(5)) : null; break;
        case 'AUDUSD': currentPrice = rates.AUD ? parseFloat((1 / rates.AUD).toFixed(5)) : null; break;
        case 'GBPJPY': currentPrice = rates.GBP && rates.JPY ? parseFloat((rates.JPY / rates.GBP).toFixed(3)) : null; break;
        case 'XAUUSD': break; // Not supported by Frankfurter
        case 'XAGUSD': break; // Not supported by Frankfurter
      }

      if (currentPrice !== null) {
        const prevPrice = item.price;
        item.price = currentPrice;
        item.high = Math.max(item.high, currentPrice);
        item.low = Math.min(item.low, currentPrice);
        if (prevPrice !== config.basePrice) {
          item.change = parseFloat((((currentPrice - prevPrice) / prevPrice) * 100).toFixed(2));
        }
      }
    }
  } catch (e) {
    logger.debug({ error: e }, 'Failed to fetch Frankfurter rates');
  }
}

// Initial sync on server start
fetchAndUpdatePrices().then(() => {
  logger.info('Initial price sync completed');
});

// Sync real latest quotes every 3 seconds
const priceSyncInterval = setInterval(() => {
  fetchAndUpdatePrices();
}, 3000);

// ============================================================================
// AI Client (Gemini or OpenRouter)
// ============================================================================

let ai: GoogleGenAI | null = null;
let aiProvider: 'gemini' | 'openrouter' | null = null;

if (ENV.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: ENV.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'ApexFX-Terminal/1.0',
      },
    },
  });
  aiProvider = 'gemini';
} else if (ENV.OPENROUTER_API_KEY) {
  aiProvider = 'openrouter';
}

// ============================================================================
// API Routes
// ============================================================================

// Standardized API response helper
const apiResponse = {
  success: <T>(data: T) => ({ ...data, success: true }),
  error: (message: string, status = 500) => ({ success: false, error: message }),
};

// 1. Enhanced Frankfurter Forex Rates - Primary forex API (no API key required)
app.get('/api/forex', async (req: Request, res: Response) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
    
    const response = await fetch('https://api.frankfurter.app/latest?from=USD', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ApexFX-Terminal/1.0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Frankfurter API returned status ${response.status}`);
    }
    
    const data = await response.json();
    const rates = data.rates || {};
    const timestamp = data.date || new Date().toISOString();

    // Convert Frankfurter format (1 USD = X CURRENCY) to our symbol format
    // For USD/CURRENCY pairs: rate = rates.CURRENCY
    // For CURRENCY/USD pairs: rate = 1 / rates.CURRENCY
    const forexRates: Record<string, number | null> = {
      // USD-based pairs (direct from Frankfurter)
      USDJPY: rates.JPY ? parseFloat(rates.JPY.toFixed(3)) : null,
      USDCAD: rates.CAD ? parseFloat(rates.CAD.toFixed(5)) : null,
      USDCHF: rates.CHF ? parseFloat(rates.CHF.toFixed(5)) : null,
      
      // EUR-based pairs (inverse of Frankfurter rates)
      EURUSD: rates.EUR ? parseFloat((1 / rates.EUR).toFixed(5)) : null,
      
      // GBP-based pairs (inverse of Frankfurter rates)
      GBPUSD: rates.GBP ? parseFloat((1 / rates.GBP).toFixed(5)) : null,
      
      // AUD-based pairs (inverse of Frankfurter rates)
      AUDUSD: rates.AUD ? parseFloat((1 / rates.AUD).toFixed(5)) : null,
      
      // Cross rates (calculated from USD base)
      GBPJPY: rates.GBP && rates.JPY ? parseFloat((rates.JPY / rates.GBP).toFixed(3)) : null,
      EURJPY: rates.EUR && rates.JPY ? parseFloat((rates.JPY / rates.EUR).toFixed(3)) : null,
      EURGBP: rates.EUR && rates.GBP ? parseFloat((rates.GBP / rates.EUR).toFixed(5)) : null,
      AUDJPY: rates.AUD && rates.JPY ? parseFloat((rates.JPY / rates.AUD).toFixed(3)) : null,
      
      // Additional supported pairs
      NZDUSD: rates.NZD ? parseFloat((1 / rates.NZD).toFixed(5)) : null,
      USDNOK: rates.NOK ? parseFloat(rates.NOK.toFixed(5)) : null,
      USDSEK: rates.SEK ? parseFloat(rates.SEK.toFixed(5)) : null,
      
      // Commodities not supported by Frankfurter free API
      XAUUSD: null,
      XAGUSD: null,
    };

    res.json(apiResponse.success({
      source: 'Frankfurter',
      timestamp: timestamp,
      rates: forexRates
    }));
  } catch (error: any) {
    logger.error({ error: error.message }, 'Frankfurter API request failed');
    res.status(500).json(apiResponse.error(error.message || 'Failed to fetch live rates'));
  }
});

// 2. Watchlist Prices (HTTP Fallback)
app.get('/api/market/prices', (req: Request, res: Response) => {
  res.json(apiResponse.success({
    source: ENV.TWELVEDATA_API_KEY ? 'TwelveData' : 'Frankfurter',
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

// 3. Historical Chart Data (Twelve Data) - with validation
app.get('/api/market/history', async (req: Request, res: Response) => {
  try {
    // Validate input with Zod
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(apiResponse.error(
        `Invalid parameters: ${parsed.error.issues.map(e => e.message).join(', ')}`,
        400
      ));
    }
    
    const { symbol, timeframe } = parsed.data;

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

    const ticker = symbolsMap[symbol];
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

    const interval = intervalMap[timeframe] || '1hour';

    // API key is server-side only - never exposed to client
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

    const candlesticks = data.values
      .filter((candle: any) => candle.datetime && candle.open && candle.high && candle.low && candle.close)
      .map((candle: any) => {
        const time = Math.floor(new Date(candle.datetime).getTime() / 1000);
        const open = parseFloat(candle.open);
        const high = parseFloat(candle.high);
        const low = parseFloat(candle.low);
        const close = parseFloat(candle.close);
        if (isNaN(time) || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;
        return { time, open, high, low, close, volume: parseInt(candle.volume) || 0 };
      })
      .filter(Boolean)
      .reverse();

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

// 4. AI Chat (with rate limiting) - with validation
app.post('/api/chat', chatLimiter, async (req: Request, res: Response) => {
  try {
    // Validate input with Zod
    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(apiResponse.error(
        `Invalid request body: ${parsed.error.issues.map(e => e.message).join(', ')}`,
        400
      ));
    }
    
    const { messages, selectedSymbol, selectedTimeframe, activeSignal } = parsed.data;
    
    if (!aiProvider) {
      return res.status(503).json(apiResponse.error('AI service unavailable', 503));
    }

    const contextStr = `You are the ApexFX AI Analyst in a professional trading platform.
Current instrument: ${selectedSymbol}
Timeframe: ${selectedTimeframe}
Signal: ${activeSignal ? JSON.stringify(activeSignal) : 'None'}
Provide concise, professional trading analysis.`;

    const lastMessage = messages[messages.length - 1];
    const userText = lastMessage?.text || 'Analyze this chart.';
    const prompt = `${contextStr}\n\nUser: ${userText}`;

    if (aiProvider === 'gemini') {
      let imagePart: any = null;
      
      if (lastMessage?.image) {
        const matches = lastMessage.image.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          imagePart = {
            inlineData: { mimeType: matches[1], data: matches[2] }
          };
        }
      }

      const textPart = { text: prompt };
      const contents = [{
        role: 'user',
        parts: imagePart ? [imagePart, textPart] : [textPart],
      }];

      const result = await ai!.models.generateContent({
        model: 'gemini-2.0-flash',
        contents,
      });

      return res.json({ text: result.text || "Unable to generate response." });
    }

    // OpenRouter (OpenAI-compatible API)
    const openRouterBody: any = {
      model: ENV.OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: contextStr },
        { role: 'user', content: userText },
      ],
    };

    if (lastMessage?.image) {
      openRouterBody.messages[1] = {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: lastMessage.image } },
        ],
      };
    }

    const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ENV.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://apexfx-terminal.vercel.app',
        'X-Title': 'ApexFX Terminal',
      },
      body: JSON.stringify(openRouterBody),
    });

    if (!orResponse.ok) {
      const errorBody = await orResponse.text();
      throw new Error(`OpenRouter returned ${orResponse.status}: ${errorBody}`);
    }

    const orData = await orResponse.json();
    const text = orData.choices?.[0]?.message?.content || "Unable to generate response.";

    res.json({ text });
  } catch (error: any) {
    logger.error({ error: error.message }, 'AI chat request failed');
    res.status(500).json(apiResponse.error(error.message || 'AI request failed'));
  }
});

// 5. Finnhub News Proxy - with validation
app.get('/api/market/news', async (req: Request, res: Response) => {
  try {
    if (!ENV.FINNHUB_API_KEY) {
      return res.status(503).json(apiResponse.error('News service unavailable', 503));
    }
    
    // Validate input with Zod
    const parsed = newsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(apiResponse.error(
        `Invalid parameters: ${parsed.error.issues.map(e => e.message).join(', ')}`,
        400
      ));
    }
    
    const { category } = parsed.data;
    
    // API key is server-side only - never exposed to client
    const response = await fetch(`https://finnhub.io/api/v1/news?category=${category}&token=${ENV.FINNHUB_API_KEY}`);
    if (!response.ok) throw new Error('Failed to fetch news');
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json(apiResponse.error(error.message));
  }
});

// 6. Twelve Data Quote Proxy - with validation
app.get('/api/market/quote', async (req: Request, res: Response) => {
  try {
    if (!ENV.TWELVEDATA_API_KEY) {
      return res.status(503).json(apiResponse.error('Quote service unavailable', 503));
    }
    
    // Validate input with Zod
    const parsed = quoteQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(apiResponse.error(
        `Invalid parameters: ${parsed.error.issues.map(e => e.message).join(', ')}`,
        400
      ));
    }
    
    const { symbol } = parsed.data;
    
    // API key is server-side only - never exposed to client
    const response = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${ENV.TWELVEDATA_API_KEY}`);
    if (!response.ok) throw new Error('Failed to fetch quote');
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json(apiResponse.error(error.message));
  }
});

// 7. ForexRate Proxy - with validation
app.get('/api/market/forexrate', async (req: Request, res: Response) => {
  try {
    if (!ENV.FOREXRATE_API_KEY) {
      return res.status(503).json(apiResponse.error('ForexRate service unavailable', 503));
    }
    
    // Validate input with Zod
    const parsed = forexRateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(apiResponse.error(
        `Invalid parameters: ${parsed.error.issues.map(e => e.message).join(', ')}`,
        400
      ));
    }
    
    const { base } = parsed.data;
    
    // API key is server-side only - never exposed to client
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
