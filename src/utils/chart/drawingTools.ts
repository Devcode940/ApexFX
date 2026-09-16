import { IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, LineSeries, LineStyle } from 'lightweight-charts';
import { PAIRS_CONFIG } from '../forexData';
import type { Candlestick } from '../../types';
import type {
  ChartPoint,
  DrawingsState,
  HorizontalLineDrawing,
  RiskRewardDrawing,
  TrendlineDrawing,
  RulerDrawing,
} from '../../types/chart';
import { EMPTY_DRAWINGS } from '../../types/chart';

const STORAGE_PREFIX = 'forexinsight_drawings_';

let memoryStorage: Record<string, string> = {};

function getStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    // fallback
  }
  return memoryStorage[key] ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // fallback
  }
  memoryStorage[key] = value;
}

export function loadDrawings(symbol: string): DrawingsState {
  try {
    const cached = getStorageItem(`${STORAGE_PREFIX}${symbol}`);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<DrawingsState>;
      return {
        horizontalLines: parsed.horizontalLines || [],
        trendlines: parsed.trendlines || [],
        horizontalRays: parsed.horizontalRays || [],
        verticalLines: parsed.verticalLines || [],
        parallelChannels: parsed.parallelChannels || [],
        annotations: parsed.annotations || [],
        callouts: parsed.callouts || [],
        priceLabels: parsed.priceLabels || [],
        arrows: parsed.arrows || [],
        riskRewards: parsed.riskRewards || [],
        fibonacci: parsed.fibonacci || [],
        fibExtensions: parsed.fibExtensions || [],
        gannBoxes: parsed.gannBoxes || [],
        rectangles: parsed.rectangles || [],
        circles: parsed.circles || [],
        rulers: parsed.rulers || [],
        chartPatterns: parsed.chartPatterns || [],
      };
    }
  } catch {
    // ignore corrupted cache
  }
  return EMPTY_DRAWINGS;
}

export function saveDrawings(symbol: string, drawings: DrawingsState): void {
  try {
    setStorageItem(`${STORAGE_PREFIX}${symbol}`, JSON.stringify(drawings));
  } catch {
    // storage may be unavailable (private mode / quota)
  }
}

/** Magnet mode snap helper: find the nearest O/H/L/C of candle nearest to click time */
export function findMagnetPrice(clickedPrice: number, clickedTime: number, data: Candlestick[]): number {
  if (!data || data.length === 0) return clickedPrice;
  // Find candle with closest timestamp
  let closest = data[0];
  let minTimeDiff = Math.abs(closest.time - clickedTime);
  for (let i = 1; i < data.length; i++) {
    const diff = Math.abs(data[i].time - clickedTime);
    if (diff < minTimeDiff) {
      minTimeDiff = diff;
      closest = data[i];
    }
  }

  // Find which of O, H, L, C is closest to clickedPrice
  const levels = [closest.open, closest.high, closest.low, closest.close];
  let closestLevel = levels[0];
  let minPriceDiff = Math.abs(closestLevel - clickedPrice);
  for (let j = 1; j < levels.length; j++) {
    const pDiff = Math.abs(levels[j] - clickedPrice);
    if (pDiff < minPriceDiff) {
      minPriceDiff = pDiff;
      closestLevel = levels[j];
    }
  }
  return closestLevel;
}

/** Compute distance metrics for measurement ruler */
export function computeRulerStats(
  start: ChartPoint,
  end: ChartPoint,
  data: Candlestick[],
  symbol: string
): RulerDrawing {
  const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
  const pip = Math.pow(10, -config.pipDecimal);

  const priceDiff = end.price - start.price;
  const pips = parseFloat((priceDiff / pip).toFixed(1));
  const percent = parseFloat(((priceDiff / (start.price || 1)) * 100).toFixed(2));

  // Count bars between start and end
  const tMin = Math.min(start.time, end.time);
  const tMax = Math.max(start.time, end.time);
  const bars = data.filter((c) => c.time >= tMin && c.time <= tMax).length || 1;

  const seconds = tMax - tMin;
  const hours = Math.round(seconds / 3600);
  const days = Math.round(hours / 24);
  const timeDiffStr = days >= 2 ? `${days}d ${hours % 24}h` : `${hours}h`;

  return {
    id: Date.now().toString(),
    start,
    end,
    bars,
    pips,
    percent,
    timeDiffStr,
  };
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
