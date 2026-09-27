import type { Candlestick } from '../../src/types';
import { candleBucketStart } from '../../shared/timeframes';

export function usableBar(c: Candlestick): boolean {
  return Number.isInteger(c.time) && c.time > 0 && [c.open, c.high, c.low, c.close].every(n => Number.isFinite(n) && n > 0) &&
    c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.high >= c.low &&
    (c.volume === undefined || (Number.isFinite(c.volume) && c.volume >= 0));
}
export function cleanBars(candles: Candlestick[]): Candlestick[] {
  return [...new Map(candles.filter(usableBar).map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time).slice(-5000);
}
/** Aggregate available DAILY OHLC, never quote snapshots. Missing sessions/weeks are not filled. */
export function weeklyBars(daily: Candlestick[], now = Date.now()): Candlestick[] {
  const bars = cleanBars(daily);
  const weeks = new Map<number, Candlestick>();
  for (const bar of bars) {
    const time = candleBucketStart(bar.time, 'W');
    const existing = weeks.get(time);
    const provisional = time + 604800 > now / 1000 || bar.provisional === true || (bar === bars[0] && bar.time !== time);
    if (!existing) weeks.set(time, { ...bar, time, provisional });
    else {
      existing.high = Math.max(existing.high, bar.high); existing.low = Math.min(existing.low, bar.low); existing.close = bar.close;
      existing.volume = existing.volume !== undefined && bar.volume !== undefined ? existing.volume + bar.volume : undefined;
      existing.provisional ||= provisional;
    }
  }
  return [...weeks.values()];
}
