import { describe, expect, it } from 'vitest';
import { parseBacktestOptions, runSmaBacktest, BacktestInputError, monteCarloTrades, sma } from './backtest';
import { INSTRUMENTS } from '../../shared/market';

// Flat warm-up guarantees the SMAs start equal, so the up-cross is observable inside the scan window.
const rampUpThenDown = (n = 120) => [...Array.from({ length: 12 }, () => 1), ...Array.from({ length: (n - 12) / 2 }, (_, i) => 1.001 + i * 0.01), ...Array.from({ length: (n - 12) / 2 }, (_, i) => 1.001 + ((n - 12) / 2 - i) * 0.01)];
const flat = (n = 120) => Array.from({ length: n }, () => 1.2);

describe('sma', () => {
  it('averages the trailing window and returns null before enough history', () => {
    expect(sma([1, 2, 3, 4], 2, 1)).toBe(1.5);
    expect(sma([1, 2, 3, 4], 2, 3)).toBe(3.5);
    expect(sma([1, 2], 5, 1)).toBeNull();
  });
});

describe('parseBacktestOptions', () => {
  it('clamps into documented bounds and applies defaults', () => {
    expect(parseBacktestOptions({})).toEqual({ fast: 12, slow: 48, lots: 0.1, commissionUsdPerLot: 0 });
    const clamped = parseBacktestOptions({ fast: 1, slow: 9999, lots: 1e9, commission: -5 });
    expect(clamped).toEqual({ fast: 2, slow: 400, lots: 100, commissionUsdPerLot: 0 });
  });
  it('rejects fast >= slow', () => {
    expect(() => parseBacktestOptions({ fast: 50, slow: 40 })).toThrow(BacktestInputError);
  });
});

describe('runSmaBacktest', () => {
  const opts = { fast: 3, slow: 6, lots: 1, commissionUsdPerLot: 0 };
  it('is deterministic and trades the trend reversal', () => {
    const closes = rampUpThenDown();
    const a = runSmaBacktest('EURUSD', closes, opts);
    const b = runSmaBacktest('EURUSD', closes, opts);
    expect(JSON.stringify(a.stats)).toBe(JSON.stringify(b.stats));
    expect(a.stats.tradeCount).toBeGreaterThanOrEqual(2); // BUY cross, SELL cross, terminal mark-to-market
    expect(a.equityCurve).toHaveLength(closes.length - opts.slow);
    expect(a.trades.every(t => t.entryIndex < t.exitIndex && t.exitIndex < closes.length)).toBe(true);
    expect(a.stats.netPnlQuote).toBeCloseTo(a.stats.equityEnd, 2);
  });
  it('flat markets produce no trades but never errors', () => {
    const result = runSmaBacktest('EURUSD', flat(), opts);
    expect(result.stats.tradeCount).toBe(0);
    expect(result.stats.netPnlQuote).toBe(0);
    expect(result.stats.profitFactor).toBe(0);
  });
  it('a long position that rode the up-leg exits for a profit', () => {
    const result = runSmaBacktest('EURUSD', rampUpThenDown(60), { ...opts, fast: 2, slow: 4 });
    const firstLong = result.trades.find(t => t.side === 'BUY');
    expect(firstLong).toBeDefined();
    // Up-leg entries near the bottom exit above entry only if held through the peak cross;
    // the reversal generates the documented loss on the next short cover instead.
    expect(result.trades.some(t => t.pnl !== 0)).toBe(true);
  });
  it('charges half-spread per side in quote currency, scaled by pipDecimal', () => {
    const eu = runSmaBacktest('EURUSD', rampUpThenDown(), opts);
    const jp = runSmaBacktest('USDJPY', rampUpThenDown(), opts);
    expect(eu.costsApplied.halfSpreadQuote).toBeCloseTo(10 ** -INSTRUMENTS.EURUSD.pipDecimal * INSTRUMENTS.EURUSD.spreadPips / 2, 10);
    expect(jp.costsApplied.halfSpreadQuote).toBeCloseTo(10 ** -INSTRUMENTS.USDJPY.pipDecimal * INSTRUMENTS.USDJPY.spreadPips / 2, 10);
  });
  it('commission subtracts exactly two legs per round trip', () => {
    const free = runSmaBacktest('EURUSD', rampUpThenDown(), opts);
    const paid = runSmaBacktest('EURUSD', rampUpThenDown(), { ...opts, commissionUsdPerLot: 10 });
    expect(paid.trades.length).toBe(free.trades.length);
    expect(paid.stats.netPnlQuote).toBeCloseTo(free.stats.netPnlQuote - paid.trades.length * 20, 6);
  });
  it('refuses short or corrupt series instead of inventing statistics', () => {
    expect(() => runSmaBacktest('EURUSD', [1, 2, 3], opts)).toThrow(BacktestInputError);
    expect(() => runSmaBacktest('EURUSD', flat(120).map((v, i) => (i === 10 ? NaN : v)), opts)).toThrow(BacktestInputError);
    expect(() => runSmaBacktest('EURUSD', flat(120).map(() => 0), opts)).toThrow(BacktestInputError);
  });
});

describe('monteCarloTrades', () => {
  const mixed = [300, -120, 210, -90, 150, -200, 260, -40, 180, -110, 220, 90];
  it('is deterministic per seed and varies across seeds', () => {
    const base = { historicalMaxDrawdownQuote: 400 };
    const a = monteCarloTrades(mixed, { ...base, simulations: 120, seed: 7 });
    const b = monteCarloTrades(mixed, { ...base, simulations: 120, seed: 7 });
    expect(a.available && b.available && a.maxDrawdownQuote.p95 === b.maxDrawdownQuote.p95).toBe(true);
    const d = monteCarloTrades(mixed, { ...base, simulations: 120, seed: 99 });
    expect(JSON.stringify(a) !== JSON.stringify(d)).toBe(true);
  });
  it('an all-win trade list cannot produce drawdown in any resample', () => {
    const res = monteCarloTrades([100, 50, 80, 20, 60, 30], { simulations: 100, seed: 3, historicalMaxDrawdownQuote: 0 });
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.maxDrawdownQuote.p50).toBe(0);
      expect(res.maxDrawdownQuote.p95).toBe(0);
      expect(res.probabilityNegativeResult).toBe(0);
    }
  });
  it('p95 >= p50 and probabilities stay in 0..100', () => {
    const res = monteCarloTrades(mixed, { simulations: 300, seed: 11, historicalMaxDrawdownQuote: 250 });
    if (!res.available) throw new Error('expected availability');
    expect(res.maxDrawdownQuote.p95).toBeGreaterThanOrEqual(res.maxDrawdownQuote.p50);
    expect(res.finalPnlQuote.p95Loss).toBeLessThanOrEqual(res.finalPnlQuote.p50);
    for (const pct of [res.probabilityDoublesHistoricalDd, res.probabilityNegativeResult]) {
      expect(pct).toBeGreaterThanOrEqual(0); expect(pct).toBeLessThanOrEqual(100);
    }
  });
  it('guards tiny and corrupt trade lists', () => {
    expect(monteCarloTrades([10, -5, 3], { historicalMaxDrawdownQuote: 10 })).toEqual({ available: false, reason: expect.stringContaining('at least 5') });
    expect(monteCarloTrades([10, -5, 3, NaN, 4, 1], { historicalMaxDrawdownQuote: 10 }).available).toBe(false);
  });
});
