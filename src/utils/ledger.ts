import type { ClosedTrade, TradePosition } from '../types';
import { isSymbol, positiveNumber, type InstrumentKind } from '../../shared/market';
import { valuePnl, roundMoney, type ConversionSnapshot } from './money';
import { MAX_LOTS, validateOrder } from './paperTrading';

export interface Ledger {
  version: 2;
  positions: TradePosition[];
  closedTrades: ClosedTrade[];
  /** Tombstones are retained after history clearing so another device cannot restore deleted rows. */
  deletedTradeIds: string[];
  closedPositionIds: string[];
}
export const MAX_LEDGER_ROWS = 5000;
export const emptyLedger = (): Ledger => ({ version: 2, positions: [], closedTrades: [], deletedTradeIds: [], closedPositionIds: [] });
export const bookStorageKey = (owner: string): string => `apexfx:ledger:v2:${owner}`;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
const timestamp = (v: unknown): number | undefined => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 8640000000000000 ? v : undefined;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ledger record. Original data was not overwritten.');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_LEDGER_ROWS) throw new Error(`Invalid ledger collection (maximum ${MAX_LEDGER_ROWS} rows).`);
  return value;
}
function ids(value: unknown): string[] {
  const values = array(value);
  if (!values.every(validId)) throw new Error('Invalid ledger identity.');
  return [...new Set(values)].sort();
}
function common(value: unknown) {
  const r = object(value);
  if (!validId(r.id) || typeof r.symbol !== 'string' || !isSymbol(r.symbol) ||
      (r.type !== 'BUY' && r.type !== 'SELL') || !positiveNumber(r.entryPrice) ||
      !positiveNumber(r.amount) || r.amount < .01 || r.amount > MAX_LOTS) throw new Error('Invalid trade identity, price, direction, or lot size.');
  const instrumentKind: InstrumentKind = r.instrumentKind === 'spot' || r.instrumentKind === 'futures' ? r.instrumentKind :
    r.symbol === 'XAGUSD' ? 'unknown' : 'spot';
  return { r, id: r.id, symbol: r.symbol, type: r.type as 'BUY' | 'SELL', entryPrice: r.entryPrice, amount: r.amount,
    openedAt: timestamp(r.openedAt), instrumentKind, time: typeof r.time === 'string' ? r.time.slice(0, 80) : 'Unknown' };
}
export function normalizePosition(value: unknown): TradePosition {
  const { r, ...base } = common(value);
  const sl = r.sl == null ? undefined : r.sl as number;
  const tp = r.tp == null ? undefined : r.tp as number;
  if (!validateOrder({ type: base.type, price: base.entryPrice, amount: base.amount, sl, tp }).ok) throw new Error(`Invalid protective levels on position ${base.id}.`);
  // Imported/persisted marks are not current executable observations. The live engine marks
  // these positions after loading when a compatible quote is available, including USD-quoted pairs.
  return { ...base, currentPrice: base.entryPrice, sl, tp,
    ...valuePnl(base.symbol, base.type, base.entryPrice, base.entryPrice, base.amount, [], 0),
    markAsOf: null, pnl: null, pnlQuote: undefined, conversion: null };
}
export function normalizeClosedTrade(value: unknown): ClosedTrade {
  const { r, ...base } = common(value);
  if (!positiveNumber(r.exitPrice)) throw new Error('Invalid closed-trade exit price.');
  const closedAt = timestamp(r.closedAt);
  const money = valuePnl(base.symbol, base.type, base.entryPrice, r.exitPrice, base.amount, [], closedAt ?? 0);
  // Only explicitly versioned records may supply frozen conversion provenance. Legacy JPY crosses
  // remain unconverted: today's USDJPY is not evidence of the rate when the trade closed.
  if (r.pnlVersion === 2 && r.conversion && typeof r.conversion === 'object') {
    const fx = r.conversion as Partial<ConversionSnapshot>;
    if (!positiveNumber(fx.quotePerUsd) || typeof fx.source !== 'string' || !fx.source.trim() || fx.source.length > 120) throw new Error('Invalid frozen currency conversion.');
    // USD-quoted and USD-base trades have an independently reconstructible conversion.
    if (!money.conversion) {
      if (!timestamp(fx.asOf)) throw new Error('A frozen cross-currency conversion must have an observation time.');
      money.conversion = { quotePerUsd: fx.quotePerUsd, source: fx.source, asOf: timestamp(fx.asOf) ?? null };
      money.pnl = roundMoney(money.pnlQuote / fx.quotePerUsd);
    }
  }
  const positionId = validId(r.positionId) ? r.positionId : undefined;
  if (r.positionId !== undefined && !positionId) throw new Error('Invalid original position identity.');
  return { ...base, ...money, positionId, exitPrice: r.exitPrice, closedAt,
    closeReason: r.closeReason === 'SL Hit' || r.closeReason === 'TP Hit' ? r.closeReason : 'Manual',
    durationMs: closedAt && base.openedAt ? Math.max(0, closedAt - base.openedAt) : undefined };
}

