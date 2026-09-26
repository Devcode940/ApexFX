import { hasAccountPnl } from './money';
import type { ClosedTrade, TradePosition } from '../types';

/**
 * Self-assessment of a funded-account-style ruleset against the LOCAL paper
 * journal. Nothing here contacts or certifies anything for a real prop firm —
 * defaults are illustrative terms inspired by public challenge rules
 * (FTMO-style: 8% target, 5% daily loss, 10% max drawdown). Evaluation is
 * derived from the current book on every render, so it can never go stale.
 */
export interface ChallengeConfig {
  startingBalanceUsd: number;
  profitTargetPct: number;
  dailyLossPct: number;
  maxDrawdownPct: number;
  /** Trailing: the floor follows the equity high-water mark (most firms). */
  trailingDrawdown: boolean;
  /** Distinct UTC days with at least one closed trade required before passing. */
  minTradingDays: number;
}
export const DEFAULT_CHALLENGE: ChallengeConfig = {
  startingBalanceUsd: 10_000, profitTargetPct: 8, dailyLossPct: 5,
  maxDrawdownPct: 10, trailingDrawdown: true, minTradingDays: 2,
};
export const CHALLENGE_STORAGE_KEY = 'apexfx.challenge.v1';

export interface StoredChallenge { enabled: boolean; config: ChallengeConfig }

export function loadChallengeConfig(): StoredChallenge | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CHALLENGE_STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as { enabled?: unknown; config?: Record<string, unknown> };
    if (value.enabled !== true || !value.config || typeof value.config !== 'object') return null;
    const c = value.config;
    const num = (v: unknown, fallback: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, v) : fallback;
    return { enabled: true, config: {
      startingBalanceUsd: num(c.startingBalanceUsd, DEFAULT_CHALLENGE.startingBalanceUsd, 10_000_000),
      profitTargetPct: num(c.profitTargetPct, DEFAULT_CHALLENGE.profitTargetPct, 100),
      dailyLossPct: num(c.dailyLossPct, DEFAULT_CHALLENGE.dailyLossPct, 100),
      maxDrawdownPct: num(c.maxDrawdownPct, DEFAULT_CHALLENGE.maxDrawdownPct, 100),
      trailingDrawdown: c.trailingDrawdown !== false,
      minTradingDays: Number.isFinite(c.minTradingDays) ? Math.max(0, Math.trunc(Number(c.minTradingDays))) : DEFAULT_CHALLENGE.minTradingDays,
    } };
  } catch { return null; }
}
export function saveChallengeConfig(state: StoredChallenge | null): void {
  try {
    if (!state) localStorage.removeItem(CHALLENGE_STORAGE_KEY);
    else localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify(state));
  } catch { /* private mode: session-only */ }
}

export type ChallengeStatus = 'active' | 'passed' | 'failed';
export interface ChallengeEvaluation {
  status: ChallengeStatus;
  failedRules: string[];
  /** Realized USD P&L + floating, as % of the challenge starting balance. */
  profitPct: number;
  targetPct: number;
  daysTraded: number;
  minTradingDays: number;
  /** Percentage points of loss used vs the daily limit (today, intraday minimum included). */
  dailyLossUsedPct: number;
  dailyLossLimitPct: number;
  /** Percentage-point cushion above the active drawdown floor right now. */
  drawdownBufferPct: number;
  maxDrawdownPct: number;
  equityUsd: number;
  countedClosedTrades: number;
  excludedTradesWithoutUsdPnl: number;
}

const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

export function evaluateChallenge(
  config: ChallengeConfig,
  input: { closedTrades: readonly ClosedTrade[]; openPositions: readonly TradePosition[]; currentBalanceUsd?: number; nowMs?: number },
): ChallengeEvaluation {
  const nowMs = input.nowMs ?? Date.now();
  const usable = input.closedTrades
    .filter(hasAccountPnl)
    .map(t => ({ at: typeof t.closedAt === 'number' && Number.isFinite(t.closedAt) ? t.closedAt : nowMs, pnl: t.pnl }))
    .sort((a, b) => a.at - b.at);
  const excluded = input.closedTrades.length - usable.length;
  const floatingUsd = input.openPositions.reduce((sum, p) => sum + (hasAccountPnl(p) ? p.pnl : 0), 0);

  const start = config.startingBalanceUsd;
  const dayLimit = 1 - config.dailyLossPct / 100;
  const ddFactor = 1 - config.maxDrawdownPct / 100;

  // Replay the realized equity path chronologically so INTRADAY breaches count,
  // mirroring how firms monitor rather than end-of-day snapshots.
  const today = utcDay(nowMs);
  let equity = start;
  let peak = start;
  let floor = start * ddFactor;
  let dayStart = start;
  let lastDay = today;
  let todayMin = start;
  let breachDaily = false;
  let breachDd = false;
  const days = new Set<number>();
  for (const t of usable) {
    const day = utcDay(t.at);
    if (day !== lastDay) { lastDay = day; dayStart = equity; }
    days.add(day);
    equity += t.pnl;
    if (day === today) todayMin = Math.min(todayMin, equity);
    if (equity < dayStart * dayLimit) breachDaily = true;
    if (equity > peak) { peak = equity; if (config.trailingDrawdown) floor = peak * ddFactor; }
    if (equity < floor) breachDd = true;
  }
  const todayStartEquity = lastDay === today ? dayStart : equity;
  const currentEquity = equity + floatingUsd;
  if (currentEquity < todayStartEquity * dayLimit) breachDaily = true;
  if (currentEquity < (config.trailingDrawdown ? peak : start) * ddFactor) breachDd = true;

  const realizedTotal = usable.reduce((sum, t) => sum + t.pnl, 0);
  const profitPct = Math.round(((realizedTotal + floatingUsd) / start) * 1000) / 10;
  const daysTraded = days.size;
  const failedRules: string[] = [];
  if (breachDaily) failedRules.push(`Daily loss limit (${config.dailyLossPct}% vs ${todayStartEquity.toFixed(0)} USD opening equity) breached${floatingUsd < 0 ? ', including open positions' : ''}`);
  if (breachDd) failedRules.push(`Max drawdown (${config.maxDrawdownPct}%${config.trailingDrawdown ? ', trailing the equity high-water mark' : ' below starting balance'}) breached`);
  const status: ChallengeStatus = failedRules.length > 0
    ? 'failed'
    : profitPct >= config.profitTargetPct && daysTraded >= config.minTradingDays
      ? 'passed' : 'active';
  return {
    status, failedRules,
    profitPct, targetPct: config.profitTargetPct,
    daysTraded, minTradingDays: config.minTradingDays,
    dailyLossUsedPct: Math.round(Math.max(0, (todayStartEquity - Math.min(todayMin, currentEquity)) / todayStartEquity * 100) * 10) / 10,
    dailyLossLimitPct: config.dailyLossPct,
    drawdownBufferPct: Math.round((currentEquity / Math.max(config.trailingDrawdown ? peak : start, 1) * 100 - (100 - config.maxDrawdownPct)) * 10) / 10,
    maxDrawdownPct: config.maxDrawdownPct,
    equityUsd: Math.round(currentEquity * 100) / 100,
    countedClosedTrades: usable.length,
    excludedTradesWithoutUsdPnl: excluded,
  };
}
