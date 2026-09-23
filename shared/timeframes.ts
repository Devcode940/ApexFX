/** Canonical chart periods. W is Monday 00:00 UTC through the next Monday, not epoch Thursday. */
export const TIME_CONFIG = {
  '1m': { label: '1 Minute', offsetSec: 60 },
  '5m': { label: '5 Minutes', offsetSec: 300 },
  '15m': { label: '15 Minutes', offsetSec: 900 },
  '1H': { label: '1 Hour', offsetSec: 3600 },
  '4H': { label: '4 Hours', offsetSec: 14400 },
  D: { label: '1 Day', offsetSec: 86400 },
  W: { label: '1 Week (Monday UTC)', offsetSec: 604800 },
} as const;
export type Timeframe = keyof typeof TIME_CONFIG;
export const TIMEFRAMES = Object.keys(TIME_CONFIG) as Timeframe[];
export const isTimeframe = (value: unknown): value is Timeframe => typeof value === 'string' && Object.hasOwn(TIME_CONFIG, value);
export function candleBucketStart(time: number, timeframe: Timeframe): number {
  const seconds = TIME_CONFIG[timeframe].offsetSec;
  const anchor = timeframe === 'W' ? 4 * 86400 : 0; // 1970-01-05 was Monday
  return Math.floor((time - anchor) / seconds) * seconds + anchor;
}