/** A malformed collection is rejected as a whole; never silently overwrite its recoverable source. */
export function parseLedger(value: unknown): Ledger {
  const r = object(value);
  if (r.version !== 2) throw new Error('Unsupported ledger version. Export the original data before migrating.');
  const book: Ledger = { version: 2,
    positions: array(r.positions).map(normalizePosition), closedTrades: array(r.closedTrades).map(normalizeClosedTrade),
    deletedTradeIds: ids(r.deletedTradeIds), closedPositionIds: ids(r.closedPositionIds) };
  return mergeLedgers(emptyLedger(), book);
}
const positionIdentity = (p: TradePosition) => JSON.stringify([p.symbol, p.type, p.entryPrice, p.amount, p.sl ?? null, p.tp ?? null, p.openedAt ?? null, p.instrumentKind]);
const closeOrder = (a: ClosedTrade, b: ClosedTrade) => (a.closedAt ?? 0) - (b.closedAt ?? 0) || JSON.stringify(a).localeCompare(JSON.stringify(b));

/**
 * Union immutable creations, closed-wins, and persistent tombstones. Mark-to-market fields are local
 * observations, not remote order edits. Conflicting edits of a creation are rejected, not guessed.
 * Simultaneous offline closes converge to the earliest recorded close (not broker execution authority).
 */
export function mergeLedgers(local: Ledger, remote: Ledger): Ledger {
  const deleted = new Set([...local.deletedTradeIds, ...remote.deletedTradeIds]);
  const closedIds = new Set([...local.closedPositionIds, ...remote.closedPositionIds]);
  const trades = new Map<string, ClosedTrade>();
  for (const t of [...local.closedTrades, ...remote.closedTrades]) {
    if (t.positionId) closedIds.add(t.positionId);
    const key = t.positionId ? `closed_${t.positionId}` : t.id;
    const normalized = { ...t, id: key };
    const old = trades.get(key);
    if (!old || closeOrder(normalized, old) < 0) trades.set(key, normalized);
  }
  const positions = new Map<string, TradePosition>();
  for (const p of [...local.positions, ...remote.positions]) {
    if (closedIds.has(p.id)) continue;
    const existing = positions.get(p.id);
    if (existing && positionIdentity(existing) !== positionIdentity(p)) throw new Error(`Conflicting immutable position ${p.id}; export both books for reconciliation.`);
    if (!existing) positions.set(p.id, p);
  }
  for (const size of [positions.size + closedIds.size, positions.size + trades.size, deleted.size, closedIds.size]) {
    if (size > MAX_LEDGER_ROWS) throw new Error(`Ledger limit (${MAX_LEDGER_ROWS}) reached. Export/archive before continuing.`);
  }
  return {
    version: 2, positions: [...positions.values()],
    closedTrades: [...trades.values()].filter(t => !deleted.has(t.id)).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0) || a.id.localeCompare(b.id)),
    deletedTradeIds: [...deleted].sort(), closedPositionIds: [...closedIds].sort(),
  };
}
export function clearLedgerHistory(book: Ledger): Ledger {
  return mergeLedgers({ ...book, closedTrades: [],
    deletedTradeIds: [...new Set([...book.deletedTradeIds, ...book.closedTrades.map(t => t.id)])],
    closedPositionIds: [...new Set([...book.closedPositionIds, ...book.closedTrades.flatMap(t => t.positionId ? [t.positionId] : [])])],
  }, emptyLedger());
}

/** Cloud/persistence snapshots don't pretend a previously marked open price is a current quote. */
export function durableLedger(book: Ledger): Ledger {
  return { ...book, positions: book.positions.map(p => ({ ...p, currentPrice: p.entryPrice,
    ...valuePnl(p.symbol, p.type, p.entryPrice, p.entryPrice, p.amount, [], p.openedAt ?? 0), markAsOf: null, pnl: null, pnlQuote: undefined, conversion: null })) };
}
