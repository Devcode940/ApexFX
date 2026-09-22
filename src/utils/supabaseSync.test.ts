import { describe, it, expect } from 'vitest';
import type { TradePosition, ClosedTrade } from '../types';
import { mergeById, mergePositions, mergeTrades, positionPips, tradePips } from './supabaseSync';

const pos = (over: Partial<TradePosition> = {}): TradePosition => ({
  id: 'p1',
  symbol: 'EURUSD',
  type: 'BUY',
  entryPrice: 1.1,
  currentPrice: 1.11,
  amount: 1,
  pnl: 1000,
  time: '10:00:00',
  ...over,
});

const trade = (over: Partial<ClosedTrade> = {}): ClosedTrade => ({
  id: 't1',
  symbol: 'EURUSD',
  type: 'BUY',
  entryPrice: 1.1,
  exitPrice: 1.111,
  amount: 1,
  pnl: 1100,
  time: '11:00:00',
  closeReason: 'Manual',
  openedAt: 1_000,
  closedAt: 2_000,
  ...over,
});

describe('mergeById', () => {
  it('never drops a local row that the remote does not have (the data-loss bug)', () => {
    const local = [pos({ id: 'a' }), pos({ id: 'local-only' })];
    const remote = [pos({ id: 'a' }), pos({ id: 'remote-only' })];
    const merged = mergeById(local, remote);
    expect(merged.map((m) => m.id).sort()).toEqual(['a', 'local-only', 'remote-only']);
  });

  it('lets remote values win for a shared id, without duplicating it', () => {
    const merged = mergeById([pos({ id: 'a', entryPrice: 1.0 })], [pos({ id: 'a', entryPrice: 2.0 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].entryPrice).toBe(2.0);
  });

  it('keeps local values when the winner is local', () => {
    const merged = mergeById([pos({ id: 'a', entryPrice: 1.0 })], [pos({ id: 'a', entryPrice: 2.0 })], 'local');
    expect(merged[0].entryPrice).toBe(1.0);
  });

  it('handles empty sides', () => {
    expect(mergeById([], [])).toEqual([]);
    expect(mergeById([pos()], [])).toHaveLength(1);
    expect(mergeById([], [pos()])).toHaveLength(1);
  });
});

describe('mergePositions', () => {
  it('keeps a local position the remote does not know about', () => {
    const merged = mergePositions([pos({ id: 'local-only' })], [pos({ id: 'a' })]);
    expect(merged.map((m) => m.id).sort()).toEqual(['a', 'local-only']);
  });

  it('takes remote field values for a shared id, including protective levels', () => {
    const merged = mergePositions(
      [pos({ id: 'a', sl: undefined })],
      [pos({ id: 'a', sl: 1.05, tp: 1.25, entryPrice: 1.09 })]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].sl).toBe(1.05);
    expect(merged[0].tp).toBe(1.25);
    expect(merged[0].entryPrice).toBe(1.09);
  });
});

describe('mergeTrades', () => {
  it('orders newest close first so the journal does not look shuffled', () => {
    const merged = mergeTrades([trade({ id: 'old', closedAt: 1_000 })], [trade({ id: 'new', closedAt: 9_000 })]);
    expect(merged.map((t) => t.id)).toEqual(['new', 'old']);
  });

  it('sorts rows with no closedAt deterministically instead of NaN', () => {
    const legacy = trade({ id: 'legacy' });
    delete (legacy as Partial<ClosedTrade>).closedAt;
    const merged = mergeTrades([legacy], [trade({ id: 'dated', closedAt: 5 })]);
    expect(merged.map((t) => t.id)).toEqual(['dated', 'legacy']);
  });
});

describe('pips written to the database', () => {
  it('position pips are the signed move from entry (was a hardcoded 0)', () => {
    expect(positionPips(pos({ entryPrice: 1.1, currentPrice: 1.111 }))).toBe(110);
    expect(positionPips(pos({ entryPrice: 1.1, currentPrice: 1.089 }))).toBe(-110);
    expect(positionPips(pos({ entryPrice: 1.1, currentPrice: 1.1 }))).toBe(0);
  });

  it('trade pips follow instrument precision, not a JPY-only ternary', () => {
    expect(tradePips(trade({ symbol: 'EURUSD', entryPrice: 1.1, exitPrice: 1.111 }))).toBe(110);
    expect(tradePips(trade({ symbol: 'USDJPY', entryPrice: 150, exitPrice: 151.55 }))).toBe(155);
    // gold: pip = 0.01, so a $2.50 move is 250 pips (the old inline table said 25,000)
    expect(tradePips(trade({ symbol: 'XAUUSD', entryPrice: 2650, exitPrice: 2652.5 }))).toBe(250);
    // and it is a magnitude, matching what existing rows in the table contain
    expect(tradePips(trade({ symbol: 'EURUSD', entryPrice: 1.111, exitPrice: 1.1 }))).toBe(110);
  });
});
