import { IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, LineSeries, LineStyle } from 'lightweight-charts';
import { PAIRS_CONFIG } from '../forexData';
import type {
  ChartPoint,
  DrawingsState,
  HorizontalLineDrawing,
  RiskRewardDrawing,
  TrendlineDrawing,
} from '../../types/chart';

const STORAGE_PREFIX = 'forexinsight_drawings_';

export const EMPTY_DRAWINGS: DrawingsState = {
  horizontalLines: [],
  trendlines: [],
  annotations: [],
  riskRewards: [],
  fibonacci: [],
};

export function loadDrawings(symbol: string): DrawingsState {
  try {
    const cached = localStorage.getItem(`${STORAGE_PREFIX}${symbol}`);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<DrawingsState>;
      return {
        horizontalLines: parsed.horizontalLines || [],
        trendlines: parsed.trendlines || [],
        annotations: parsed.annotations || [],
        riskRewards: parsed.riskRewards || [],
        fibonacci: parsed.fibonacci || [],
      };
    }
  } catch {
    // ignore corrupted cache
  }
  return EMPTY_DRAWINGS;
}

export function saveDrawings(symbol: string, drawings: DrawingsState): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${symbol}`, JSON.stringify(drawings));
  } catch {
    // storage may be unavailable (private mode / quota)
  }
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
      { time: sortedPoints[1].time as UTCTimestamp, value: sortedPoints[1].price },
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
