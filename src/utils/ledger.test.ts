import { describe, it, expect } from 'vitest';
import { buildClosedTrade, validateOrder } from './paperTrading';
import { valuePnl, formatPnl, hasAccountPnl } from './money';
import { emptyLedger, mergeLedgers, parseLedger, normalizeClosedTrade, clearLedgerHistory } from './ledger';
import { csvCell, tradesCsv } from './csv';
import { position, closed, quote } from '../test/fixtures';

describe('versioned USD valuation', () => {
  it('does not add JPY to dollars', () => {
    const jpy = valuePnl('USDJPY', 'BUY', 150, 151, 1, [], Date.now());
    const eur = valuePnl('EURUSD', 'BUY', 1.1, 1.11, 1, [], Date.now());
    expect(jpy.pnlQuote).toBe(100000); expect(jpy.quoteCurrency).toBe('JPY'); expect(jpy.pnl).toBe(662.25);
    expect(jpy.pnl! + eur.pnl!).toBe(1662.25); expect(jpy.conversion?.quotePerUsd).toBe(151);
  });
  it('handles USD-base CAD and reverses shorts', () => {
    expect(valuePnl('USDCAD', 'BUY', 1.35, 1.36, 1, [], Date.now()).pnl).toBe(735.29);
    expect(valuePnl('USDCAD', 'SELL', 1.35, 1.36, 1, [], Date.now()).pnl).toBe(-735.29);
  });
  it('uses the actual metal contract sizes', () => {
    expect(valuePnl('XAUUSD', 'BUY', 2500, 2501, 1, [], Date.now()).pnl).toBe(100);
    expect(valuePnl('XAGUSD', 'BUY', 30, 31, .1, [], Date.now()).pnl).toBe(500);
  });
  it('requires fresh cross-currency FX and freezes its source/rate/time on closure', () => {
    const fx = quote('USDJPY', 151);
    const p = position('cross', { symbol: 'GBPJPY', entryPrice: 190, currentPrice: 191 });
    const trade = buildClosedTrade({ position: p, exitPrice: 191, quotes: [fx] });
    expect(trade.pnl).toBe(662.25); expect(trade.pnlQuote).toBe(100000);
    expect(trade.conversion).toEqual({ quotePerUsd: 151, asOf: fx.asOf, source: 'USDJPY:twelvedata' });
    expect(normalizeClosedTrade(trade).conversion).toEqual(trade.conversion);
    fx.price = 200;
    expect(trade.pnl).toBe(662.25); expect(normalizeClosedTrade(trade).pnl).toBe(662.25);
    expect(valuePnl('GBPJPY', 'BUY', 190, 191, 1, [], Date.now()).pnl).toBeNull();
    expect(valuePnl('GBPJPY', 'BUY', 190, 191, 1, [{ ...fx, asOf: Date.now() - 180000 }], Date.now()).pnl).toBeNull();
  });
  it('reconstructs legacy USD-base trades but never invents historical cross FX', () => {
    const legacy = { ...closed(), symbol: 'USDJPY', entryPrice: 150, exitPrice: 151, pnl: 100000, pnlVersion: undefined, conversion: undefined };
    expect(normalizeClosedTrade(legacy).pnl).toBe(662.25);
    const cross = normalizeClosedTrade({ ...legacy, symbol: 'GBPJPY', entryPrice: 190, exitPrice: 191 });
    expect(cross.pnl).toBeNull(); expect(cross.pnlQuote).toBe(100000); expect(formatPnl(cross)).toContain('JPY (USD unavailable)');
    expect(hasAccountPnl(legacy)).toBe(false);
  });
  it('does not accept a claimed historical cross conversion without source/time provenance', () => {
    const t = { ...closed(), symbol: 'GBPJPY', entryPrice: 190, exitPrice: 191, conversion: { quotePerUsd: 151, source: 'USDJPY:yahoo', asOf: null } };
    expect(() => normalizeClosedTrade(t)).toThrow('observation time');
    expect(() => normalizeClosedTrade({ ...t, conversion: { ...t.conversion, source: '' } })).toThrow('Invalid frozen');
  });
  it('validates protective levels against entry even if SL and TP are mutually ordered', () => {
    expect(validateOrder({ type: 'BUY', price: 1.10, amount: 1, sl: 1.12, tp: 1.13 }).ok).toBe(false);
    expect(validateOrder({ type: 'SELL', price: 1.10, amount: 1, sl: 1.08, tp: 1.07 }).ok).toBe(false);
  });
});

