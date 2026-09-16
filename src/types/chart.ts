import type { ClosedTrade, TradePosition } from '../types';

export type ChartTheme = 'dark' | 'light';

export interface ChartPoint {
  time: number;
  price: number;
}

export type CursorType = 'crosshair' | 'dot' | 'arrow' | 'eraser';

export type DrawingTool =
  | 'none'
  | 'cursor_crosshair'
  | 'cursor_dot'
  | 'cursor_arrow'
  | 'cursor_eraser'
  // Trend tools
  | 'trendline_start'
  | 'trendline_end'
  | 'horizontal'
  | 'horizontal_ray'
  | 'vertical_line'
  | 'channel_p1'
  | 'channel_p2'
  | 'channel_p3'
  // Fibonacci and Gann tools
  | 'fib_start'
  | 'fib_end'
  | 'fib_ext_p1'
  | 'fib_ext_p2'
  | 'fib_ext_p3'
  | 'gann_box_p1'
  | 'gann_box_p2'
  // Patterns
  | 'pattern_hs_p1'
  | 'pattern_hs_p2'
  | 'pattern_hs_p3'
  | 'pattern_hs_p4'
  | 'pattern_xabcd_p1'
  | 'pattern_xabcd_p2'
  | 'pattern_xabcd_p3'
  | 'pattern_xabcd_p4'
  | 'pattern_xabcd_p5'
  | 'pattern_elliott_p1'
  | 'pattern_elliott_p2'
  | 'pattern_elliott_p3'
  | 'pattern_elliott_p4'
  | 'pattern_elliott_p5'
  // Forecasting and measurement tools
  | 'rr_long'
  | 'rr_short'
  | 'ruler_start'
  | 'ruler_end'
  | 'projection_start'
  | 'projection_end'
  // Geometric shapes
  | 'rect_start'
  | 'rect_end'
  | 'circle_start'
  | 'circle_end'
  | 'brush'
  // Annotation tools
  | 'annotation'
  | 'callout'
  | 'price_label'
  | 'arrow_up'
  | 'arrow_down';

export interface TrendlineDrawing {
  start: ChartPoint;
  end: ChartPoint;
  color?: string;
}

export interface HorizontalRayDrawing {
  id: string;
  start: ChartPoint;
  color?: string;
}

export interface VerticalLineDrawing {
  id: string;
  time: number;
  color?: string;
  label?: string;
}

export interface ParallelChannelDrawing {
  id: string;
  p1: ChartPoint;
  p2: ChartPoint;
  p3: ChartPoint;
  color?: string;
}

export interface AnnotationDrawing {
  time: number;
  price: number;
  text: string;
  color?: string;
}

export interface CalloutDrawing {
  id: string;
  target: ChartPoint;
  text: string;
  color?: string;
}

export interface PriceLabelDrawing {
  id: string;
  point: ChartPoint;
  color?: string;
}

export interface ArrowDrawing {
  id: string;
  point: ChartPoint;
  direction: 'up' | 'down';
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

export interface FibExtensionDrawing {
  id: string;
  p1: ChartPoint;
  p2: ChartPoint;
  p3: ChartPoint;
  color?: string;
}

export interface GannBoxDrawing {
  id: string;
  start: ChartPoint;
  end: ChartPoint;
  color?: string;
}

export interface RectangleDrawing {
  id: string;
  start: ChartPoint;
  end: ChartPoint;
  color?: string;
  label?: string;
}

export interface CircleDrawing {
  id: string;
  center: ChartPoint;
  edge: ChartPoint;
  color?: string;
}

export interface RulerDrawing {
  id: string;
  start: ChartPoint;
  end: ChartPoint;
  bars: number;
  pips: number;
  percent: number;
  timeDiffStr: string;
}

export interface ChartPatternDrawing {
  id: string;
  type: 'head_shoulders' | 'xabcd' | 'elliott_wave';
  points: ChartPoint[];
  labels: string[];
  color?: string;
}

export type HorizontalLineDrawing = number | { price: number; color?: string };

export interface DrawingsState {
  horizontalLines: HorizontalLineDrawing[];
  trendlines: TrendlineDrawing[];
  horizontalRays?: HorizontalRayDrawing[];
  verticalLines?: VerticalLineDrawing[];
  parallelChannels?: ParallelChannelDrawing[];
  annotations: AnnotationDrawing[];
  callouts?: CalloutDrawing[];
  priceLabels?: PriceLabelDrawing[];
  arrows?: ArrowDrawing[];
  riskRewards: RiskRewardDrawing[];
  fibonacci: FibonacciDrawing[];
  fibExtensions?: FibExtensionDrawing[];
  gannBoxes?: GannBoxDrawing[];
  rectangles?: RectangleDrawing[];
  circles?: CircleDrawing[];
  rulers?: RulerDrawing[];
  chartPatterns?: ChartPatternDrawing[];
}

export interface ChartUtilitiesState {
  magnetMode: boolean;
  lockDrawings: boolean;
  hideAllDrawings: boolean;
  cursorType: CursorType;
}

export const EMPTY_DRAWINGS: DrawingsState = {
  horizontalLines: [],
  trendlines: [],
  horizontalRays: [],
  verticalLines: [],
  parallelChannels: [],
  annotations: [],
  callouts: [],
  priceLabels: [],
  arrows: [],
  riskRewards: [],
  fibonacci: [],
  fibExtensions: [],
  gannBoxes: [],
  rectangles: [],
  circles: [],
  rulers: [],
  chartPatterns: [],
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
