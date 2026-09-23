// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaperTrading } from './usePaperTrading';
import { QuoteStore } from '../utils/quoteStore';
import { bookStorageKey, emptyLedger } from '../utils/ledger';
import { quote, position, closed } from '../test/fixtures';
import { renderHook } from '../test/harness';

const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => localStorage.clear());
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
async function mount(store: QuoteStore, owner: string | null = 'guest', symbol = 'EURUSD') {
  const hook = await renderHook((owner: string | null) => usePaperTrading(store, symbol, owner), owner, true);
  cleanups.push(hook.unmount); return hook;
}

describe('real React paper book / ordered quote integration', () => {
  it('executes a stop touch/rebound between renders exactly once, including StrictMode', async () => {
    const store = new QuoteStore(); const hook = await mount(store);
    let id = '';
    act(() => {
      store.apply({ EURUSD: quote() });
      const opened = hook.result.handleOpenPosition('BUY', 1, 1.09, 1.12);
      expect(opened.ok).toBe(true); if (opened.ok) id = opened.id;
      store.apply({ EURUSD: quote('EURUSD', 1.08) });
      store.apply({ EURUSD: quote('EURUSD', 1.1) });
      hook.result.handleClosePosition(id); hook.result.handleClosePosition(id);
    });
    expect(hook.result.positions).toHaveLength(0); expect(hook.result.closedTrades).toHaveLength(1);
    expect(hook.result.closedTrades[0]).toMatchObject({ positionId: id, exitPrice: 1.08, pnl: -2000, closeReason: 'SL Hit' });
    expect(JSON.parse(localStorage.getItem(bookStorageKey('guest'))!).closedTrades).toHaveLength(1);
  });
  it('uses a synchronous authoritative book for open then double-close before a render', async () => {
    const store = new QuoteStore(); const hook = await mount(store);
    act(() => {
      store.apply({ EURUSD: quote() });
      const result = hook.result.handleOpenPosition('BUY', 1);
      if (!result.ok) throw new Error('Expected open');
      store.apply({ EURUSD: quote('EURUSD', 1.11) });
      hook.result.handleClosePosition(result.id); hook.result.handleClosePosition(result.id);
    });
    expect(hook.result.positions).toHaveLength(0); expect(hook.result.closedTrades).toHaveLength(1);
    expect(hook.result.closedTrades[0].pnl).toBe(1000);
  });
  it('will not open or manually close on stale/reference/futures/historical prices', async () => {
    const store = new QuoteStore(); const hook = await mount(store);
    expect(hook.result.handleOpenPosition('BUY', 1)).toEqual({ ok: false, reason: 'NO_PRICE' });
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.1, { asOf: Date.now() - 180000 }) }));
    expect(hook.result.handleOpenPosition('BUY', 1)).toEqual({ ok: false, reason: 'STALE_PRICE' });
    act(() => store.apply({ EURUSD: quote() }));
    let id = '';
    act(() => { const result = hook.result.handleOpenPosition('BUY', 1); if (result.ok) id = result.id; });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 180000);
    expect(hook.result.handleClosePosition(id)).toEqual({ ok: false, reason: 'STALE_PRICE' });
    expect(hook.result.positions).toHaveLength(1);
  });
  it('calculates actual USD realized P&L in the live hook', async () => {
    const store = new QuoteStore(); const hook = await mount(store, 'guest', 'USDJPY');
    act(() => {
      store.apply({ USDJPY: quote('USDJPY', 150) });
      const result = hook.result.handleOpenPosition('BUY', 1);
      if (!result.ok) throw new Error('Expected open');
      store.apply({ USDJPY: quote('USDJPY', 151) });
      hook.result.handleClosePosition(result.id);
    });
    expect(hook.result.closedTrades[0]).toMatchObject({ pnlQuote: 100000, quoteCurrency: 'JPY', pnl: 662.25, pnlVersion: 2 });
  });
  it('merges into state that changed during a cloud request, and closure wins', async () => {
    const store = new QuoteStore(); const hook = await mount(store);
    const applyAfterAwait = hook.result.applyRemoteLedger;
    act(() => {
      store.apply({ EURUSD: quote() });
      hook.result.handleOpenPosition('BUY', 1);
      applyAfterAwait({ ...emptyLedger(), positions: [position('remote')], closedTrades: [closed('remote')] });
    });
    expect(hook.result.positions).toHaveLength(1); expect(hook.result.positions[0].id).not.toBe('remote');
    expect(hook.result.closedTrades).toHaveLength(1);
  });
  it('retains recoverable original data on corrupt storage and blocks execution', async () => {
    const key = bookStorageKey('guest'); localStorage.setItem(key, '{invalid');
    const store = new QuoteStore(); store.apply({ EURUSD: quote() }); const hook = await mount(store);
    expect(hook.result.bookReady).toBe(false); expect(hook.result.storageError).toContain('Original storage is untouched');
    expect(hook.result.handleOpenPosition('BUY', 1)).toEqual({ ok: false, reason: 'ACCOUNT_LOADING' });
    expect(localStorage.getItem(key)).toBe('{invalid');
  });
  it('restored opens have unknown P&L until a real compatible quote marks them', async () => {
    localStorage.setItem(bookStorageKey('guest'), JSON.stringify({ ...emptyLedger(), positions: [position('saved', { currentPrice: 1.2, pnl: 10000 })] }));
    const store = new QuoteStore(); const hook = await mount(store);
    expect(hook.result.positions[0].pnl).toBeNull();
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.11) }));
    expect(hook.result.positions[0].pnl).toBe(1000); expect(hook.result.positions[0].markAsOf).toBeTruthy();
  });
  it('keeps cross-currency open marks in USD, and freezes realized conversion after closing', async () => {
    const store = new QuoteStore(); const hook = await mount(store, 'guest', 'GBPJPY'); let id = '';
    act(() => {
      store.apply({ GBPJPY: quote('GBPJPY', 190), USDJPY: quote('USDJPY', 151) });
      const opened = hook.result.handleOpenPosition('BUY', 1); if (opened.ok) id = opened.id;
      store.apply({ GBPJPY: quote('GBPJPY', 191) });
    });
    expect(hook.result.positions[0].pnl).toBe(662.25);
    act(() => { hook.result.handleClosePosition(id); store.apply({ USDJPY: quote('USDJPY', 200) }); });
    expect(hook.result.closedTrades[0].pnl).toBe(662.25); expect(hook.result.closedTrades[0].conversion?.quotePerUsd).toBe(151);
  });
  it('repairs from a validated backup without destroying the corrupt original', async () => {
    const key = bookStorageKey('guest'); localStorage.setItem(key, '{recover me');
    const hook = await mount(new QuoteStore());
    act(() => hook.result.restoreBook({ owner: 'guest', book: { ...emptyLedger(), positions: [position('restored')] } }));
    expect(hook.result.bookReady).toBe(true); expect(hook.result.positions[0].id).toBe('restored');
    expect(localStorage.getItem(`${key}:recovery-original`)).toBe('{recover me');
  });
  it('rejects invalid/wrong-owner restores, and old backups cannot resurrect a close', async () => {
    const hook = await mount(new QuoteStore());
    expect(() => hook.result.restoreBook({ owner: 'user:A', book: emptyLedger() })).toThrow('different');
    expect(() => hook.result.restoreBook({ version: 2 })).toThrow();
    act(() => hook.result.applyRemoteLedger({ ...emptyLedger(), closedTrades: [closed('closed-before-backup')] }));
    act(() => hook.result.restoreBook({ owner: 'guest', book: { ...emptyLedger(), positions: [position('closed-before-backup'), position('new')] } }));
    expect(hook.result.positions.map(p => p.id)).toEqual(['new']);
  });
  it('surfaces failed durable writes instead of claiming a successful local save', async () => {
    const store = new QuoteStore(); const hook = await mount(store);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => { store.apply({ EURUSD: quote() }); hook.result.handleOpenPosition('BUY', 1); });
    expect(hook.result.positions).toHaveLength(1); expect(hook.result.storageError).toContain('memory-only');
  });
});

