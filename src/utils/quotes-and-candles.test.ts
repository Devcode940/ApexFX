import { candleBucketStart } from '../../shared/timeframes';
import { describe, it, expect } from 'vitest';
import { QuoteStore } from './quoteStore';
import { isExecutableQuote, quoteQuality, sourceOf } from '../../shared/market';
import { applyQuoteToCandles, parseCandles, reconcileHistory } from './candles';
import { detectPatterns, computeATR, TIME_CONFIG } from './forexData';
import { quote } from '../test/fixtures';
import type { Timeframe } from '../types';

const bar = (time: number, close = 1.1) => ({ time, open: 1.1, high: Math.max(1.11, close), low: Math.min(1.09, close), close, volume: 100 });
describe('quote quality and ordered events', () => {
  it('emits every touch and rebound synchronously, even within one JavaScript task', () => {
    const store = new QuoteStore(); const seen: number[] = [];
    store.subscribe(e => seen.push(e.changed[0].price));
    [1.1, 1.08, 1.1].forEach(price => store.apply({ EURUSD: quote('EURUSD', price) }));
    expect(seen).toEqual([1.1, 1.08, 1.1]);
  });
  it('rejects delayed reference, unknown, out-of-order and future observations', () => {
    const store = new QuoteStore(); const q = quote('EURUSD', 1.2);
    store.apply({ EURUSD: q });
    expect(store.apply({ EURUSD: { ...q, price: 1.1, provider: 'frankfurter', instrumentKind: 'reference' } })).toBe(0);
    expect(store.apply({ EURUSD: { ...q, price: 1.1, provider: null, instrumentKind: 'unknown' } })).toBe(0);
    expect(store.apply({ EURUSD: { ...q, price: 1.1, asOf: q.asOf! - 10 } })).toBe(0);
    expect(store.apply({ EURUSD: { ...q, price: 2, asOf: Date.now() + 3_600_000 } })).toBe(0);
    expect(store.get('EURUSD')?.price).toBe(1.2);
  });
  it('treats response time and a positive price as insufficient evidence of freshness', () => {
    const stale = quote('EURUSD', 1.1, { asOf: Date.now() - 180_000 });
    expect(quoteQuality(stale)).toBe('stale'); expect(isExecutableQuote(stale)).toBe(false);
    expect(quoteQuality({ price: 1.1 })).toBe('unknown');
    expect(isExecutableQuote({ price: 1.1 })).toBe(false);
  });
  it('labels futures as fresh observations without enabling spot execution', () => {
    const future = quote('XAGUSD', 30, { provider: 'yahoo', providerSymbol: 'SI=F', instrumentKind: 'futures' });
    expect(quoteQuality(future)).toBe('fresh'); expect(isExecutableQuote(future)).toBe(false);
    expect(sourceOf([future, quote()])).toBe('mixed');
  });
  it('rejects malformed network values', () => {
    const store = new QuoteStore();
    expect(store.apply({ EURUSD: { price: -1 }, NOTREAL: quote(), USDJPY: 150 })).toBe(0);
    expect(store.snapshot()).toEqual([]);
  });
});

describe('timestamp-based candle lifecycle', () => {
  for (const timeframe of Object.keys(TIME_CONFIG) as Timeframe[]) {
    it(`updates and rolls ${timeframe} at the bucket boundary, without fabricated gap bars`, () => {
      const seconds = TIME_CONFIG[timeframe].offsetSec;
      const now = Date.now(); const bucket = candleBucketStart(now / 1000, timeframe);
      const initial = [bar(bucket - seconds)];
      const q = quote('EURUSD', 1.12, { asOf: now, receivedAt: now });
      const next = applyQuoteToCandles(initial, q, timeframe, now);
      expect(next).toHaveLength(2); expect(next[1]).toMatchObject({ time: bucket, open: 1.12, close: 1.12, provisional: true });
      const same = applyQuoteToCandles(next, { ...q, price: 1.13 }, timeframe, now);
      expect(same).toHaveLength(2); expect(same[1].high).toBe(1.13); expect(same[1].open).toBe(1.12);
      const later = now + seconds * 3000;
      const gap = applyQuoteToCandles(same, { ...q, asOf: later, receivedAt: later }, timeframe, later);
      expect(gap).toHaveLength(3); expect(gap.at(-1)?.time).toBe(bucket + seconds * 3);
    });
  }
  it('keeps non-UTC provider-session bars intact instead of mixing overlapping UTC bars', () => {
    const bucket = Math.floor(Date.now() / 3_600_000) * 3600;
    const data = [bar(bucket - 1800)];
    expect(applyQuoteToCandles(data, quote('EURUSD', 1.13), '1H')).toBe(data);
  });
  it('ignores older same-bucket events', () => {
    const now = Date.now(); const time = Math.floor(now / 3_600_000) * 3600;
    const initial = [{ ...bar(time), updatedAt: now }];
    expect(applyQuoteToCandles(initial, quote('EURUSD', 1.09, { asOf: now - 1000 }), '1H')).toBe(initial);
  });
  it('sorts/deduplicates history and rejects invalid OHLC', () => {
    expect(parseCandles([bar(2000), bar(1000), bar(2000, 1.12)]).map(c => c.time)).toEqual([1000, 2000]);
    expect(() => parseCandles([bar(2000, NaN)])).toThrow();
    expect(() => parseCandles([{ ...bar(2000), low: 2 }])).toThrow();
  });
  it('reconciles authoritative history without discarding observations made during the fetch', () => {
    const history = [bar(1000), bar(2000)];
    const local = [{ ...bar(1000, 1.12), updatedAt: 100 }, { ...bar(2000, 1.13), updatedAt: 300 }, { ...bar(3000, 1.14), updatedAt: 350 }];
    const result = reconcileHistory(history, local, 200);
    expect(result[0].close).toBe(1.1); expect(result[1].close).toBe(1.13); expect(result[2].time).toBe(3000);
  });
});
describe('causal heuristic scores', () => {
  it('appending high future volume cannot change existing closed-candle patterns or their scores', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ ...bar(1_700_000_000 + i * 3600), volume: i === 40 ? 1000 : 100 }));
    const patterns = detectPatterns(data);
    expect(patterns.length).toBeGreaterThan(0);
    const future = Array.from({ length: 40 }, (_, i) => ({ ...bar(1_700_000_000 + (i + 50) * 3600), volume: 10_000_000 }));
    const appended = detectPatterns([...data, ...future]).filter(p => p.candlestickIndex < data.length);
    expect(appended).toEqual(patterns);
    expect(patterns.every(p => !('winRate' in p))).toBe(true);
  });
  it('initializes ATR at exactly the requested period', () => {
    expect(computeATR(Array.from({ length: 14 }, (_, i) => bar(i + 1)), 14).at(-1)).not.toBeNull();
  });
});
