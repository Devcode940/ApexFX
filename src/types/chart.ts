import type { ClosedTrade, TradePosition } from '../types';

export type ChartTheme = 'dark' | 'light';

export interface ChartPoint {
  time: number;
  price: number;
}

export type DrawingTool =
  | 'none'
  | 'horizontal'
  | 'trendline_start'
  | 'trendline_end'
  | 'annotation'
  | 'rr_long'
  | 'rr_short'
  | 'fib_start'
  | 'fib_end';

export interface TrendlineDrawing {
  start: ChartPoint;
  end: ChartPoint;
  color?: string;
}

export interface AnnotationDrawing {
  time: number;
  price: number;
  text: string;
  color?: string;
}

export interface RiskRewardDrawing {
  id: string;
  type: 'long' | 'short';
  entry: ChartPoint;
  tp: number;
  sl: number;
}

export interface FibonacciDrawing {
  id: string;
  start: ChartPoint;
  end: ChartPoint;
  color?: string;
}

export type HorizontalLineDrawing = number | { price: number; color?: string };

export interface DrawingsState {
  horizontalLines: HorizontalLineDrawing[];
  trendlines: TrendlineDrawing[];
  annotations: AnnotationDrawing[];
  riskRewards: RiskRewardDrawing[];
  fibonacci: FibonacciDrawing[];
}

export const EMPTY_DRAWINGS: DrawingsState = {
  horizontalLines: [],
  trendlines: [],
  annotations: [],
  riskRewards: [],
  fibonacci: [],
};

export interface HudData {
  open: number;
  high: number;
  low: number;
  close: number;
  date: string;
  sma?: number;
  ema?: number;
  rsi?: number;
  bbUpper?: number;
  bbLower?: number;
}

export type PatternMarkerFilter = 'all' | 'bullish' | 'bearish' | 'high_winrate';
export type AnimTradeFilter = 'all' | 'open' | 'closed';
export type SidebarTab = 'indicators' | 'patterns_sessions' | 'drawings' | 'view_anims';

/**
 * Trade shown as an animated entry/exit overlay on the chart.
 * Open positions and closed trades are normalized into this shape.
 */
export interface AnimatedTrade {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  amount: number;
  pnl: number;
  time: string;
  isClosed: boolean;
  exitPrice?: number;
  closeReason?: string;
}

export type { TradePosition, ClosedTrade };
