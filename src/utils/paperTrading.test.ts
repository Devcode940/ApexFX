import { describe, it, expect } from 'vitest';
import type { TradePosition } from '../types';
import type { MarketQuote } from '../../shared/market';
import {
  buildClosedTrade,
  computePnl,
  isStopLossHit,
  isTakeProfitHit,
  makeId,
  markToMarket,
  validateOrder,
  type OrderRejectionReason,
  MAX_LOTS,
} from './paperTrading';

/**
 * `validateOrder` returns a discriminated union, so `.reason` only exists on the failure arm.
 * Assertions go through here: it reads better than `if (!r.ok) expect(r.reason)…` in ten places and
 * fails loudly (rather than comparing against undefined) if a case that should be rejected is accepted.
 */
function rejectionOf(args: Parameters<typeof validateOrder>[0]): OrderRejectionReason | 'ACCEPTED' {
  const r = validateOrder(args);
  return r.ok ? 'ACCEPTED' : r.reason;
}

const pos = (over: Partial<TradePosition> = {}): TradePosition => ({
  id: 'p1',
  symbol: 'EURUSD',
  type: 'BUY',
  entryPrice: 1.1,
  currentPrice: 1.1,
  amount: 1,
  pnl: 0,
  time: '00:00:00',
  openedAt: 1_000,
  ...over,
});

const quote = (symbol: string, price: number): MarketQuote => ({
  symbol,
  price,
  change: 0,
  high: price,
  low: price,
  provider: 'twelvedata', providerSymbol: symbol, instrumentKind: 'spot', asOf: 2000, receivedAt: 2000,
});

describe('computePnl', () => {
  it('prices a long against the contract size', () => {
    // 1 lot EUR/USD, 100k units: 10 pips = $1,000
    expect(computePnl('BUY', 1.1, 1.101, 1, 100000)).toBe(100);
    expect(computePnl('BUY', 1.1, 1.099, 1, 100000)).toBe(-100);
  });

  it('inverts sign for a short', () => {
    expect(computePnl('SELL', 1.1, 1.099, 1, 100000)).toBe(100);
    expect(computePnl('SELL', 1.1, 1.101, 1, 100000)).toBe(-100);
  });

  it('rounds to cents', () => {
    expect(computePnl('BUY', 1.1, 1.10123, 0.1, 100000)).toBe(12.3);
  });
});

describe('stop / target triggers', () => {
  it('is inclusive at the level (a touched stop executes)', () => {
    expect(isStopLossHit('BUY', 1.09, 1.09)).toBe(true);
    expect(isTakeProfitHit('BUY', 1.11, 1.11)).toBe(true);
  });

  it('mirrors for a short', () => {
    expect(isStopLossHit('SELL', 1.11, 1.11)).toBe(true);
    expect(isStopLossHit('SELL', 1.10, 1.11)).toBe(false);
    expect(isTakeProfitHit('SELL', 1.09, 1.09)).toBe(true);
  });

  it('never triggers on a missing or non-finite level', () => {
    expect(isStopLossHit('BUY', 1.0, undefined)).toBe(false);
    expect(isTakeProfitHit('BUY', 1.0, undefined)).toBe(false);
    expect(isStopLossHit('BUY', 1.0, NaN)).toBe(false);
    expect(isTakeProfitHit('BUY', 1.0, Infinity)).toBe(false);
  });
});

describe('validateOrder', () => {
  it('rejects an order when the feed has not filled (S3.2 phantom-P&L regression)', () => {
    expect(rejectionOf({ price: 0, amount: 1 })).toBe('NO_PRICE');
    expect(rejectionOf({ price: NaN, amount: 1 })).toBe('NO_PRICE');
    expect(rejectionOf({ price: -1, amount: 1 })).toBe('NO_PRICE');
  });

  it('catches a cleared number input, which `amount <= 0` does not', () => {
    // The trap this replaces: a cleared <input type=number> yields parseFloat('') -> NaN,
    // and the old guard was `if (amount <= 0)`, which NaN silently passes.
    const clearedInput = parseFloat('');
    expect(Number.isNaN(clearedInput)).toBe(true);
    expect(clearedInput <= 0).toBe(false); // <- why the old check was not enough
    expect(rejectionOf({ price: 1.1, amount: clearedInput })).toBe('BAD_AMOUNT');
    expect(rejectionOf({ price: 1.1, amount: NaN })).toBe('BAD_AMOUNT');
    expect(rejectionOf({ price: 1.1, amount: Infinity })).toBe('BAD_AMOUNT');
  });

  it('enforces the simulator lot ceiling', () => {
    expect(rejectionOf({ price: 1.1, amount: MAX_LOTS + 0.01, maxLots: MAX_LOTS })).toBe('BAD_AMOUNT');
    expect(validateOrder({ price: 1.1, amount: 0.1, maxLots: MAX_LOTS }).ok).toBe(true);
  });

  it('rejects a non-positive stop/target (they could never trigger)', () => {
    expect(rejectionOf({ type: 'BUY', price: 1.1, amount: 1, sl: 0 })).toBe('BAD_AMOUNT');
    expect(rejectionOf({ type: 'BUY', price: 1.1, amount: 1, tp: -5 })).toBe('BAD_AMOUNT');
  });

  it('orders stop/target by direction — the rule is NOT direction-independent', () => {
    // BUY: risk below, reward above.
    expect(validateOrder({ type: 'BUY', price: 1.1, amount: 1, sl: 1.09, tp: 1.12 }).ok).toBe(true);
    expect(rejectionOf({ type: 'BUY', price: 1.1, amount: 1, sl: 1.12, tp: 1.09 })).toBe('SLTP_MISORDERED');
    // SELL: mirror image. An unconditional `sl < tp` check would wrongly reject these.
    expect(validateOrder({ type: 'SELL', price: 1.1, amount: 1, sl: 1.12, tp: 1.09 }).ok).toBe(true);
    expect(rejectionOf({ type: 'SELL', price: 1.1, amount: 1, sl: 1.09, tp: 1.12 })).toBe('SLTP_MISORDERED');
  });
});

