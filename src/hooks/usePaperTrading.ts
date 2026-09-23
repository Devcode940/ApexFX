import { useState, useEffect, useCallback, useRef } from 'react';
import type { TradePosition, ClosedTrade } from '../types';
import { buildClosedTrade, markToMarket, validateOrder, makeId, type OrderRejectionReason } from '../utils/paperTrading';
import { isExecutableQuote } from '../../shared/market';
import { valuePnl } from '../utils/money';
import { bookStorageKey, clearLedgerHistory, durableLedger, emptyLedger, mergeLedgers, normalizeClosedTrade, normalizePosition, parseLedger, type Ledger, MAX_LEDGER_ROWS } from '../utils/ledger';
import type { QuoteStore } from '../utils/quoteStore';

export type OpenPositionResult = { ok: true; id: string } | { ok: false; reason: OrderRejectionReason };
export type ClosePositionResult = { ok: true } | { ok: false; reason: OrderRejectionReason };
export interface UsePaperTradingApi {
  positions: TradePosition[];
  closedTrades: ClosedTrade[];
  bookReady: boolean;
  bookGeneration: number;
  storageError: string | null;
  legacyAvailable: boolean;
  importLegacy: () => void;
  restoreBook: (backup: unknown) => void;
  getLedger: () => Ledger;
  applyRemoteLedger: (book: Ledger) => void;
  handleOpenPosition: (type: 'BUY' | 'SELL', amount: number, sl?: number, tp?: number) => OpenPositionResult;
  handleClosePosition: (id: string) => ClosePositionResult;
  handleClearHistory: () => void;
}
interface Snapshot { owner: string | null; epoch: number; ready: boolean; book: Ledger; error: string | null; legacy: boolean }

