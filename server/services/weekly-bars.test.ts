import { describe, expect, it } from 'vitest';
import { candleBucketStart, isTimeframe, TIMEFRAMES } from '../../shared/timeframes';
import { generateSessionBlocks } from '../../src/utils/forexSessions';
import { weeklyBars } from './bars';
import { applyQuoteToCandles, hasUtcBucketGrid } from '../../src/utils/candles';
import { quote } from '../../src/test/fixtures';

const seconds = (date: string) => Date.parse(date) / 1000;
const bar = (date: string, close = 1.1, volume?: number) => ({ time: seconds(date), open: 1.1, high: Math.max(1.2, close), low: Math.min(1, close), close, volume });
describe('Monday–Sunday UTC weekly chart contract', () => {
  it.each([
    ['2026-09-20T23:59:59Z', '2026-09-14T00:00:00Z'],
    ['2026-09-21T00:00:00Z', '2026-09-21T00:00:00Z'],
    ['2026-09-27T23:59:59Z', '2026-09-21T00:00:00Z'],
    ['2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z'],
    ['2027-01-01T08:00:00Z', '2026-12-28T00:00:00Z'],
    ['2027-01-04T00:00:00Z', '2027-01-04T00:00:00Z'],
  ])('%s belongs to %s, not an epoch-Thursday bucket', (time, start) => {
    expect(candleBucketStart(seconds(time), 'W')).toBe(seconds(start));
  });
  it('uses daily OHLC opens/extremes/closes, deduplicates/sorts, marks partial weeks and leaves gaps', () => {
    const daily = [bar('2026-09-22T00:00:00Z', 1.18), bar('2026-09-02T00:00:00Z', 1.12), bar('2026-09-07T00:00:00Z'), bar('2026-09-11T00:00:00Z', 1.25), bar('2026-09-07T00:00:00Z', .95)];
    const weekly = weeklyBars(daily, Date.parse('2026-09-23T12:00:00Z'));
    expect(weekly.map(c => new Date(c.time * 1000).toISOString().slice(0, 10))).toEqual(['2026-08-31', '2026-09-07', '2026-09-21']);
    expect(weekly.map(c => c.provisional)).toEqual([true, false, true]);
    expect(weekly[1]).toMatchObject({ open: 1.1, high: 1.25, low: .95, close: 1.25 });
    expect(weekly.every(c => c.volume === undefined)).toBe(true);
  });
  it('sums volume only when all contributing daily volumes were actually supplied', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');
    expect(weeklyBars([bar('2026-09-14T00:00:00Z', 1.1, 2), bar('2026-09-15T00:00:00Z', 1.1, 3)], now)[0].volume).toBe(5);
    expect(weeklyBars([bar('2026-09-14T00:00:00Z', 1.1, 2), bar('2026-09-15T00:00:00Z')], now)[0].volume).toBeUndefined();
  });
  it('the browser preserves the same weekly grid when a fresh Monday quote opens the next bucket', () => {
    const now = Date.parse('2026-09-28T00:00:01Z');
    const initial = weeklyBars([bar('2026-09-21T00:00:00Z')], now);
    expect(hasUtcBucketGrid(initial, 'W')).toBe(true);
    const next = applyQuoteToCandles(initial, quote('EURUSD', 1.3, { asOf: now, receivedAt: now }), 'W', now);
    expect(next.map(c => c.time)).toEqual([seconds('2026-09-21T00:00:00Z'), seconds('2026-09-28T00:00:00Z')]);
    expect(next[1]).toMatchObject({ open: 1.3, close: 1.3, provisional: true });
  });
  it('does not label a whole daily/weekly candle as one intraday market session', () => {
    const enabled = { sydney: true, tokyo: true, london: true, newyork: true };
    expect(generateSessionBlocks([bar('2026-09-21T00:00:00Z')], 'W', enabled)).toEqual([]);
    expect(generateSessionBlocks([bar('2026-09-21T00:00:00Z')], 'D', enabled)).toEqual([]);
  });
  it('accepts only the seven supported periods, never prototype keys or an unimplemented monthly period', () => {
    expect(TIMEFRAMES).toEqual(['1m', '5m', '15m', '1H', '4H', 'D', 'W']);
    for (const invalid of ['M', 'constructor', '__proto__', 'toString', null]) expect(isTimeframe(invalid)).toBe(false);
  });
});