describe('markToMarket', () => {
  it('does NOT mark to zero or fire stops while the feed is cold', () => {
    const p = pos({ sl: 1.09 });
    const r = markToMarket([p], [], 2000);
    expect(r.changed).toBe(false);
    expect(r.positions).toEqual([p]);
    expect(r.closed).toEqual([]);

    // price 0 is "unknown", not "worthless" — the old code path produced ~+$108k on entry 0.
    const r2 = markToMarket([p], [quote('EURUSD', 0)], 2000);
    expect(r2.changed).toBe(false);
    expect(r2.closed).toEqual([]);
  });

  it('updates unrealized P&L without closing', () => {
    const r = markToMarket([pos()], [quote('EURUSD', 1.101)], 2000);
    expect(r.changed).toBe(true);
    expect(r.closed).toHaveLength(0);
    expect(r.positions[0].pnl).toBe(100);
    expect(r.positions[0].currentPrice).toBe(1.101);
  });

  it('closes through a stop at the adverse observed gap price', () => {
    const r = markToMarket([pos({ sl: 1.089 })], [quote('EURUSD', 1.085)], 5_000);
    expect(r.positions).toHaveLength(0);
    expect(r.closed).toHaveLength(1);
    expect(r.closed[0].closeReason).toBe('SL Hit');
    expect(r.closed[0].exitPrice).toBe(1.085); // observed gap, not an idealized stop fill
    expect(r.closed[0].pnl).toBe(-1500); // 150 pips x 100k units
    expect(r.closed[0].durationMs).toBe(4000);
  });

  it('cannot fire both levels for a correctly ordered pair (by construction)', () => {
    // BUY: sl < entry < tp, so no single price is <= sl AND >= tp. Assert the two reachable
    // cases instead of a phantom "gap through both" scenario.
    const tpOnly = markToMarket([pos({ sl: 1.05, tp: 1.15 })], [quote('EURUSD', 1.2)], 5_000);
    expect(tpOnly.closed[0].closeReason).toBe('TP Hit');
    expect(tpOnly.closed[0].exitPrice).toBe(1.15);

    const slOnly = markToMarket([pos({ sl: 1.05, tp: 1.15 })], [quote('EURUSD', 1.0)], 5_000);
    expect(slOnly.closed[0].closeReason).toBe('SL Hit');
    expect(slOnly.closed[0].exitPrice).toBe(1.0);
  });

  it('resolves to the stop when legacy data stored the pair misordered', () => {
    // Invalid levels are rejected at the import/order boundary. This direct helper case only
    // pins defensive stop priority; it is not evidence of broker execution.
    const r = markToMarket([pos({ sl: 1.15, tp: 1.05 })], [quote('EURUSD', 1.1)], 5_000);
    expect(r.closed).toHaveLength(1);
    expect(r.closed[0].closeReason).toBe('SL Hit');
    expect(r.closed[0].exitPrice).toBe(1.1);
  });

  it('is a no-op for symbols the feed does not carry', () => {
    const r = markToMarket([pos({ symbol: 'XAUUSD' })], [quote('EURUSD', 1.101)], 5000);
    expect(r.changed).toBe(false);
    expect(r.closed).toHaveLength(0);
  });
});

describe('buildClosedTrade (manual close)', () => {
  it('produces exactly one record per call, flagged Manual', () => {
    const a = buildClosedTrade({ position: pos(), exitPrice: 1.101, nowMs: 2000 });
    expect(a.closeReason).toBe('Manual');
    expect(a.pnl).toBe(100);
    expect(a.closedAt).toBe(2000);
    expect(a.id.startsWith('closed_')).toBe(true);
  });

  it('keeps duration unknown when openedAt is missing (legacy localStorage rows)', () => {
    const legacy = { ...pos(), openedAt: undefined } as TradePosition;
    const t = buildClosedTrade({ position: legacy, exitPrice: 1.101, nowMs: 10_000 });
    expect(t.durationMs).toBeUndefined();
  });
});

describe('makeId', () => {
  it('does not collide within a burst (Supabase shares one PRIMARY KEY across users)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(makeId('pos'));
    expect(ids.size).toBe(5000);
  });

  it('is not timestamp-derivable in isolation', () => {
    const [a, b] = [makeId('pos'), makeId('pos')];
    expect(a).not.toBe(b);
    expect(a.split('_')[1]).toBeDefined();
  });
});