/** Atomic book ref is the authority. React is a projection, never the execution queue. */
export function usePaperTrading(store: QuoteStore, selectedSymbol: string, owner: string | null): UsePaperTradingApi {
  const [snapshot, setSnapshot] = useState<Snapshot>({ owner: null, epoch: 0, ready: false, book: emptyLedger(), error: null, legacy: false });
  const state = useRef(snapshot);
  const publish = useCallback((next: Snapshot, persist: boolean) => {
    if (persist && next.owner && next.ready) {
      try {
        localStorage.setItem(bookStorageKey(next.owner), JSON.stringify(durableLedger(next.book)));
        next = { ...next, error: null };
      } catch {
        next = { ...next, error: 'Local save failed (storage blocked/full). Changes are memory-only; export or sync before leaving.' };
      }
    }
    state.current = next;
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    const epoch = state.current.epoch + 1;
    let initial: Snapshot = { owner, epoch, ready: false, book: emptyLedger(), error: null, legacy: false };
    if (owner) {
      try {
        const raw = localStorage.getItem(bookStorageKey(owner));
        initial = { ...initial, ready: true, book: raw ? parseLedger(JSON.parse(raw)) : emptyLedger(),
          legacy: !localStorage.getItem(`${bookStorageKey(owner)}:legacy-imported`) && !!(localStorage.getItem('forexinsight_positions') || localStorage.getItem('forexinsight_closed_trades')) };
      } catch (error) {
        initial.error = `Book not loaded: ${error instanceof Error ? error.message : 'Invalid stored data.'} Original storage is untouched; export it before repair.`;
      }
    }
    publish(initial, false);
    const observe = () => {
      const current = state.current;
      if (!current.ready || current.owner !== owner || current.epoch !== epoch) return;
      const result = markToMarket(current.book.positions, store.snapshot());
      if (!result.changed) return;
      const book = mergeLedgers({ ...current.book, positions: result.positions, closedTrades: [...result.closed, ...current.book.closedTrades] }, emptyLedger());
      publish({ ...current, book }, result.closed.length > 0);
    };
    observe();
    const unsubscribe = store.subscribe(observe);
    return () => {
      unsubscribe();
      state.current = { ...state.current, ready: false, epoch: state.current.epoch + 1 };
    };
  }, [owner, store, publish]);

  // Each API closure is scoped to an identity generation. A late request from even the SAME account
  // after logout/relogin cannot apply its result to this new book session.
  const epoch = snapshot.epoch;
  const current = useCallback((): Snapshot => {
    const s = state.current;
    if (!owner || s.owner !== owner || !s.ready || s.epoch !== epoch) throw new Error('Account book changed; retry in the current account.');
    return s;
  }, [owner, epoch]);
  const getLedger = useCallback(() => current().book, [current]);
  const applyRemoteLedger = useCallback((remote: Ledger) => {
    const s = current();
    const merged = mergeLedgers(s.book, remote); // latest state AFTER await, not arrays captured at request start
    const marked = markToMarket(merged.positions, store.snapshot());
    const book = mergeLedgers({ ...merged, positions: marked.positions, closedTrades: [...marked.closed, ...merged.closedTrades] }, emptyLedger());
    publish({ ...s, book }, true);
  }, [current, store, publish]);

  const handleOpenPosition = useCallback<UsePaperTradingApi['handleOpenPosition']>((type, amount, sl, tp) => {
    let s: Snapshot;
    try { s = current(); } catch { return { ok: false, reason: 'ACCOUNT_LOADING' }; }
    if (s.book.positions.length + s.book.closedPositionIds.length >= MAX_LEDGER_ROWS || s.book.positions.length + s.book.closedTrades.length >= MAX_LEDGER_ROWS) return { ok: false, reason: 'BOOK_LIMIT' };
    const now = Date.now();
    const quote = store.get(selectedSymbol);
    if (quote?.provider === 'demo') return { ok: false, reason: 'DEMO_FEED' };
    if (!isExecutableQuote(quote, now)) return { ok: false, reason: quote ? 'STALE_PRICE' : 'NO_PRICE' };
    const valid = validateOrder({ type, price: quote.price, amount, sl, tp });
    if (!valid.ok) return valid;
    const position: TradePosition = {
      id: makeId('pos'), symbol: selectedSymbol, type, entryPrice: quote.price, currentPrice: quote.price, markAsOf: quote.asOf,
      amount, sl, tp, instrumentKind: quote.instrumentKind, ...valuePnl(selectedSymbol, type, quote.price, quote.price, amount, store.snapshot(), now),
      time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), openedAt: now,
    };
    publish({ ...s, book: mergeLedgers({ ...s.book, positions: [position, ...s.book.positions] }, emptyLedger()) }, true);
    return { ok: true, id: position.id };
  }, [current, store, selectedSymbol, publish]);
  const handleClosePosition = useCallback<UsePaperTradingApi['handleClosePosition']>((id) => {
    let s: Snapshot;
    try { s = current(); } catch { return { ok: false, reason: 'ACCOUNT_LOADING' }; }
    const target = s.book.positions.find(p => p.id === id);
    if (!target) return { ok: true }; // already closed: idempotent double click / replay
    const quote = store.get(target.symbol);
    if (quote?.provider === 'demo') return { ok: false, reason: 'DEMO_FEED' };
    if (!isExecutableQuote(quote)) return { ok: false, reason: 'STALE_PRICE' };
    if (target.instrumentKind && target.instrumentKind !== quote.instrumentKind) return { ok: false, reason: 'INSTRUMENT_CHANGED' };
    const record = buildClosedTrade({ position: target, exitPrice: quote.price, quotes: store.snapshot() });
    const book = mergeLedgers({ ...s.book, positions: s.book.positions.filter(p => p.id !== id), closedTrades: [record, ...s.book.closedTrades] }, emptyLedger());
    publish({ ...s, book }, true);
    return { ok: true };
  }, [current, store, publish]);
  const handleClearHistory = useCallback(() => {
    const s = current();
    publish({ ...s, book: clearLedgerHistory(s.book) }, true);
  }, [current, publish]);
  const importLegacy = useCallback(() => {
    const s = current();
    // Explicit opt-in only. Unscoped old keys remain intact for backup/manual ownership review.
    const positions: unknown = JSON.parse(localStorage.getItem('forexinsight_positions') ?? '[]');
    const closed: unknown = JSON.parse(localStorage.getItem('forexinsight_closed_trades') ?? '[]');
    if (!Array.isArray(positions) || !Array.isArray(closed)) throw new Error('Invalid legacy book; original keys preserved.');
    const legacy = { ...emptyLedger(), positions: positions.map(normalizePosition), closedTrades: closed.map(normalizeClosedTrade) };
    const book = mergeLedgers(s.book, legacy);
    const saved = publish({ ...s, book, legacy: false }, true);
    if (saved.error) throw new Error(saved.error);
    try { localStorage.setItem(`${bookStorageKey(s.owner!)}:legacy-imported`, 'true'); } catch { /* original keys still preserved */ }
  }, [current, publish]);

  const restoreBook = useCallback((backup: unknown) => {
    const s = state.current;
    if (!owner || s.owner !== owner || s.epoch !== epoch) throw new Error('Account changed while reading the backup.');
    if (!backup || typeof backup !== 'object') throw new Error('Invalid backup.');
    const wrapper = backup as Record<string, unknown>;
    if ('owner' in wrapper && wrapper.owner !== owner) throw new Error('Backup belongs to a different guest/account namespace. Switch to that book first.');
    const imported = parseLedger(wrapper.book ?? backup);
    const merged = s.ready ? mergeLedgers(s.book, imported) : imported;
    const marked = markToMarket(merged.positions, store.snapshot());
    const book = mergeLedgers({ ...merged, positions: marked.positions, closedTrades: [...marked.closed, ...merged.closedTrades] }, emptyLedger());
    // A corrupt/unreadable original is copied BEFORE replacement; failure to preserve it fails closed.
    const key = bookStorageKey(owner);
    if (!s.ready) {
      const raw = localStorage.getItem(key);
      if (raw !== null) localStorage.setItem(`${key}:recovery-original`, raw);
    }
    const saved = publish({ ...s, ready: true, book, error: null }, true);
    if (saved.error) throw new Error(saved.error);
  }, [owner, epoch, store, publish]);

  const visible = snapshot.owner === owner && snapshot.ready;
  return {
    positions: visible ? snapshot.book.positions : [], closedTrades: visible ? snapshot.book.closedTrades : [],
    bookReady: visible, bookGeneration: epoch, storageError: snapshot.owner === owner ? snapshot.error : null,
    legacyAvailable: visible && snapshot.legacy, importLegacy, restoreBook, getLedger, applyRemoteLedger,
    handleOpenPosition, handleClosePosition, handleClearHistory,
  };
}