describe('account ownership / async-generation boundaries', () => {
  it('A → guest → B never carries A positions or writes them under B', async () => {
    localStorage.setItem(bookStorageKey('user:A'), JSON.stringify({ ...emptyLedger(), positions: [position('a')] }));
    localStorage.setItem(bookStorageKey('user:B'), JSON.stringify({ ...emptyLedger(), positions: [position('b')] }));
    const hook = await mount(new QuoteStore(), 'user:A');
    const staleGet = hook.result.getLedger; const staleApply = hook.result.applyRemoteLedger;
    expect(hook.result.positions.map(p => p.id)).toEqual(['a']);
    await hook.rerender('guest'); expect(hook.result.positions).toEqual([]);
    await hook.rerender('user:B'); expect(hook.result.positions.map(p => p.id)).toEqual(['b']);
    expect(() => staleGet()).toThrow('Account book changed');
    expect(() => staleApply({ ...emptyLedger(), positions: [position('a')] })).toThrow('Account book changed');
    expect(JSON.parse(localStorage.getItem(bookStorageKey('user:B'))!).positions.map((p: { id: string }) => p.id)).toEqual(['b']);
  });
  it('invalidates a late sync even after logging back into the SAME account', async () => {
    const hook = await mount(new QuoteStore(), 'user:A'); const oldApply = hook.result.applyRemoteLedger;
    await hook.rerender('guest'); await hook.rerender('user:A');
    expect(() => oldApply({ ...emptyLedger(), positions: [position()] })).toThrow('Account book changed');
    expect(hook.result.positions).toEqual([]);
  });
  it('waits for auth readiness and makes legacy import an explicit, non-destructive action', async () => {
    const legacy = JSON.stringify([position('legacy')]); localStorage.setItem('forexinsight_positions', legacy);
    const hook = await mount(new QuoteStore(), null);
    expect(hook.result.bookReady).toBe(false);
    await hook.rerender('user:A'); expect(hook.result.positions).toEqual([]); expect(hook.result.legacyAvailable).toBe(true);
    act(() => hook.result.importLegacy()); expect(hook.result.positions[0].id).toBe('legacy');
    expect(localStorage.getItem('forexinsight_positions')).toBe(legacy);
    await hook.rerender('user:B'); expect(hook.result.positions).toEqual([]);
    expect(localStorage.getItem(bookStorageKey('user:B'))).toBeNull();
  });
});