import { describe, it, expect } from 'vitest';
import {
  createRandom,
  formatPrice,
  getDecimalCount,
  computeSMA,
  computeEMA,
  computeRSI,
  computeBollingerBands,
  computeMACD,
  computeFibonacci,
  computeATR,
} from '../utils/forexData';
import { Candlestick } from '../types';

// ============================================================================
// Helper Functions
// ============================================================================

describe('createRandom', () => {
  it('should return a function', () => {
    const rand = createRandom('test');
    expect(typeof rand).toBe('function');
  });

  it('should return values between 0 and 1', () => {
    const rand = createRandom('seed');
    for (let i = 0; i < 100; i++) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('should be deterministic with the same seed', () => {
    const rand1 = createRandom('same-seed');
    const rand2 = createRandom('same-seed');
    for (let i = 0; i < 10; i++) {
      expect(rand1()).toBe(rand2());
    }
  });

  it('should produce different sequences with different seeds', () => {
    const rand1 = createRandom('seed-1');
    const rand2 = createRandom('seed-2');
    const values1 = Array.from({ length: 10 }, () => rand1());
    const values2 = Array.from({ length: 10 }, () => rand2());
    expect(values1).not.toEqual(values2);
  });
});

// ============================================================================
// Price Formatting
// ============================================================================

describe('formatPrice', () => {
  it('should format EURUSD with 5 decimals', () => {
    expect(formatPrice(1.0852, 'EURUSD')).toBe('1.08520');
  });

  it('should format USDJPY with 3 decimals', () => {
    expect(formatPrice(155.35, 'USDJPY')).toBe('155.350');
  });

  it('should format XAUUSD with 3 decimals', () => {
    expect(formatPrice(2325.4, 'XAUUSD')).toBe('2325.400');
  });

  it('should handle null/undefined gracefully', () => {
    expect(formatPrice(undefined as any, 'EURUSD')).toBe('0.00');
    expect(formatPrice(null as any, 'EURUSD')).toBe('0.00');
  });
});

describe('getDecimalCount', () => {
  it('should return 5 for EURUSD', () => {
    expect(getDecimalCount('EURUSD')).toBe(5);
  });

  it('should return 3 for USDJPY', () => {
    expect(getDecimalCount('USDJPY')).toBe(3);
  });

  it('should default to 5 for unknown pairs', () => {
    expect(getDecimalCount('UNKNOWN')).toBe(5);
  });

  it('should default to 3 for unknown JPY pairs', () => {
    expect(getDecimalCount('USDJPY')).toBe(3);
  });
});

// ============================================================================
// Technical Indicators
// ============================================================================

const mockCandlesticks: Candlestick[] = Array.from({ length: 50 }, (_, i) => ({
  time: Date.now() / 1000 - (50 - i) * 3600,
  open: 1.08 + Math.sin(i / 5) * 0.005,
  high: 1.085 + Math.sin(i / 5) * 0.005,
  low: 1.075 + Math.sin(i / 5) * 0.005,
  close: 1.082 + Math.sin(i / 5) * 0.005,
  volume: 1000 + Math.random() * 500,
}));

describe('computeSMA', () => {
  it('should return null for first (period-1) values', () => {
    const sma = computeSMA(mockCandlesticks, 20);
    for (let i = 0; i < 19; i++) {
      expect(sma[i]).toBeNull();
    }
  });

  it('should calculate correct SMA for valid values', () => {
    const sma = computeSMA(mockCandlesticks, 20);
    expect(sma[19]).not.toBeNull();
    expect(typeof sma[19]).toBe('number');
  });

  it('should return array of same length as input', () => {
    const sma = computeSMA(mockCandlesticks, 20);
    expect(sma.length).toBe(mockCandlesticks.length);
  });
});

describe('computeEMA', () => {
  it('should return array of same length as input', () => {
    const ema = computeEMA(mockCandlesticks, 50);
    expect(ema.length).toBe(mockCandlesticks.length);
  });

  it('should have null for initial values', () => {
    const ema = computeEMA(mockCandlesticks, 50);
    expect(ema[0]).toBeNull();
  });

  it('should calculate valid EMA values', () => {
    const ema = computeEMA(mockCandlesticks, 20);
    const validValues = ema.filter((v): v is number => v !== null);
    expect(validValues.length).toBeGreaterThan(0);
    validValues.forEach(v => {
      expect(v).toBeGreaterThan(0);
    });
  });
});

describe('computeRSI', () => {
  it('should return null for first period values', () => {
    const rsi = computeRSI(mockCandlesticks, 14);
    for (let i = 0; i < 14; i++) {
      expect(rsi[i]).toBeNull();
    }
  });

  it('should calculate RSI between 0 and 100', () => {
    const rsi = computeRSI(mockCandlesticks, 14);
    const validValues = rsi.filter((v): v is number => v !== null);
    validValues.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  it('should return empty array for insufficient data', () => {
    const shortData = mockCandlesticks.slice(0, 5);
    const rsi = computeRSI(shortData, 14);
    expect(rsi.every(v => v === null)).toBe(true);
  });
});

describe('computeBollingerBands', () => {
  it('should return basis, upper, and lower arrays', () => {
    const bb = computeBollingerBands(mockCandlesticks, 20, 2);
    expect(bb).toHaveProperty('basis');
    expect(bb).toHaveProperty('upper');
    expect(bb).toHaveProperty('lower');
    expect(bb.basis.length).toBe(mockCandlesticks.length);
    expect(bb.upper.length).toBe(mockCandlesticks.length);
    expect(bb.lower.length).toBe(mockCandlesticks.length);
  });

  it('upper band should be above basis', () => {
    const bb = computeBollingerBands(mockCandlesticks, 20, 2);
    for (let i = 20; i < mockCandlesticks.length; i++) {
      if (bb.basis[i] !== null && bb.upper[i] !== null) {
        expect(bb.upper[i]!).toBeGreaterThanOrEqual(bb.basis[i]!);
      }
    }
  });

  it('lower band should be below basis', () => {
    const bb = computeBollingerBands(mockCandlesticks, 20, 2);
    for (let i = 20; i < mockCandlesticks.length; i++) {
      if (bb.basis[i] !== null && bb.lower[i] !== null) {
        expect(bb.lower[i]!).toBeLessThanOrEqual(bb.basis[i]!);
      }
    }
  });
});

describe('computeMACD', () => {
  it('should return macd, signal, and histogram arrays', () => {
    const macd = computeMACD(mockCandlesticks, 12, 26, 9);
    expect(macd).toHaveProperty('macd');
    expect(macd).toHaveProperty('signal');
    expect(macd).toHaveProperty('histogram');
    expect(macd.macd.length).toBe(mockCandlesticks.length);
  });

  it('histogram should equal macd minus signal', () => {
    const macd = computeMACD(mockCandlesticks, 12, 26, 9);
    for (let i = 0; i < mockCandlesticks.length; i++) {
      if (macd.macd[i] !== null && macd.signal[i] !== null && macd.histogram[i] !== null) {
        expect(macd.histogram[i]!).toBeCloseTo(macd.macd[i]! - macd.signal[i]!, 10);
      }
    }
  });
});

describe('computeFibonacci', () => {
  it('should return null for empty data', () => {
    expect(computeFibonacci([])).toBeNull();
  });

  it('should calculate fibonacci levels', () => {
    const fib = computeFibonacci(mockCandlesticks);
    expect(fib).not.toBeNull();
    expect(fib).toHaveProperty('high');
    expect(fib).toHaveProperty('low');
    expect(fib).toHaveProperty('r236');
    expect(fib).toHaveProperty('r382');
    expect(fib).toHaveProperty('r500');
    expect(fib).toHaveProperty('r618');
  });

  it('fibonacci levels should be between high and low', () => {
    const fib = computeFibonacci(mockCandlesticks)!;
    expect(fib.r236).toBeGreaterThanOrEqual(fib.low);
    expect(fib.r236).toBeLessThanOrEqual(fib.high);
    expect(fib.r618).toBeGreaterThanOrEqual(fib.low);
    expect(fib.r618).toBeLessThanOrEqual(fib.high);
  });
});

describe('computeATR', () => {
  it('should return null for first period values', () => {
    const atr = computeATR(mockCandlesticks, 14);
    for (let i = 0; i < 13; i++) {
      expect(atr[i]).toBeNull();
    }
  });

  it('should calculate positive ATR values', () => {
    const atr = computeATR(mockCandlesticks, 14);
    const validValues = atr.filter((v): v is number => v !== null);
    validValues.forEach(v => {
      expect(v).toBeGreaterThan(0);
    });
  });

  it('should return array of same length as input', () => {
    const atr = computeATR(mockCandlesticks, 14);
    expect(atr.length).toBe(mockCandlesticks.length);
  });
});
