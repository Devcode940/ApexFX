import { describe, it, expect } from 'vitest';
import type { Candlestick } from '../types';
import { formatPrice, getContractSize, computeSMA, computeRSI, calculateVolatilityDetails, detectPatterns, generateSignal } from './forexData';
/** Deterministic candles for unit tests only (never used in the app). */
function makeCandles(count: number, startPrice = 1.08): Candlestick[] {
  const out: Candlestick[] = [];
  let price = startPrice;
  const base = 1_700_000_000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price + Math.sin(i * 0.7) * 0.0008;
    const high = Math.max(open, close) + 0.0004;
    const low = Math.min(open, close) - 0.0004;
    out.push({ time: base + i * 3600, open, high, low, close, volume: 1000 });
    price = close;
  }
  return out;
}

function makeTrendCandles(closes: number[]): Candlestick[] {
  const base = 1_700_100_000;
  return closes.map((close, i) => ({
    time: base + i * 3600,
    open: i === 0 ? close : closes[i - 1],
    high: close + 0.0003,
    low: close - 0.0003,
    close,
    volume: 1000,
  }));
}

describe('formatPrice', () => {
  it('formats forex pairs with 5 decimals', () => {
    expect(formatPrice(1.08523, 'EURUSD')).toBe('1.08523');
  });

  it('formats JPY pairs with 3 decimals', () => {
    expect(formatPrice(155.35, 'USDJPY')).toBe('155.350');
  });

  it('handles null/undefined safely', () => {
    expect(formatPrice(null as any, 'EURUSD')).toBe('0.00');
    expect(formatPrice(undefined as any, 'EURUSD')).toBe('0.00');
  });
});

describe('getContractSize', () => {
  it('uses 100,000 units for forex', () => {
    expect(getContractSize('EURUSD')).toBe(100000);
  });

  it('uses 100 troy oz per lot for gold', () => {
    expect(getContractSize('XAUUSD')).toBe(100);
  });

  it('uses 5,000 troy oz per lot for silver', () => {
    expect(getContractSize('XAGUSD')).toBe(5000);
  });
});

describe('computeSMA', () => {
  it('returns null during warmup and the correct average after', () => {
    const data = makeCandles(30);
    const sma = computeSMA(data, 20);
    expect(sma[0]).toBeNull();
    expect(sma[19]).not.toBeNull();
    const expected = data.slice(0, 20).reduce((acc, c) => acc + c.close, 0) / 20;
    expect(sma[19]).toBeCloseTo(expected, 5);
  });
});

describe('computeRSI', () => {
  it('stays within the 0-100 band', () => {
    const data = makeCandles(60);
    const rsi = computeRSI(data, 14).filter((v): v is number => v !== null);
    expect(rsi.length).toBeGreaterThan(0);
    rsi.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  it('returns 100 after the warmup when every lookback candle gains', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 1.08 + i * 0.001);
    const rsi = computeRSI(makeTrendCandles(closes), 14);
    expect(rsi[14]).toBe(100);
    expect(rsi.slice(14).every((v) => v === 100)).toBe(true);
  });

  it('returns 50 after the warmup when prices are unchanged', () => {
    const rsi = computeRSI(makeTrendCandles(Array(20).fill(1.08)), 14);
    expect(rsi[14]).toBe(50);
    expect(rsi.slice(14).every((v) => v === 50)).toBe(true);
  });
});

describe('calculateVolatilityDetails', () => {
  it('classifies a range explosion as HIGH against a calm baseline', () => {
    const data = makeCandles(30);
    const last = data[data.length - 1];
    // Latest candle explodes in range: ATR spikes relative to prior candles
    data[data.length - 1] = { ...last, high: last.high + 0.5, low: last.low - 0.5 };
    const vol = calculateVolatilityDetails(data, 'EURUSD');
    expect(vol).not.toBeNull();
    // Regression: the spike must be measured against the NON-latest baseline,
    // so it must register as HIGH rather than being dampened toward MEDIUM.
    expect(vol!.riskLevel).toBe('HIGH');
    expect(vol!.ratio).toBeGreaterThan(1.2);
  });
});

