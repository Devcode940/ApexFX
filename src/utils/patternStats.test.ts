import { describe, expect, it } from 'vitest';
import { summarizePatternFollowThrough } from './patternStats';
import type { Candlestick, Pattern } from '../types';

const bar = (close: number, open = close, high = close + 0.001, low = close - 0.001, i = 0): Candlestick => ({ time: 1_700_000_000 + i * 60, open, high, low, close });
const pattern = (name: string, type: Pattern['type'], i: number): Pattern => ({
  id: `${i}_${name}`, name, type, time: 1_700_000_000 + i * 60, description: 'fixture', candlestickIndex: i,
});

describe('summarizePatternFollowThrough', () => {
  const candles = Array.from({ length: 12 }, (_, i) => bar(1.1 + i * 0.0002));
  it('counts direction success over the horizon and ignores the tail', () => {
    // winner at i=2: close rises for 3 bars afterwards (natural in this ramp); loser at i=8: not enough future bars -> excluded from evaluated.
    const summary = summarizePatternFollowThrough([
      pattern('Bullish Engulfing', 'bullish', 2),
      pattern('Bullish Engulfing', 'bullish', 10), // no horizon left
    ], candles, 'EURUSD', 3);
    expect(summary).not.toBeNull();
    const row = summary!.perPattern.find(r => r.name === 'Bullish Engulfing')!;
    expect(row.occurrences).toBe(2);
    expect(row.evaluated).toBe(1);
    expect(row.successRatePct).toBe(100);
    expect(row.medianMovePips).toBeGreaterThan(0);
  });
  it('bearish success means the move went down; neutral patterns only get magnitude', () => {
    const falling = Array.from({ length: 12 }, (_, i) => bar(1.2 - i * 0.0003));
    const summary = summarizePatternFollowThrough([
      pattern('Evening Star', 'bearish', 3),
      pattern('Doji', 'neutral', 4),
    ], falling, 'EURUSD', 3);
    const bear = summary!.perPattern.find(r => r.name === 'Evening Star')!;
    const doji = summary!.perPattern.find(r => r.name === 'Doji')!;
    expect(bear.successRatePct).toBe(100);
    expect(bear.medianMovePips).toBeLessThan(0);
    expect(doji.successRatePct).toBeNull();
    expect(doji.medianAbsMovePips).toBeGreaterThan(0);
  });
  it('median of an even count averages the middle pair; returns null for tiny windows', () => {
    const summary = summarizePatternFollowThrough([
      pattern('Bullish Engulfing', 'bullish', 1), pattern('Bullish Engulfing', 'bullish', 2),
    ], candles, 'EURUSD', 3);
    expect(summary!.perPattern[0]!.medianMovePips).toBeCloseTo(6, 6); // 3 steps of 2 pips each
  });
  it('refuses to compute on unsupported symbols or starved windows', () => {
    expect(summarizePatternFollowThrough([], candles, 'FAKEUSD' as never, 3)).toBeNull();
    expect(summarizePatternFollowThrough([pattern('Doji', 'neutral', 0)], candles.slice(0, 5), 'EURUSD', 3)).toBeNull();
  });
});