describe('atomic book merge and validation', () => {
  it('links each close to its position with a stable identity', () => {
    const p = position();
    expect(buildClosedTrade({ position: p, exitPrice: 1.11 }).id).toBe(buildClosedTrade({ position: p, exitPrice: 1.11 }).id);
    expect(buildClosedTrade({ position: p, exitPrice: 1.11 }).positionId).toBe(p.id);
  });
  it('closure wins over a stale cloud open row, idempotently in either direction', () => {
    const local = { ...emptyLedger(), closedTrades: [closed()] };
    const remote = { ...emptyLedger(), positions: [position()] };
    const merged = mergeLedgers(local, remote);
    expect(merged.positions).toEqual([]); expect(merged.closedTrades).toHaveLength(1);
    expect(mergeLedgers(remote, local)).toEqual(merged); expect(mergeLedgers(merged, remote)).toEqual(merged);
  });
  it('clearing history persists deletion AND closure tombstones', () => {
    const initial = mergeLedgers({ ...emptyLedger(), closedTrades: [closed()] }, emptyLedger());
    const cleared = clearLedgerHistory(initial);
    expect(cleared.closedTrades).toHaveLength(0);
    const merged = mergeLedgers(cleared, { ...initial, positions: [position()] });
    expect(merged.closedTrades).toEqual([]); expect(merged.positions).toEqual([]);
    expect(merged.deletedTradeIds).toContain('closed_pos_one'); expect(merged.closedPositionIds).toContain('pos_one');
  });
  it('retains concurrent local creations and rejects conflicting immutable edits', () => {
    const a = position('a'); const b = position('b');
    expect(mergeLedgers({ ...emptyLedger(), positions: [a] }, { ...emptyLedger(), positions: [b] }).positions).toHaveLength(2);
    expect(() => mergeLedgers({ ...emptyLedger(), positions: [a] }, { ...emptyLedger(), positions: [{ ...a, amount: 2 }] })).toThrow('Conflicting immutable');
  });
  it('converges deterministic simultaneous closes, without pretending to be broker execution', () => {
    const earlier = closed('one', { closedAt: 1000 }); const later = closed('one', { closedAt: 2000, exitPrice: 1.12 });
    const a = { ...emptyLedger(), closedTrades: [earlier] }; const b = { ...emptyLedger(), closedTrades: [later] };
    expect(mergeLedgers(a, b)).toEqual(mergeLedgers(b, a)); expect(mergeLedgers(a, b).closedTrades).toHaveLength(1);
    expect(mergeLedgers(a, b).closedTrades[0].closedAt).toBe(1000);
  });
  it.each([null, [], { version: 1 }, { ...emptyLedger(), positions: [{ id: 'x' }] }, { ...emptyLedger(), positions: [position('x', { amount: -1 })] }])('rejects corrupt book %j, instead of silently overwriting it', value => {
    expect(() => parseLedger(value)).toThrow();
  });
  it('round-trips frozen monetary provenance and tombstones', () => {
    const book = mergeLedgers({ ...emptyLedger(), closedTrades: [closed()], positions: [position('two')] }, emptyLedger());
    const restored = parseLedger(JSON.parse(JSON.stringify(book)));
    expect(restored.closedTrades[0].pnl).toBe(1000); expect(restored.closedTrades[0].pnlVersion).toBe(2);
    expect(restored.closedPositionIds).toEqual(book.closedPositionIds);
  });
});

describe('safe, provenance-preserving CSV', () => {
  it('quotes commas, double quotes and newlines and neutralizes spreadsheet formulas', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvCell('  @DDE')).toBe('"\'  @DDE"'); expect(csvCell(-12)).toBe('"-12"');
  });
  it('exports blank unknown USD rather than labeling JPY as dollars', () => {
    const t = normalizeClosedTrade({ ...closed(), symbol: 'GBPJPY', entryPrice: 190, exitPrice: 191, pnlVersion: undefined, conversion: undefined });
    const csv = tradesCsv([t]);
    expect(csv).toContain('"PnL USD","PnL quote","Quote currency"');
    expect(csv).toContain('"","100000","JPY"'); expect(csv).toContain('"FX observation UTC"');
  });
});
