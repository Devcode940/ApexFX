import { Candlestick } from '../types';

/**
 * Cached indicator set - prevents redundant recalculation of the same indicator
 * arrays on every signal/pattern generation cycle.
 */
export interface CachedIndicators {
  sma: (number | null)[];
  ema: (number | null)[];
  rsi: (number | null)[];
  macd: { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] };
  bollinger: { basis: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] };
  fibonacci: ReturnType<typeof computeFibonacci> | null;
  atr: (number | null)[];
  dataLength: number;
  lastCandleTime: number;
}

/**
 * Global cache keyed by "symbol_timeframe" to avoid recomputing indicators
 * when multiple consumers (signal, patterns) request them in the same tick.
 */
const indicatorCache = new Map<string, CachedIndicators>();
const CACHE_MAX_SIZE = 16; // Keep last 16 symbol/timeframe combos in memory

function computeSMA(data: Candlestick[], period = 20): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      sma.push(sum / period);
    }
  }
  return sma;
}

function computeEMA(data: Candlestick[], period = 50): (number | null)[] {
  const ema: (number | null)[] = [];
  if (data.length === 0) return ema;

  const k = 2 / (period + 1);
  let prevEma = data[0].close;
  ema.push(prevEma);

  for (let i = 1; i < data.length; i++) {
    const nextEma = data[i].close * k + prevEma * (1 - k);
    ema.push(nextEma);
    prevEma = nextEma;
  }

  for (let i = 0; i < Math.min(data.length, Math.floor(period / 3)); i++) {
    ema[i] = null;
  }
  return ema;
}

function computeRSI(data: Candlestick[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = [];
  if (data.length <= period) {
    return Array(data.length).fill(null);
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) {
    rsi.push(null);
  }

  const initialRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + initialRs));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}

function computeBollingerBands(data: Candlestick[], period = 20, multiplier = 2) {
  const sma = computeSMA(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    const smaVal = sma[i];
    if (smaVal === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let sumSqDiff = 0;
      for (let j = 0; j < period; j++) {
        sumSqDiff += Math.pow(data[i - j].close - smaVal, 2);
      }
      const dev = Math.sqrt(sumSqDiff / period);
      upper.push(smaVal + multiplier * dev);
      lower.push(smaVal - multiplier * dev);
    }
  }

  return { basis: sma, upper, lower };
}

function computeMACD(data: Candlestick[], fast = 12, slow = 26, signal = 9) {
  const emaFast = computeEMA(data, fast);
  const emaSlow = computeEMA(data, slow);
  
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (f === null || s === null) {
      macdLine.push(null);
    } else {
      macdLine.push(f - s);
    }
  }

  const macdSignal: (number | null)[] = [];
  const k = 2 / (signal + 1);
  let firstValidIdx = -1;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      firstValidIdx = i;
      break;
    }
  }

  if (firstValidIdx === -1) {
    return { macd: macdLine, signal: Array(data.length).fill(null), histogram: Array(data.length).fill(null) };
  }

  for (let i = 0; i < macdLine.length; i++) {
    if (i < firstValidIdx) {
      macdSignal.push(null);
    } else if (i === firstValidIdx) {
      macdSignal.push(macdLine[i]);
    } else {
      const prevSig = macdSignal[i - 1];
      const curMacd = macdLine[i];
      if (prevSig === null || curMacd === null) {
        macdSignal.push(null);
      } else {
        macdSignal.push(curMacd * k + prevSig * (1 - k));
      }
    }
  }

  const histogram: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    const m = macdLine[i];
    const s = macdSignal[i];
    if (m === null || s === null) {
      histogram.push(null);
    } else {
      histogram.push(m - s);
    }
  }

  return { macd: macdLine, signal: macdSignal, histogram };
}

function computeFibonacci(data: Candlestick[]) {
  if (data.length === 0) return null;
  const window = data.slice(-100);
  let highest = -Infinity;
  let lowest = Infinity;
  let highestIdx = 0;
  let lowestIdx = 0;

  window.forEach((candle, idx) => {
    if (candle.high > highest) {
      highest = candle.high;
      highestIdx = idx;
    }
    if (candle.low < lowest) {
      lowest = candle.low;
      lowestIdx = idx;
    }
  });

  const isDowntrend = highestIdx < lowestIdx;
  const range = highest - lowest;

  return {
    isDowntrend,
    high: highest,
    low: lowest,
    r236: isDowntrend ? highest - range * 0.236 : lowest + range * 0.236,
    r382: isDowntrend ? highest - range * 0.382 : lowest + range * 0.382,
    r500: isDowntrend ? highest - range * 0.500 : lowest + range * 0.500,
    r618: isDowntrend ? highest - range * 0.618 : lowest + range * 0.618,
  };
}

function computeATR(data: Candlestick[], period = 14): (number | null)[] {
  const atr: (number | null)[] = Array(data.length).fill(null);
  if (data.length <= period) {
    return atr;
  }
  
  const tr: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
    } else {
      const h_l = data[i].high - data[i].low;
      const h_pc = Math.abs(data[i].high - data[i - 1].close);
      const l_pc = Math.abs(data[i].low - data[i - 1].close);
      tr.push(Math.max(h_l, h_pc, l_pc));
    }
  }

  let sumTr = 0;
  for (let i = 0; i < period; i++) {
    sumTr += tr[i];
  }
  let currentAtr = sumTr / period;
  atr[period - 1] = currentAtr;

  for (let i = period; i < data.length; i++) {
    currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
    atr[i] = currentAtr;
  }

  return atr;
}

/**
 * Check if cached indicators are still valid. Invalid if:
 * - Data length changed (new candles added)
 * - Last candle's timestamp changed (current candle closed/updated)
 */
function isCacheValid(cached: CachedIndicators, data: Candlestick[]): boolean {
  if (cached.dataLength !== data.length) return false;
  if (data.length === 0) return false;
  const lastCandle = data[data.length - 1];
  if (cached.lastCandleTime !== lastCandle.time) return false;
  return true;
}

/**
 * Get or compute all indicators for a symbol/timeframe.
 * Uses cache to avoid redundant calculations within the same tick.
 */
export function getCachedIndicators(
  symbol: string,
  timeframe: string,
  data: Candlestick[]
): CachedIndicators {
  const cacheKey = `${symbol}_${timeframe}`;
  const cached = indicatorCache.get(cacheKey);

  if (cached && isCacheValid(cached, data)) {
    return cached;
  }

  // Compute all indicators
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
  };

  // Evict oldest cache entries if map is getting too large
  if (indicatorCache.size >= CACHE_MAX_SIZE) {
    const firstKey = indicatorCache.keys().next().value;
    if (firstKey) indicatorCache.delete(firstKey);
  }

  indicatorCache.set(cacheKey, indicators);
  return indicators;
}

/**
 * Clear the entire indicator cache. Useful on app reset or heavy data refresh.
 */
export function clearIndicatorCache() {
  indicatorCache.clear();
}

/**
 * Get cache statistics for debugging/monitoring.
 */
export function getIndicatorCacheStats() {
  return {
    size: indicatorCache.size,
    keys: Array.from(indicatorCache.keys()),
  };
}
