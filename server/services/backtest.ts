/**
 * Educational SMA-crossover backtester over real provider candles.
 *
 * Pure and deterministic so it is directly unit-testable. Fill model is deliberately
 * conservative: every entry and exit pays half of the instrument's indicative spread,
 * and each leg pays commission per lot. P&L is denominated in the quote currency
 * (USD for USD-quoted pairs, JPY for JPY crosses) — the response says so explicitly.
 * This is not investment advice and not a forecast of live execution quality.
 */
import { INSTRUMENTS, type SymbolCode } from '../../shared/market';

export interface BacktestOptions {
  fast: number;
  slow: number;
  lots: number;
  commissionUsdPerLot: number;
}

export interface BacktestTrade {
  side: 'BUY' | 'SELL';
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  bars: number;
}

export interface BacktestResult extends BacktestOptions {
  bars: number;
  trades: BacktestTrade[];
  stats: {
    tradeCount: number;
    winCount: number;
    winRatePct: number;
    netPnlQuote: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number | null;
    maxDrawdownQuote: number;
    maxDrawdownPct: number;
    equityStart: number;
    equityEnd: number;
    barsInMarket: number;
  };
  equityCurve: { index: number; equity: number }[];
  costsApplied: { halfSpreadQuote: number; commissionPerLeg: number };
  disclaimer: string;
}

export class BacktestInputError extends Error {}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export function parseBacktestOptions(query: Record<string, unknown>): BacktestOptions {
  const fast = clampInt(query.fast, 2, 200, 12);
  const slow = clampInt(query.slow, 5, 400, 48);
  if (fast >= slow) throw new BacktestInputError('fast must be smaller than slow');
  const lotsRaw = typeof query.lots === 'number' ? query.lots : Number(query.lots);
  const lots = Number.isFinite(lotsRaw) ? Math.min(100, Math.max(0.01, Math.round(lotsRaw * 100) / 100)) : 0.1;
  const commissionRaw = typeof query.commission === 'number' ? query.commission : Number(query.commission);
  const commissionUsdPerLot = Number.isFinite(commissionRaw) ? Math.min(100, Math.max(0, commissionRaw)) : 0;
  return { fast, slow, lots, commissionUsdPerLot };
}

export function sma(values: number[], period: number, endIndex: number): number | null {
  if (endIndex + 1 < period) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) sum += values[i]!;
  return sum / period;
}

export function runSmaBacktest(symbol: SymbolCode, closes: number[], options: BacktestOptions, minBars = 60): BacktestResult {
  const instrument = (INSTRUMENTS as Record<string, { pipDecimal: number; spreadPips: number; contractSize: number }>)[symbol];
  if (!instrument) throw new BacktestInputError('Unsupported symbol');
  if (!Array.isArray(closes) || closes.length < minBars) throw new BacktestInputError(`Need at least ${minBars} closed bars`);
  if (closes.some(c => !Number.isFinite(c) || c <= 0)) throw new BacktestInputError('Candles contain a non-finite price');
  const { fast, slow, lots, commissionUsdPerLot } = options;
  const halfSpreadQuote = (Math.pow(10, -instrument.pipDecimal) * instrument.spreadPips) / 2;
  const commissionPerLeg = lots * commissionUsdPerLot;

  const trades: BacktestTrade[] = [];
  const equityCurve: { index: number; equity: number }[] = [];
  let equity = 0;
  let position: { side: 'BUY' | 'SELL'; entryIndex: number; entryPrice: number } | null = null;
  let pendingSignal: 'BUY' | 'SELL' | null = null;

  const closePosition = (index: number, rawExit: number) => {
    if (!position) return;
    const exitPrice = position.side === 'BUY' ? rawExit - halfSpreadQuote : rawExit + halfSpreadQuote;
    const direction = position.side === 'BUY' ? 1 : -1;
    const pnl = (exitPrice - position.entryPrice) * direction * lots * instrument.contractSize - 2 * commissionPerLeg;
    trades.push({ side: position.side, entryIndex: position.entryIndex, exitIndex: index, entryPrice: position.entryPrice, exitPrice, pnl, bars: index - position.entryIndex });
    equity += pnl;
    position = null;
  };

  for (let i = slow; i < closes.length; i++) {
    const fastNow = sma(closes, fast, i)!; const fastPrev = sma(closes, fast, i - 1)!;
    const slowNow = sma(closes, slow, i)!; const slowPrev = sma(closes, slow, i - 1)!;
    if (fastPrev <= slowPrev && fastNow > slowNow) { pendingSignal = 'BUY'; }
    else if (fastPrev >= slowPrev && fastNow < slowNow) { pendingSignal = 'SELL'; }
    if (pendingSignal) {
      // Signals confirm on the next bar open; without an open series we fill at the signal close.
      closePosition(i, closes[i]!);
      if (pendingSignal === 'BUY' || pendingSignal === 'SELL') {
        const raw = closes[i]!;
        position = { side: pendingSignal, entryIndex: i, entryPrice: pendingSignal === 'BUY' ? raw + halfSpreadQuote : raw - halfSpreadQuote };
      }
      pendingSignal = null;
    }
    equityCurve.push({ index: i, equity });
  }
  if (position) closePosition(closes.length - 1, closes[closes.length - 1]!); // mark-to-market terminal exit

  const grossProfit = trades.reduce((a, t) => a + Math.max(0, t.pnl), 0);
  const grossLoss = trades.reduce((a, t) => a + Math.min(0, t.pnl), 0);
  let peak = 0; let maxDrawdownQuote = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdownQuote = Math.min(maxDrawdownQuote, point.equity - peak);
  }
  const winCount = trades.filter(t => t.pnl > 0).length;
  const netPnl = trades.reduce((a, t) => a + t.pnl, 0);
  return {
    ...options,
    bars: closes.length,
    trades,
    stats: {
      tradeCount: trades.length,
      winCount,
      winRatePct: trades.length ? Math.round((winCount / trades.length) * 1000) / 10 : 0,
      netPnlQuote: Math.round(netPnl * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossLoss: Math.round(grossLoss * 100) / 100,
      profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : Math.round((grossProfit / Math.abs(grossLoss)) * 100) / 100,
      maxDrawdownQuote: Math.round(maxDrawdownQuote * 100) / 100,
      maxDrawdownPct: peak > 0 ? Math.round((Math.abs(maxDrawdownQuote) / peak) * 1000) / 10 : 0,
      equityStart: 0,
      equityEnd: Math.round(equity * 100) / 100,
      barsInMarket: trades.reduce((a, t) => a + t.bars, 0),
    },
    equityCurve,
    costsApplied: { halfSpreadQuote, commissionPerLeg },
    disclaimer: 'Educational simulation on historical bars with synthetic spread/commission costs. Not investment advice and not indicative of live fills.',
  };
}
