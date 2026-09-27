import type { Candlestick, Timeframe } from '../types';
import { candleBucketStart } from '../../shared/timeframes';
import { quoteQuality, type MarketQuote } from '../../shared/market';

export function validCandle(value: unknown): value is Candlestick {
  if (!value || typeof value !== 'object') return false;
  const c = value as Candlestick;
  return Number.isInteger(c.time) && c.time > 0 && [c.open, c.high, c.low, c.close].every(v => Number.isFinite(v) && v > 0) &&
    c.high >= Math.max(c.open, c.close, c.low) && c.low <= Math.min(c.open, c.close, c.high) &&
    (c.volume === undefined || (Number.isFinite(c.volume) && c.volume >= 0));
}
export function parseCandles(value: unknown): Candlestick[] {
  if (!Array.isArray(value) || !value.length || value.length > 5000 || !value.every(validCandle)) throw new Error('History was empty or contained invalid OHLC bars.');
  return [...new Map(value.map(c => [c.time, { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, provisional: c.provisional === true }])).values()].sort((a, b) => a.time - b.time);
}

/** Do not overlay a UTC quote bucket on provider bars anchored to another session/calendar. */
export function hasUtcBucketGrid(data: readonly Candlestick[], timeframe: Timeframe): boolean {
  const last = data.at(-1);
  return !last || last.time === candleBucketStart(last.time, timeframe);
}

/** UTC buckets (Monday-anchored for W); no invented complete candles for weekends, disconnections, or other gaps. */
export function applyQuoteToCandles(data: Candlestick[], quote: MarketQuote, timeframe: Timeframe, now = Date.now()): Candlestick[] {
  if (quoteQuality(quote, now) !== 'fresh' || !hasUtcBucketGrid(data, timeframe)) return data;
  const time = candleBucketStart(quote.asOf! / 1000, timeframe);
  const last = data[data.length - 1];
  if (last && (time < last.time || quote.asOf! < (last.updatedAt ?? 0))) return data;
  if (!last || time > last.time) {
    // First observed price is not a claim about the true exchange open or the missing intrabar path.
    return [...data, { time, open: quote.price, high: quote.price, low: quote.price, close: quote.price,
      provisional: true, updatedAt: quote.asOf! }].slice(-1000);
  }
  if (last.close === quote.price && last.updatedAt === quote.asOf) return data;
  return [...data.slice(0, -1), { ...last, close: quote.price, high: Math.max(last.high, quote.price),
    low: Math.min(last.low, quote.price), provisional: true, updatedAt: quote.asOf! }];
}

/** Authoritative bars replace earlier local estimates; retain observations newer than the server snapshot (including cached history). */
export function reconcileHistory(history: Candlestick[], local: Candlestick[], snapshotAt: number): Candlestick[] {
  const result = new Map(history.map(c => [c.time, c]));
  const lastHistoricalTime = history.at(-1)?.time ?? 0;
  for (const c of local) {
    const authoritative = result.get(c.time);
    if (c.time > lastHistoricalTime) result.set(c.time, c);
    else if (authoritative && (c.updatedAt ?? 0) > snapshotAt) {
      result.set(c.time, { ...authoritative, close: c.close, high: Math.max(authoritative.high, c.high),
        low: Math.min(authoritative.low, c.low), provisional: true, updatedAt: c.updatedAt });
    }
  }
  return [...result.values()].sort((a, b) => a.time - b.time).slice(-1000);
}
