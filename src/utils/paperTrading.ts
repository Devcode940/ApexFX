import type { TradePosition, ClosedTrade, WatchlistItem } from '../types';
import { getContractSize } from './forexData';

/**
 * Pure paper-trading engine, extracted from usePaperTrading so the rules that move money in the
 * simulator are unit-testable without a DOM. The hook owns state; everything that decides a
 * number lives here.
 *
 * Findings this pins down (2026-09-13 audit):
 *  - S3.2 a position could be opened at price 0 (feed not filled yet) and P&L then read
 *         (livePrice - 0) * lots * contractSize — ~+$108k phantom profit on one EUR/USD lot.
 *  - A cleared <input type=number> yields NaN, and `NaN <= 0` is false, so the old
 *         `if (amount <= 0)` guard let NaN through.
 *  - S3.1 closing a position called setClosedTrades from inside a setPositions updater; React
 *         double-invokes updaters in StrictMode, which appended the trade twice.
 */

export const PRICE_EPSILON = 1e-9;

/** Simulator ceiling for order size — shared by the panel input and the validator so the
 *  message and the rule can never drift apart. */
export const MAX_LOTS = 100;

/** RFC4122 when available; crypto.randomUUID is secure-context-only, so keep a fallback. */
export function makeId(prefix: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return `${prefix}_${c.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Signed P&L in quote currency for a position/trade. */
export function computePnl(
  type: 'BUY' | 'SELL',
  entryPrice: number,
  exitPrice: number,
  amount: number,
  contractSize: number
): number {
  const direction = type === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return parseFloat((direction * amount * contractSize).toFixed(2));
}

/** SL is inclusive: touching the level executes it (that is how a real stop behaves). */
export function isStopLossHit(type: 'BUY' | 'SELL', livePrice: number, sl: number | undefined): boolean {
  if (sl === undefined || !Number.isFinite(sl)) return false;
  return type === 'BUY' ? livePrice <= sl : livePrice >= sl;
}

export function isTakeProfitHit(type: 'BUY' | 'SELL', livePrice: number, tp: number | undefined): boolean {
  if (tp === undefined || !Number.isFinite(tp)) return false;
  return type === 'BUY' ? livePrice >= tp : livePrice <= tp;
}

export type OrderRejectionReason = 'NO_PRICE' | 'BAD_AMOUNT' | 'SLTP_MISORDERED';

// Discriminated (was an interface with an optional reason, which allowed `{ ok: false }` with no
// reason at all — and then every consumer had to second-guess whether one was set).
export type OrderRejection = { ok: true } | { ok: false; reason: OrderRejectionReason };

export const ORDER_REJECTION_TEXT: Record<OrderRejectionReason, string> = {
  NO_PRICE: 'No live market price available — order rejected.',
  BAD_AMOUNT: 'Invalid lot size or stop/target value.',
  SLTP_MISORDERED: 'Stop loss and take profit are on the wrong sides of the entry.',
};

/**
 * Validate an order before it is booked. `price <= 0` is rejected because the terminal
 * deliberately shows 0 rather than a fabricated number while the feed is cold.
 */
export function validateOrder(args: {
  type?: 'BUY' | 'SELL';
  price: number;
  amount: number;
  sl?: number;
  tp?: number;
  maxLots?: number;
}): OrderRejection {
  const { type = 'BUY', price, amount, sl, tp, maxLots } = args;
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: 'NO_PRICE' };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'BAD_AMOUNT' };
  if (maxLots !== undefined && amount > maxLots) return { ok: false, reason: 'BAD_AMOUNT' };
  if (sl !== undefined && (!Number.isFinite(sl) || sl <= 0)) return { ok: false, reason: 'BAD_AMOUNT' };
  if (tp !== undefined && (!Number.isFinite(tp) || tp <= 0)) return { ok: false, reason: 'BAD_AMOUNT' };
  // The stop/target ordering is DIRECTION-DEPENDENT: a BUY risks below and profits above, a SELL
  // is the mirror image. (An unconditional `sl < tp` check looks reasonable and silently rejects
  // every valid short.) A pair on the wrong side can never trigger, so it is rejected rather than
  // booked as a position whose exits are dead.
  if (sl !== undefined && tp !== undefined) {
    const misordered = type === 'BUY' ? sl >= tp : sl <= tp;
    if (misordered) return { ok: false, reason: 'SLTP_MISORDERED' };
  }
  return { ok: true };
}

export interface MarkToMarketResult {
  positions: TradePosition[];
  closed: ClosedTrade[];
  /** True when anything actually changed — callers use this to skip a setState. */
  changed: boolean;
}

/**
 * Re-value open positions against the latest feed, closing any that hit SL/TP.
 *
 * `priceBySymbol` must omit (or zero) symbols with no feed data: a missing price is NOT a price
 * of 0, and treating it as 0 both invents losses and fires stops that never happened.
 */
export function markToMarket(
  positions: TradePosition[],
  watchlistItems: WatchlistItem[],
  nowMs: number = Date.now()
): MarkToMarketResult {
  if (positions.length === 0) return { positions, closed: [], changed: false };

  const priceOf = new Map<string, number>();
  for (const item of watchlistItems) {
    if (item && Number.isFinite(item.price) && item.price > 0) priceOf.set(item.symbol, item.price);
  }

  const next: TradePosition[] = [];
  const closed: ClosedTrade[] = [];
  let changed = false;

  for (const pos of positions) {
    const livePrice = priceOf.get(pos.symbol);
    if (livePrice === undefined) {
      next.push(pos); // no feed for this symbol yet: leave the position untouched
      continue;
    }

    const contractSize = getContractSize(pos.symbol);
    const pnl = computePnl(pos.type, pos.entryPrice, livePrice, pos.amount, contractSize);

    const slHit = isStopLossHit(pos.type, livePrice, pos.sl);
    const tpHit = isTakeProfitHit(pos.type, livePrice, pos.tp);

    if (slHit || tpHit) {
      // Both levels can only be satisfied by one price when the stored pair is misordered
      // (possible for legacy rows written before validateOrder existed). Take the stop: the
      // conservative, broker-accurate resolution.
      const exitPrice = slHit ? pos.sl! : pos.tp!;
      const openTimeMs = pos.openedAt || nowMs - 3_600_000;
      closed.push({
        id: makeId('closed'),
        symbol: pos.symbol,
        type: pos.type,
        entryPrice: pos.entryPrice,
        exitPrice,
        amount: pos.amount,
        pnl: computePnl(pos.type, pos.entryPrice, exitPrice, pos.amount, contractSize),
        time: new Date(nowMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        closeReason: slHit ? 'SL Hit' : 'TP Hit',
        openedAt: openTimeMs,
        closedAt: nowMs,
        durationMs: Math.max(1000, nowMs - openTimeMs),
      });
      changed = true;
      continue;
    }

    if (pos.currentPrice !== livePrice || pos.pnl !== pnl) {
      next.push({ ...pos, currentPrice: livePrice, pnl });
      changed = true;
    } else {
      next.push(pos);
    }
  }

  return { positions: next, closed, changed };
}

export interface BuildClosedTradeArgs {
  position: TradePosition;
  exitPrice: number;
  nowMs?: number;
}

/** Manual close: one record, built outside any state updater so it cannot be duplicated. */
export function buildClosedTrade({ position, exitPrice, nowMs = Date.now() }: BuildClosedTradeArgs): ClosedTrade {
  const contractSize = getContractSize(position.symbol);
  const openTimeMs = position.openedAt || nowMs - 1_800_000;
  return {
    id: makeId('closed'),
    symbol: position.symbol,
    type: position.type,
    entryPrice: position.entryPrice,
    exitPrice,
    amount: position.amount,
    pnl: computePnl(position.type, position.entryPrice, exitPrice, position.amount, contractSize),
    time: new Date(nowMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    closeReason: 'Manual',
    openedAt: openTimeMs,
    closedAt: nowMs,
    durationMs: Math.max(1000, nowMs - openTimeMs),
  };
}
