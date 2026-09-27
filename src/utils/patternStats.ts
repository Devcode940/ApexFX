import { INSTRUMENTS, isSymbol } from '../../shared/market';
import type { Candlestick, Pattern } from '../types';

/**
 * Descriptive follow-through statistics for patterns detected within the
 * LOADED candle window only. This is a count of what the displayed sample
 * did next — not a predictive probability, not a base rate from history,
 * and never blended with the confluence score. Small samples are labeled.
 */
export interface PatternFollowThrough {
  name: string;
  direction: Pattern['type'];
  occurrences: number;
  /** Occurrences with a full `horizon` of future bars available (excluded otherwise). */
  evaluated: number;
  /** Share of evaluated occurrences that closed beyond the trigger close in the pattern direction. Null for neutral patterns. */
  successRatePct: number | null;
  /** Median signed move after `horizon` bars, in pips of the instrument. */
  medianMovePips: number | null;
  medianAbsMovePips: number | null;
}

export interface PatternFollowThroughSummary {
  symbol: string;
  timeframeBars: number;
  horizon: number;
  perPattern: PatternFollowThrough[];
  note: string;
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export function summarizePatternFollowThrough(
  patterns: readonly Pattern[],
  candles: readonly Candlestick[],
  symbol: string,
  horizon = 3,
): PatternFollowThroughSummary | null {
  if (!isSymbol(symbol) || candles.length < horizon + 4) return null;
  const pip = Math.pow(10, -INSTRUMENTS[symbol].pipDecimal);
  const byName = new Map<string, { type: Pattern['type']; moves: { signed: number; abs: number; ok: boolean | null }[]; occurrences: number }>();
  for (const pattern of patterns) {
    const i = pattern.candlestickIndex;
    const entry = byName.get(pattern.name) ?? { type: pattern.type, moves: [], occurrences: 0 };
    entry.occurrences++;
    if (i >= 0 && i + horizon < candles.length) {
      const moveQuote = candles[i + horizon]!.close - candles[i]!.close;
      const signed = moveQuote / pip;
      entry.moves.push({
        signed, abs: Math.abs(signed),
        ok: pattern.type === 'bullish' ? moveQuote > 0 : pattern.type === 'bearish' ? moveQuote < 0 : null,
      });
    }
    byName.set(pattern.name, entry);
  }
  const perPattern = [...byName.entries()].map(([name, entry]) => ({
    name,
    direction: entry.type,
    occurrences: entry.occurrences,
    evaluated: entry.moves.length,
    successRatePct: entry.moves.length && entry.moves.some(m => m.ok !== null)
      ? Math.round((entry.moves.filter(m => m.ok === true).length / entry.moves.filter(m => m.ok !== null).length) * 1000) / 10
      : null,
    medianMovePips: entry.moves.length ? Math.round(median(entry.moves.map(m => m.signed))! * 10) / 10 : null,
    medianAbsMovePips: entry.moves.length ? Math.round(median(entry.moves.map(m => m.abs))! * 10) / 10 : null,
  })).filter(row => row.occurrences > 0).sort((a, b) => b.occurrences - a.occurrences);
  return {
    symbol, timeframeBars: candles.length, horizon,
    perPattern,
    note: `Descriptive counts over the ${candles.length} bars currently loaded. With only a few occurrences, rates swing on a single candle; this is not a predictive probability or a published base rate.`,
  };
}
