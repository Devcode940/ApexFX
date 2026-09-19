import { describe, it, expect } from 'vitest';
import { TD_SYMBOLS, YAHOO_SYMBOLS, PAIRS_CONFIG_WS, yahooTickerFor, getPollMs, getQuoteSyncMs } from './market';

/**
 * Regression test for finding S2.1: the quote path mapped XAGUSD->SI=F while the history path
 * had its own copy mapping XAGUSD->XAGUSD=X (a symbol Yahoo does not publish). Duplicated
 * lookup tables are only preventable by a test that asserts they agree.
 */
describe('symbol maps stay consistent across quote and history paths', () => {
  it('every instrument has both a Twelve Data and a Yahoo ticker', () => {
    for (const key of Object.keys(PAIRS_CONFIG_WS)) {
      expect(TD_SYMBOLS[key], `TD_SYMBOLS missing ${key}`).toBeTruthy();
      expect(YAHOO_SYMBOLS[key], `YAHOO_SYMBOLS missing ${key}`).toBeTruthy();
    }
  });

  it('silver resolves to COMEX futures for BOTH price and history', () => {
    expect(yahooTickerFor('XAGUSD')).toBe('SI=F');
  });

  it('has exactly one Yahoo mapping per instrument (no stale duplicates)', () => {
    expect(Object.keys(YAHOO_SYMBOLS).sort()).toEqual(Object.keys(PAIRS_CONFIG_WS).sort());
  });

  it('falls back deterministically for unknown symbols', () => {
    expect(yahooTickerFor('BTCUSD')).toBe('BTCUSD=X');
  });
});

describe('interval clamping', () => {
  const keys = ['TWELVEDATA_QUOTE_SYNC_MS', 'TWELVEDATA_POLL_MS'];
  const withEnv = async (vars: Record<string, string>, fn: () => void) => {
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) prev[k] = process.env[k];
    Object.assign(process.env, vars);
    try { fn(); } finally { for (const k of keys) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  };

  it('clamps hostile/absurd sync intervals into the documented 10s..1h band', () => {
    for (const bad of ['0', '-1', '1', 'abc', 'Infinity', '999999999999']) {
      withEnv({ TWELVEDATA_QUOTE_SYNC_MS: bad }, () => {
        const v = getQuoteSyncMs();
        expect(v).toBeGreaterThanOrEqual(10_000);
        expect(v).toBeLessThanOrEqual(3_600_000);
      });
    }
  });

  it('clamps poll interval into 5s..2m', () => {
    for (const bad of ['0', '-5000', 'NaN', '50']) {
      withEnv({ TWELVEDATA_POLL_MS: bad }, () => {
        const v = getPollMs();
        expect(v).toBeGreaterThanOrEqual(5_000);
        expect(v).toBeLessThanOrEqual(120_000);
      });
    }
  });
});