describe('detectPatterns', () => {
  it('scans generated candles without throwing and returns typed results', () => {
    const data = makeCandles(120);
    const patterns = detectPatterns(data);
    expect(Array.isArray(patterns)).toBe(true);
    patterns.forEach((p) => {
      expect(['bullish', 'bearish', 'neutral']).toContain(p.type);
      expect(p.name.length).toBeGreaterThan(0);
    });
  });
});

describe('generateSignal', () => {
  it('returns a bounded signal with sane tp/sl when a direction is given', () => {
    const data = makeCandles(60);
    const signal = generateSignal(
      'EURUSD',
      '1H',
      data,
      { sma: true, ema: true, rsi: true, macd: true, bollinger: true, fibonacci: false },
      detectPatterns(data) // reuse precomputed patterns
    );
    expect(['BUY', 'SELL', 'NEUTRAL']).toContain(signal.type);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(100);
    if (signal.type !== 'NEUTRAL') {
      expect(signal.tp).toBeGreaterThan(0);
      expect(signal.sl).toBeGreaterThan(0);
    }
  });
});

describe('candlestick library extension of detectPatterns', () => {
  const bar = (open: number, high: number, low: number, close: number, time: number): Candlestick => ({ time, open, high, low, close });
  // 20 warm-up candles keep the i>2 and indicator paths satisfied identically to production use.
  const warm = Array.from({ length: 24 }, (_, i) => bar(100 + i * 0.01, 100.2 + i * 0.01, 99.8 + i * 0.01, 100.1 + i * 0.01, 1_700_000_000 + i * 3_600));
  it('detects Three White Soldiers on a textbook run of three strong bullish closes', () => {
    const soldiers = [bar(100, 100.9, 99.9, 100.8, 1_700_001_001), bar(100.6, 101.8, 100.5, 101.7, 1_700_001_002), bar(101.5, 102.8, 101.4, 102.7, 1_700_001_003)];
    const patterns = detectPatterns([...warm, ...soldiers]);
    expect(patterns.some(pt => pt.name === 'Three White Soldiers' && pt.type === 'bullish')).toBe(true);
  });
  it('detects Dark Cloud Cover after a bullish candle on a rising board', () => {
    const prior = bar(100, 101.5, 99.9, 101.4, 1_700_001_001);
    const cover = bar(101.6, 101.9, 100.1, 100.6, 1_700_001_002);
    const patterns = detectPatterns([...warm, prior, cover]);
    expect(patterns.some(pt => pt.name === 'Dark Cloud Cover' && pt.type === 'bearish')).toBe(true);
  });
  it('tags library detections with stable ids and keeps them in the honest confluence band', () => {
    const soldiers = [bar(100, 100.9, 99.9, 100.8, 1_700_001_001), bar(100.6, 101.8, 100.5, 101.7, 1_700_001_002), bar(101.5, 102.8, 101.4, 102.7, 1_700_001_003)];
    const found = detectPatterns([...warm, ...soldiers]).filter(pt => pt.name === 'Three White Soldiers');
    expect(found.length).toBeGreaterThan(0);
    for (const pt of found) {
      expect(pt.id).toBe(`${pt.time}_three_white_soldiers`);
      expect(pt.description).toContain('library detection');
      expect(pt.confluence).toBeGreaterThanOrEqual(38);
      expect(pt.confluence).toBeLessThanOrEqual(89);
      expect(['Low', 'Medium', 'High']).toContain(pt.reliability!);
    }
  });
  it('existing bespoke detections keep priority over library matches on the same candle', () => {
    // A textbook bullish engulfing of a small red body is ALSO a Piercing-Line-adjacent shape;
    // the bespoke chain must label it 'Bullish Engulfing', never a library name.
    const prior = bar(100.5, 100.6, 99.5, 99.6, 1_700_001_001);
    const engulf = bar(99.4, 100.9, 99.3, 100.8, 1_700_001_002);
    const names = detectPatterns([...warm, prior, engulf]).map(pt => pt.name);
    expect(names).toContain('Bullish Engulfing');
    expect(names).not.toContain('Piercing Line');
  });
});
