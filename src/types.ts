import type { QuoteMetadata, FeedSource, InstrumentKind } from '../shared/market';
import type { ConversionSnapshot } from './utils/money';

export type { Timeframe } from '../shared/timeframes';

export interface Candlestick {
  time: number; // UTC timestamp in seconds for every chart period, including D/W
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /** Observed/current or incomplete first-week bar, not an authoritative complete OHLC interval. */
  provisional?: boolean;
  updatedAt?: number;
}

export interface WatchlistItem extends Partial<QuoteMetadata> {
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
  confluence?: number; // Heuristic score out of 100, NOT a win probability.
  reliability?: 'Low' | 'Medium' | 'High';
  // Deliberately no `profitFactor` on a detected pattern: it cannot be measured without a backtest,
  // and an earlier version fabricated it from the win rate. Ledger-level PF (real) is in
  // PerformanceDashboard's metrics, computed from closed trades.
  volumeConfirm?: boolean;
  score?: number; // Heuristic ranking, not measured profitability
  indicatorsConfirm?: string[];
}

export interface SignalBreakdownItem {
  name: string;
  status: 'bullish' | 'bearish' | 'neutral';
  detail?: string;
}

export interface TradingSignal {
  type: 'BUY' | 'SELL' | 'NEUTRAL';
  symbol: string;
  timeframe: string;
  price: number;
  tp: number; // Take Profit
  sl: number; // Stop Loss
  confidence: number; // Heuristic confluence strength 0..100, NOT a probability
  time: string;
  rationale: string[];
  breakdown?: SignalBreakdownItem[]; // structured sentiment, not parsed from strings
  disclaimer?: string;
}

export interface TradePosition {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  /** Observation backing the in-memory mark; persisted snapshots deliberately clear it. */
  markAsOf?: number | null;
  amount: number; // standard lots; shared instrument metadata defines the contract multiplier
  sl?: number;
  tp?: number;
  pnl: number | null;
  pnlVersion?: 2;
  accountCurrency?: 'USD';
  quoteCurrency?: string;
  pnlQuote?: number;
  conversion?: ConversionSnapshot | null;
  instrumentKind?: InstrumentKind;
  time: string;
  openedAt?: number; // epoch ms
}

export interface ClosedTrade {
  id: string;
  /** Stable original position identity; prevents resurrection and duplicate closes. */
  positionId?: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  amount: number;
  pnl: number | null;
  pnlVersion?: 2;
  accountCurrency?: 'USD';
  quoteCurrency?: string;
  pnlQuote?: number;
  conversion?: ConversionSnapshot | null;
  instrumentKind?: InstrumentKind;
  time: string;
  closeReason: 'Manual' | 'SL Hit' | 'TP Hit';
  openedAt?: number; // epoch ms
  closedAt?: number; // epoch ms
  durationMs?: number; // duration in ms
}

export interface LiveQuote {
  providerSymbol?: string | null;
  dayStatsAvailable?: boolean;
  price: number;
  change: number;
  priceBasis?: 'mid' | 'last';
  /** Which upstream the server used, so the HUD can label itself truthfully. */
  source?: FeedSource;
  asOf?: number | null;
  quality?: string;
  instrumentKind?: InstrumentKind;
  high?: number;
  low?: number;
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
