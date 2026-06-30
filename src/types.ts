export type Timeframe = '1m' | '5m' | '15m' | '1H' | '4H' | 'D';

export interface Candlestick {
  time: number; // UTC timestamp in seconds (or string for Daily e.g. 'YYYY-MM-DD')
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number; // percentage change
  high: number;
  low: number;
  spread: number; // in pips
}

export interface TechnicalIndicatorsState {
  sma: boolean;
  ema: boolean;
  rsi: boolean;
  macd: boolean;
  bollinger: boolean;
  fibonacci: boolean;
}

export interface IndicatorDataPoint {
  time: number;
  sma?: number;
  ema?: number;
  rsi?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHist?: number;
  bbUpper?: number;
  bbBasis?: number;
  bbLower?: number;
}

export interface Pattern {
  id: string;
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  time: number; // Candlestick time when occurred
  description: string;
  candlestickIndex: number;
  winRate?: number; // e.g., 78 for 78%
  reliability?: 'Low' | 'Medium' | 'High';
  profitFactor?: number; // e.g., 1.85
  volumeConfirm?: boolean;
  score?: number; // profitability score
  indicatorsConfirm?: string[];
}

export interface TradingSignal {
  type: 'BUY' | 'SELL' | 'NEUTRAL';
  symbol: string;
  timeframe: string;
  price: number;
  tp: number; // Take Profit
  sl: number; // Stop Loss
  confidence: number; // 0 to 100
  time: string;
  rationale: string[];
}

export interface TradePosition {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  amount: number; // size in lots or units
  sl?: number;
  tp?: number;
  pnl: number;
  time: string;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  amount: number;
  pnl: number;
  time: string;
  closeReason: 'Manual' | 'SL Hit' | 'TP Hit';
}

export interface NewsItem {
  id: string;
  time: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  source: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  affectedPairs: string[];
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface ForexRatesResponse extends ApiResponse {
  source?: string;
  timestamp?: string;
  rates?: {
    EURUSD: number | null;
    GBPUSD: number | null;
    USDJPY: number | null;
    AUDUSD: number | null;
    USDCAD: number | null;
    USDCHF: number | null;
  };
}

export interface MarketPriceResponse extends ApiResponse {
  rates?: Record<string, {
    price: number;
    high: number;
    low: number;
    change: number;
  }>;
  timestamp?: string;
}

export interface HistoricalDataResponse extends ApiResponse {
  symbol?: string;
  timeframe?: string;
  data?: Candlestick[];
}

export interface QuoteResponse extends ApiResponse {
  symbol?: string;
  name?: string;
  exchange?: string;
  price?: number;
  change?: number;
  percent_change?: number;
  previous_close?: number;
  fifty_two_week?: {
    low?: string;
    high?: string;
  };
}

export interface NewsResponse extends ApiResponse {
  id?: number;
  category?: string;
  datetime?: number;
  headline?: string;
  source?: string;
  url?: string;
  summary?: string;
  image?: string;
  related?: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  environment: string;
  services: {
    websocket: number;
    twelveData: boolean;
    gemini: boolean;
    finnhub: boolean;
  };
}
