// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE, evaluateChallenge, loadChallengeConfig, saveChallengeConfig, CHALLENGE_STORAGE_KEY } from './challenge';
import type { ClosedTrade, TradePosition } from '../types';

const DAY = 86_400_000;
const T0 = 1_758_800_000_000; // a 2026-09 UTC day start-ish
const trade = (pnl: number, at: number, extra: Partial<ClosedTrade> = {}): ClosedTrade => ({
  id: `closed_${at}_${pnl}`, symbol: 'EURUSD', type: 'BUY', entryPrice: 1.1, exitPrice: 1.11, amount: 1,
  pnl, time: '12:00:00', pnlVersion: 2, accountCurrency: 'USD', quoteCurrency: 'USD', pnlQuote: pnl, ...extra, closedAt: at,
} as ClosedTrade);
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('evaluateChallenge', () => {
  const cfg = { ...DEFAULT_CHALLENGE, startingBalanceUsd: 10_000 };
  it('starts active with full buffers and no trades', () => {
    const e = evaluateChallenge(cfg, { closedTrades: [], openPositions: [], nowMs: T0 });
    expect(e).toMatchObject({ status: 'active', failedRules: [], profitPct: 0, daysTraded: 0, drawdownBufferPct: 10, dailyLossUsedPct: 0 });
  });
  it('passes at target with enough trading days; fails when short on days', () => {
    const trades = [trade(500, T0 - 2 * DAY), trade(400, T0 - DAY), trade(100, T0)];
    expect(evaluateChallenge(cfg, { closedTrades: trades, openPositions: [], nowMs: T0 }).status).toBe('passed');
    const oneDay = [trade(500, T0), trade(400, T0), trade(100, T0)];
    expect(evaluateChallenge(cfg, { closedTrades: oneDay, openPositions: [], nowMs: T0 })).toMatchObject({ status: 'active', daysTraded: 1 });
  });
  it('detects an INTRADAY daily-loss breach even when the day recovers', () => {
    const trades = [trade(100, T0 - 3 * DAY), trade(-800, T0), trade(700, T0)]; // day open 10100 -> dips to 9300 (-7.9%) then recovers +600
    const e = evaluateChallenge(cfg, { closedTrades: trades, openPositions: [], nowMs: T0 });
    expect(e.status).toBe('failed');
    expect(e.failedRules.join(' ')).toContain('Daily loss limit');
  });
  it('trailing drawdown follows the high-water mark; static does not', () => {
    // Each day's hit stays inside the 5% daily limit so ONLY the drawdown rule can fire.
    const path = [trade(900, T0 - 4 * DAY), trade(-500, T0 - 3 * DAY)]; // +4.5% net stays active; peak 10900 -> trailing floor 9810 > static 9000, both safe
    expect(evaluateChallenge({ ...cfg, trailingDrawdown: true }, { closedTrades: path, openPositions: [], nowMs: T0 }).status).toBe('active');
    const deep = [trade(1500, T0 - 5 * DAY), trade(-400, T0 - 4 * DAY), trade(-400, T0 - 3 * DAY), trade(-400, T0 - 2 * DAY), trade(-400, T0 - DAY)];
    // peak 11500 -> trailing floor 10350; final equity 9900 breaches it, while static floor 9000 stays safe
    expect(evaluateChallenge({ ...cfg, trailingDrawdown: true }, { closedTrades: deep, openPositions: [], nowMs: T0 }).status).toBe('failed');
    expect(evaluateChallenge({ ...cfg, trailingDrawdown: false }, { closedTrades: deep, openPositions: [], nowMs: T0 }).status).toBe('active');
  });
  it('open-position floating loss counts against today and the buffer', () => {
    const position = { id: 'p', symbol: 'EURUSD', type: 'BUY', amount: 1, entryPrice: 1.1, currentPrice: 1.09, pnl: -900, pnlVersion: 2, accountCurrency: 'USD' } as TradePosition;
    const e = evaluateChallenge(cfg, { closedTrades: [], openPositions: [position], nowMs: T0 });
    expect(e.equityUsd).toBe(9100);
    expect(e.status).toBe('failed'); // -9% today breaches the 5% daily limit
    expect(e.failedRules.join(' ')).toContain('including open positions');
  });
  it('excludes trades whose USD value is unknown instead of guessing zero', () => {
    const jpypnl = trade(0, T0, { pnl: null, pnlQuote: 15_000, quoteCurrency: 'JPY' });
    const e = evaluateChallenge(cfg, { closedTrades: [jpypnl], openPositions: [], nowMs: T0 });
    expect(e.countedClosedTrades).toBe(0);
    expect(e.excludedTradesWithoutUsdPnl).toBe(1);
    expect(e.profitPct).toBe(0);
  });
});

describe('challenge persistence', () => {
  it('round-trips through localStorage and rejects corrupt or disabled state', () => {
    expect(loadChallengeConfig()).toBeNull();
    saveChallengeConfig({ enabled: true, config: { ...DEFAULT_CHALLENGE, profitTargetPct: 6 } });
    expect(loadChallengeConfig()).toEqual({ enabled: true, config: { ...DEFAULT_CHALLENGE, profitTargetPct: 6 } });
    localStorage.setItem(CHALLENGE_STORAGE_KEY, '{corrupt');
    expect(loadChallengeConfig()).toBeNull();
    saveChallengeConfig({ enabled: false, config: DEFAULT_CHALLENGE });
    expect(loadChallengeConfig()).toBeNull();
    saveChallengeConfig(null);
    expect(localStorage.getItem(CHALLENGE_STORAGE_KEY)).toBeNull();
  });
  it('clamps absurd stored numbers into sane bounds', () => {
    localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify({ enabled: true, config: { startingBalanceUsd: -5, profitTargetPct: 999, dailyLossPct: 'x', maxDrawdownPct: 2.5, trailingDrawdown: 'yes', minTradingDays: -3 } }));
    const loaded = loadChallengeConfig()!;
    expect(loaded.config.startingBalanceUsd).toBe(DEFAULT_CHALLENGE.startingBalanceUsd);
    expect(loaded.config.profitTargetPct).toBe(100);
    expect(loaded.config.dailyLossPct).toBe(DEFAULT_CHALLENGE.dailyLossPct);
    expect(loaded.config.maxDrawdownPct).toBe(2.5);
    expect(loaded.config.trailingDrawdown).toBe(true);
    expect(loaded.config.minTradingDays).toBe(0);
  });
});
