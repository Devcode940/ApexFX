/** @deprecated Legacy row/archive helpers only. Live books MUST use ledger/cloudLedger (CAS, owner binding, closure and deletion tombstones). */
import type { TradePosition, ClosedTrade } from '../types';
import { priceDeltaToPips } from './pips';

/**
 * Sync merge rules, kept pure so they can be tested (they used to be three inline setState calls).
 *
 * The old pull path did `setPositions(remoteRows)` — a *replace*. Any local position or closed trade
 * that had not been pushed yet (offline session, another device, a trade closed after the last sync)
 * was silently deleted by pressing "Pull". Losing trade history in a journaling feature is the worst
 * possible failure for this app, so sync is now an additive merge on `id`.
 *
 * What this deliberately is NOT: bidirectional replication. Rows deleted remotely will come back on
 * the next pull, because there is no tombstone/version column in the schema to reason about. That is
 * a known, documented limit of the current schema rather than an accident.
 */

export function mergeById<T extends { id: string }>(local: readonly T[], remote: readonly T[], winner: 'remote' | 'local' = 'remote'): T[] {
  const byId = new Map<string, T>();
  for (const row of local) byId.set(row.id, row);
  for (const row of remote) {
    const existing = byId.get(row.id);
    if (!existing || winner === 'remote') byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

/** Open positions: union by id, remote field values win, local ordering preserved for existing rows. */
export function mergePositions(local: readonly TradePosition[], remote: readonly TradePosition[]): TradePosition[] {
  return mergeById(local, remote, 'remote');
}

/**
 * Closed trades: union by id, newest close first.
 *
 * Sorting is part of the contract because `closedTrades` order is what the history table and CSV
 * export show; a merge that appended remote rows at the end would look like the journal lost its
 * ordering. `openedAt`/`closedAt` are optional, so rows predating those fields fall back to 0 and
 * sort oldest-first instead of producing NaN comparisons.
 */
export function mergeTrades(local: readonly ClosedTrade[], remote: readonly ClosedTrade[]): ClosedTrade[] {
  return mergeById(local, remote, 'remote').sort((a, b) => closeTime(b) - closeTime(a));
}

function closeTime(t: ClosedTrade): number {
  return Number.isFinite(t.closedAt) ? (t.closedAt as number) : 0;
}

/**
 * Pips for an OPEN position, as stored in `positions.pips`: the signed move from entry to the live
 * price. This used to be a literal `0`, which made the column dead data — and any dashboard built on
 * it would have shown zero pips for every position, forever, without erroring.
 */
export function positionPips(pos: TradePosition): number {
  return priceDeltaToPips(pos.symbol, pos.currentPrice - pos.entryPrice);
}

/** Pips for a CLOSED trade, matching the stored convention (magnitude of the captured move). */
export function tradePips(trade: ClosedTrade): number {
  return Math.abs(priceDeltaToPips(trade.symbol, trade.exitPrice - trade.entryPrice));
}
