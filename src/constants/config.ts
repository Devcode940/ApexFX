/**
 * Centralized Configuration
 * Contains all application constants, currency pairs, and settings
 */

export const CURRENCY_PAIRS = {
  EURUSD: { name: 'EUR / USD', basePrice: 1.08520, pipDecimal: 4, spreadPips: 1.2, category: 'forex' },
  GBPUSD: { name: 'GBP / USD', basePrice: 1.27150, pipDecimal: 4, spreadPips: 1.6, category: 'forex' },
  USDJPY: { name: 'USD / JPY', basePrice: 155.350, pipDecimal: 2, spreadPips: 1.4, category: 'forex' },
  AUDUSD: { name: 'AUD / USD', basePrice: 0.66450, pipDecimal: 4, spreadPips: 1.5, category: 'forex' },
  USDCAD: { name: 'USD / CAD', basePrice: 1.36780, pipDecimal: 4, spreadPips: 1.8, category: 'forex' },
  GBPJPY: { name: 'GBP / JPY', basePrice: 198.150, pipDecimal: 2, spreadPips: 2.3, category: 'forex' },
  XAUUSD: { name: 'Gold / USD', basePrice: 2325.40, pipDecimal: 2, spreadPips: 2.5, category: 'commodity' },
  XAGUSD: { name: 'Silver / USD', basePrice: 29.350, pipDecimal: 3, spreadPips: 2.0, category: 'commodity' },
} as const;

export type CurrencyPair = keyof typeof CURRENCY_PAIRS;

export const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', 'D'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

export const TIME_CONFIG: Record<Timeframe, { label: string; offsetSec: number; minutes: number }> = {
  '1m': { label: '1 Minute', offsetSec: 60, minutes: 1 },
  '5m': { label: '5 Minutes', offsetSec: 300, minutes: 5 },
  '15m': { label: '15 Minutes', offsetSec: 900, minutes: 15 },
  '1H': { label: '1 Hour', offsetSec: 3600, minutes: 60 },
  '4H': { label: '4 Hours', offsetSec: 14400, minutes: 240 },
  'D': { label: '1 Day', offsetSec: 86400, minutes: 1440 },
} as const;

export const INDICATOR_PERIODS = {
  SMA: 20,
  EMA: 50,
  RSI: 14,
  MACD: { fast: 12, slow: 26, signal: 9 },
  BOLLINGER: { period: 20, multiplier: 2 },
  ATR: 14,
  FIBONACCI: 100,
} as const;

export const VOLATILITY_SCALES: Record<Timeframe, number> = {
  '1m': 0.00015,
  '5m': 0.00025,
  '15m': 0.00035,
  '1H': 0.0008,
  '4H': 0.0015,
  'D': 0.0045,
} as const;

export const JPY_MULTIPLIER = 100;

export const CONTRACT_SIZE = 100000; // Standard forex contract size

export const DEFAULT_TICK_PROBABILITY = 0.6; // 60% chance of price change per tick

export const WS_EVENTS = {
  PRICE_UPDATE: 'PRICE_UPDATE',
  INITIAL_RATES: 'INITIAL_RATES',
  CONNECTION_STATUS: 'CONNECTION_STATUS',
} as const;

export type WSEventType = typeof WS_EVENTS[keyof typeof WS_EVENTS];

export const STORAGE_KEYS = {
  THEME: 'forexinsight_theme',
  POSITIONS: 'forexinsight_positions',
  CLOSED_TRADES: 'forexinsight_closed_trades',
  INDICATORS: 'forexinsight_preferred_indicators',
  DRAWINGS: 'forexinsight_drawings',
} as const;

export const API_CONFIG = {
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: 100,
  
  // Caching
  HISTORY_CACHE_TTL: 60 * 1000, // 1 minute
  PRICE_CACHE_TTL: 5 * 1000, // 5 seconds
  
  // Timeouts
  REQUEST_TIMEOUT: 10000, // 10 seconds
  WS_RECONNECT_DELAY: 5000, // 5 seconds
  POLLING_INTERVAL: 2500, // 2.5 seconds
  
  // Server
  DEFAULT_PORT: 3000,
  MAX_BODY_SIZE: '10mb',
} as const;

export const ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  API_RATE_LIMIT: 'API_RATE_LIMIT',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SERVER_ERROR: 'SERVER_ERROR',
  API_KEY_MISSING: 'API_KEY_MISSING',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

// Symbol mappings for external APIs
export const SYMBOL_MAPPINGS = {
  // Finnhub symbol mappings
  finnhub: {
    EURUSD: 'EUR',
    GBPUSD: 'GBP',
    USDJPY: 'JPY',
    AUDUSD: 'AUD',
    USDCAD: 'CAD',
    GBPJPY: 'GBPJPY',
    XAUUSD: 'GC=F',
    XAGUSD: 'SI=F',
  },
  // Twelve Data symbol mappings
  twelveData: {
    EURUSD: 'EUR/USD',
    GBPUSD: 'GBP/USD',
    USDJPY: 'USD/JPY',
    AUDUSD: 'AUD/USD',
    USDCAD: 'USD/CAD',
    GBPJPY: 'GBP/JPY',
    XAUUSD: 'XAU/USD',
    XAGUSD: 'XAG/USD',
  },
  // Yahoo Finance symbol mappings (fallback)
  yahoo: {
    EURUSD: 'EURUSD=X',
    GBPUSD: 'GBPUSD=X',
    USDJPY: 'USDJPY=X',
    AUDUSD: 'AUDUSD=X',
    USDCAD: 'USDCAD=X',
    GBPJPY: 'GBPJPY=X',
    XAUUSD: 'GC=F',
    XAGUSD: 'SI=F',
  },
} as const;

// News categories for Finnhub
export const NEWS_CATEGORIES = ['forex', 'commodities', 'crypto', 'general'] as const;
export type NewsCategory = typeof NEWS_CATEGORIES[number];

// PAIRS_CONFIG - compatible with forexData.ts (without category field)
export const PAIRS_CONFIG: Record<string, { name: string; basePrice: number; pipDecimal: number; spreadPips: number }> = {
  EURUSD: CURRENCY_PAIRS.EURUSD,
  GBPUSD: CURRENCY_PAIRS.GBPUSD,
  USDJPY: CURRENCY_PAIRS.USDJPY,
  AUDUSD: CURRENCY_PAIRS.AUDUSD,
  USDCAD: CURRENCY_PAIRS.USDCAD,
  GBPJPY: CURRENCY_PAIRS.GBPJPY,
  XAUUSD: CURRENCY_PAIRS.XAUUSD,
  XAGUSD: CURRENCY_PAIRS.XAGUSD,
};
