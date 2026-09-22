import { describe, it, expect } from 'vitest';
import { aggregateCandlesByEpoch } from './yahoo';

const c = (time: number, o: number) => ({ time, open: o, high: o + 1, low: o - 1, close: o + 0.5, volume: 10 });

describe('aggregateCandlesByEpoch (4H from 1h)', () => {
  const B0 = 1_700_000_000 - (1_700_000_000 % 14400); // aligned to a 4h boundary

  it('groups four hourly candles into one OHLCV bar', () => {
    const out = aggregateCandlesByEpoch([c(B0, 1), c(B0 + 3600, 2), c(B0 + 7200, 3), c(B0 + 10800, 4)], 14400);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ time: B0, open: 1, close: 4.5, volume: 40 });
    expect(out[0].high).toBe(5); // 4 + 1
    expect(out[0].low).toBe(0);  // 1 - 1
  });

  it('is robust to a missing hour (the index-chunking bug)', () => {
    // Hour 2 is absent (weekend/holiday gap). Index-based `i += 4` would slide the boundary and
    // merge the next bucket's first candle in; epoch bucketing must not.
    const gap = [c(B0, 1), c(B0 + 3600, 2), /* missing */ c(B0 + 7200, 3)];
    const next = [c(B0 + 14400, 10), c(B0 + 18000, 11), c(B0 + 21600, 12), c(B0 + 25200, 13)];
    const out = aggregateCandlesByEpoch([...gap, ...next], 14400);
    expect(out.map((b) => b.time)).toEqual([B0, B0 + 14400]);
    expect(out[1].open).toBe(10);   // never bleeds into the first bucket
    expect(out[0].close).toBe(3.5);
  });

  it('handles out-of-order input', () => {
    const out = aggregateCandlesByEpoch([c(B0 + 10800, 4), c(B0, 1), c(B0 + 3600, 2)], 14400);
    expect(out).toHaveLength(1);
    expect(out[0].open).toBe(1);
    expect(out[0].close).toBe(4.5);
  });

  it('returns [] for empty input and preserves monotonic ordering', () => {
    expect(aggregateCandlesByEpoch([], 14400)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => c(B0 + i * 3600, i));
    const out = aggregateCandlesByEpoch(many, 14400);
    expect(out).toHaveLength(3);
    expect(out.every((b, i) => i === 0 || b.time > out[i - 1].time)).toBe(true);
  });
});
