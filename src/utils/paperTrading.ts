import type { TradePosition, ClosedTrade } from '../types';
import { getContractSize } from './forexData';
import { isExecutableQuote, type MarketQuote } from '../../shared/market';
import { valuePnl } from './money';

export const PRICE_EPSILON = 1e-9;
export const MAX_LOTS = 100;
export function makeId(prefix: string): string {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
    Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${id}`;
}

/** Quote-currency arithmetic only. Use valuePnl for an account-currency valuation. */
export function computePnl(type: 'BUY' | 'SELL', entry: number, exit: number, lots: number, contract: number): number {
  return Number(((type === 'BUY' ? exit - entry : entry - exit) * lots * contract).toFixed(2));
}
export function isStopLossHit(type: 'BUY' | 'SELL', price: number, sl: number | undefined): boolean {
  return sl !== undefined && Number.isFinite(sl) && (type === 'BUY' ? price <= sl : price >= sl);
}
export function isTakeProfitHit(type: 'BUY' | 'SELL', price: number, tp: number | undefined): boolean {
  return tp !== undefined && Number.isFinite(tp) && (type === 'BUY' ? price >= tp : price <= tp);
}

export type OrderRejectionReason = 'NO_PRICE' | 'STALE_PRICE' | 'BAD_AMOUNT' | 'SLTP_MISORDERED' | 'ACCOUNT_LOADING' | 'INSTRUMENT_CHANGED' | 'BOOK_LIMIT' | 'DEMO_FEED';
export type OrderRejection = { ok: true } | { ok: false; reason: OrderRejectionReason };
export const ORDER_REJECTION_TEXT: Record<OrderRejectionReason, string> = {
  BOOK_LIMIT: 'Journal capacity reached. Export and archive the book before opening more positions.',
  NO_PRICE: 'No market quote available — order rejected.',
  STALE_PRICE: 'A fresh, timestamped spot quote is required. Reference, stale, and futures-proxy prices cannot execute orders.',
  BAD_AMOUNT: `Lot size must be between 0.01 and ${MAX_LOTS}. Stop/target prices must be finite and positive.`,
  DEMO_FEED: 'The synthetic demo feed is active. Orders stay disabled while prices are simulated.',
  SLTP_MISORDERED: 'Stop loss and take profit must be on the correct sides of the entry price.',
  ACCOUNT_LOADING: 'Waiting for the account book to load.',
  INSTRUMENT_CHANGED: 'The feed instrument differs from this position. Spot and futures prices cannot be mixed.',
};
export function validateOrder(args: {
  type?: 'BUY' | 'SELL'; price: number; amount: number; sl?: number; tp?: number; maxLots?: number;
}): OrderRejection {
  const { type = 'BUY', price, amount, sl, tp, maxLots = MAX_LOTS } = args;
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: 'NO_PRICE' };
  if (!Number.isFinite(amount) || amount < 0.01 || amount > maxLots) return { ok: false, reason: 'BAD_AMOUNT' };
  for (const level of [sl, tp]) {
    if (level !== undefined && (!Number.isFinite(level) || level <= 0)) return { ok: false, reason: 'BAD_AMOUNT' };
  }
  if ((sl !== undefined && (type === 'BUY' ? sl >= price : sl <= price)) ||
      (tp !== undefined && (type === 'BUY' ? tp <= price : tp >= price))) {
    return { ok: false, reason: 'SLTP_MISORDERED' };
  }
  return { ok: true };
}

export interface BuildClosedTradeArgs {
  position: TradePosition;
  exitPrice: number;
  nowMs?: number;
  quotes?: readonly MarketQuote[];
  closeReason?: ClosedTrade['closeReason'];
}
/** Stable closure identity: retries of a position transition cannot invent a second closed trade. */
export function buildClosedTrade({ position, exitPrice, nowMs = Date.now(), quotes = [], closeReason = 'Manual' }: BuildClosedTradeArgs): ClosedTrade {
  return {
    id: `closed_${position.id}`, positionId: position.id,
    symbol: position.symbol, type: position.type, entryPrice: position.entryPrice, exitPrice,
    amount: position.amount, instrumentKind: position.instrumentKind,
    ...valuePnl(position.symbol, position.type, position.entryPrice, exitPrice, position.amount, quotes, nowMs),
    time: new Date(nowMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    closeReason, openedAt: position.openedAt, closedAt: nowMs,
    durationMs: position.openedAt !== undefined ? Math.max(0, nowMs - position.openedAt) : undefined,
  };
}

export interface MarkToMarketResult { positions: TradePosition[]; closed: ClosedTrade[]; changed: boolean }
/** Run for each ordered observed quote event, NOT on a rendering throttle. */
export function markToMarket(positions: TradePosition[], quotes: readonly MarketQuote[], nowMs = Date.now()): MarkToMarketResult {
  const next: TradePosition[] = [];
  const closed: ClosedTrade[] = [];
  let changed = false;
  for (const position of positions) {
    const quote = quotes.find(q => q.symbol === position.symbol);
    if (!isExecutableQuote(quote, nowMs) || (position.instrumentKind && position.instrumentKind !== quote.instrumentKind)) {
      next.push(position);
      continue;
    }
    const slHit = isStopLossHit(position.type, quote.price, position.sl);
    const tpHit = isTakeProfitHit(position.type, quote.price, position.tp);
    if (slHit || tpHit) {
      // Observed-quote simulation: gaps through stops fill at the adverse observed price.
      // Targets are conservative limit fills. No spread/fees, intrapoll path, or offline execution is implied.
      const exitPrice = slHit
        ? (position.type === 'BUY' ? Math.min(position.sl!, quote.price) : Math.max(position.sl!, quote.price))
        : position.tp!;
      closed.push(buildClosedTrade({ position, exitPrice, nowMs, quotes, closeReason: slHit ? 'SL Hit' : 'TP Hit' }));
      changed = true;
      continue;
    }
    const money = valuePnl(position.symbol, position.type, position.entryPrice, quote.price, position.amount, quotes, nowMs);
    if (position.currentPrice !== quote.price || position.pnl !== money.pnl || position.pnlQuote !== money.pnlQuote || position.markAsOf !== quote.asOf || position.pnlVersion !== 2) {
      next.push({ ...position, currentPrice: quote.price, markAsOf: quote.asOf, ...money });
      changed = true;
    } else next.push(position);
  }
  return { positions: changed ? next : positions, closed, changed };
}

/** Kept as a named helper for import/migration diagnostics, not a USD valuation. */
export function quotePnlFor(position: TradePosition, exitPrice: number): number {
  return computePnl(position.type, position.entryPrice, exitPrice, position.amount, getContractSize(position.symbol));
}
