/**
 * Cached indicator set - prevents redundant recalculation of the same indicator
 * arrays on every signal/pattern generation cycle.
 *
 * This module wraps the canonical indicator implementations in forexData.ts
 * so there is a single source of truth.
 */
import { Candlestick } from '../types';
import {
  computeSMA,
  computeEMA,
  computeRSI,
  computeBollingerBands,
  computeMACD,
  computeFibonacci,
  computeATR,
} from './forexData';

export interface CachedIndicators {
  sma: ReturnType<typeof computeSMA>;
  ema: ReturnType<typeof computeEMA>;
  rsi: ReturnType<typeof computeRSI>;
  macd: ReturnType<typeof computeMACD>;
  bollinger: ReturnType<typeof computeBollingerBands>;
  fibonacci: ReturnType<typeof computeFibonacci>;
  atr: ReturnType<typeof computeATR>;
  dataLength: number;
  lastCandleTime: number;
  lastCandleClose: number;
}

/**
 * Global cache keyed by "symbol_timeframe" to avoid recomputing indicators
 * when multiple consumers (signal, patterns, chart) request them in the same tick.
 */
const indicatorCache = new Map<string, CachedIndicators>();
const CACHE_MAX_SIZE = 16;

/**
 * Check if cached indicators are still valid. Invalid if:
 * - Data length changed (new candles added)
 * - Last candle's timestamp changed (current candle closed/updated)
 * - Last candle's close changed materially (live tick updated the bar)
 */
function isCacheValid(cached: CachedIndicators, data: Candlestick[]): boolean {
  if (cached.dataLength !== data.length) return false;
  if (data.length === 0) return false;
  const lastCandle = data[data.length - 1];
  if (cached.lastCandleTime !== lastCandle.time) return false;
  if (Math.abs(cached.lastCandleClose - lastCandle.close) > 1e-9) return false;
  return true;
}

/**
 * Get or compute all indicators for a symbol/timeframe.
 */
export function getCachedIndicators(
  symbol: string,
  timeframe: string,
  data: Candlestick[]
): CachedIndicators {
  const cacheKey = `${symbol}_${timeframe}`;
  const cached = indicatorCache.get(cacheKey);
  if (cached && isCacheValid(cached, data)) return cached;

  const indicators: CachedIndicators = {
    sma: computeSMA(data, 20),
    ema: computeEMA(data, 50),
    rsi: computeRSI(data, 14),
    macd: computeMACD(data),
    bollinger: computeBollingerBands(data, 20, 2),
    fibonacci: computeFibonacci(data),
    atr: computeATR(data, 14),
    dataLength: data.length,
    lastCandleTime: data.length > 0 ? data[data.length - 1].time : 0,
    lastCandleClose: data.length > 0 ? data[data.length - 1].close : 0,
  };

  if (indicatorCache.size >= CACHE_MAX_SIZE) {
    const firstKey = indicatorCache.keys().next().value;
    if (firstKey) indicatorCache.delete(firstKey);
  }
  indicatorCache.set(cacheKey, indicators);
  return indicators;
}

export function clearIndicatorCache() {
  indicatorCache.clear();
}

export function getIndicatorCacheStats() {
  return { size: indicatorCache.size, keys: Array.from(indicatorCache.keys()) };
}
