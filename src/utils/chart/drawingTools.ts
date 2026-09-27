import { IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, LineSeries, LineStyle } from 'lightweight-charts';
import { PAIRS_CONFIG } from '../forexData';
import type {
  ChartPoint,
  DrawingsState,
  HorizontalLineDrawing,
  RiskRewardDrawing,
  TrendlineDrawing,
} from '../../types/chart';
import { EMPTY_DRAWINGS } from '../../types/chart';

export const drawingStorageKey = (symbol: string, owner = 'guest') => `apexfx:drawings:v2:${owner}:${symbol}`;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const point = (v: unknown) => record(v) && positive(v.time) && positive(v.price);
const color = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= 60);
const identity = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v);
export function parseDrawings(value: unknown): DrawingsState {
  if (!record(value)) throw new Error('Invalid drawings object');
  const checks: Record<keyof DrawingsState, (v: unknown) => boolean> = {
    horizontalLines: v => positive(v) || (record(v) && positive(v.price) && color(v.color)),
    trendlines: v => record(v) && point(v.start) && point(v.end) && color(v.color),
    annotations: v => record(v) && point(v) && typeof v.text === 'string' && v.text.length <= 240 && color(v.color),
    riskRewards: v => record(v) && identity(v.id) && ['long', 'short'].includes(String(v.type)) && point(v.entry) && positive(v.sl) && positive(v.tp),
    fibonacci: v => record(v) && identity(v.id) && point(v.start) && point(v.end) && color(v.color),
  };
  const output: Record<string, unknown[]> = {};
  for (const key of Object.keys(checks) as (keyof DrawingsState)[]) {
    const rows = value[key] ?? [];
    if (!Array.isArray(rows) || rows.length > 500 || !rows.every(checks[key])) throw new Error(`Invalid ${key} drawings`);
    output[key] = rows;
  }
  return output as unknown as DrawingsState;
}
export function loadDrawings(symbol: string, owner = 'guest'): DrawingsState {
  const raw = localStorage.getItem(drawingStorageKey(symbol, owner));
  return raw ? parseDrawings(JSON.parse(raw)) : EMPTY_DRAWINGS;
}
export function saveDrawings(symbol: string, drawings: DrawingsState, owner = 'guest'): void {
  localStorage.setItem(drawingStorageKey(symbol, owner), JSON.stringify(parseDrawings(drawings)));
}

export interface ResolvedHorizontalLine {
  price: number;
  color: string;
}

export function resolveHorizontalLine(item: HorizontalLineDrawing): ResolvedHorizontalLine {
  if (typeof item === 'number') {
    return { price: item, color: '#22c55e' };
  }
  return { price: item.price, color: item.color || '#22c55e' };
}

/** Draw all support/resistance levels as price lines. Returns them for cleanup. */
export function createHorizontalPriceLines(
  candleSeries: ISeriesApi<'Candlestick'>,
  lines: HorizontalLineDrawing[]
): IPriceLine[] {
  return lines.map((item) => {
    const { price, color } = resolveHorizontalLine(item);
    return candleSeries.createPriceLine({
      price,
      color,
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      title: 'SUPPORT/RESISTANCE',
      axisLabelVisible: true,
    });
  });
}

/**
 * Draw trendlines as 2-point line series (times sorted ascending, which
 * lightweight-charts requires). Returns the series for cleanup.
 */
export function createTrendlineSeries(
  chart: IChartApi,
  trendlines: TrendlineDrawing[]
): ISeriesApi<'Line'>[] {
  return trendlines.map((tl, index) => {
    const color = tl.color || '#eab308';
    const sortedPoints = [tl.start, tl.end].sort((a, b) => a.time - b.time);
    const series = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      title: `Trendline ${index + 1}`,
    });
    series.setData([
      { time: sortedPoints[0].time as UTCTimestamp, value: sortedPoints[0].price },
      ...(sortedPoints[1].time !== sortedPoints[0].time ? [{ time: sortedPoints[1].time as UTCTimestamp, value: sortedPoints[1].price }] : []),
    ]);
    return series;
  });
}

/** Default SL / TP offsets (in pips) applied when placing a risk/reward tool. */
export const RR_PIPS = { sl: 20, tp: 40 };

export interface RrPlacement {
  sl: number;
  tp: number;
}

/** Compute SL/TP prices for a long/short entry at `price` on `symbol`. */
export function rrPlacement(type: RiskRewardDrawing['type'], price: number, symbol: string): RrPlacement {
  const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
  const pip = Math.pow(10, -config.pipDecimal);
  return type === 'long'
    ? { sl: price - RR_PIPS.sl * pip, tp: price + RR_PIPS.tp * pip }
    : { sl: price + RR_PIPS.sl * pip, tp: price - RR_PIPS.tp * pip };
}

export function newRiskRewardTool(
  type: RiskRewardDrawing['type'],
  entry: ChartPoint,
  symbol: string
): RiskRewardDrawing {
  const { sl, tp } = rrPlacement(type, entry.price, symbol);
  return { id: Date.now().toString(), type, entry, tp, sl };
}

export type { ChartPoint };
