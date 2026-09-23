import { describe, it, expect, vi } from 'vitest';
import { syncLedger, supabaseLedgerTransport, exportLegacyCloud, type LedgerTransport } from './cloudLedger';
import { durableLedger, emptyLedger, mergeLedgers, clearLedgerHistory, type Ledger } from './ledger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { position, closed } from '../test/fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(book: Ledger) {
  let local = book; let remote = emptyLedger(); let revision = 0;
  const transport: LedgerTransport = {
    read: vi.fn(async () => ({ revision, book: remote })),
    compareAndSwap: vi.fn(async (expected, next) => { if (expected !== revision) return false; remote = next; revision++; return true; }),
  };
  return { transport, getLocal: () => local, apply: (next: Ledger) => { local = mergeLedgers(local, next); },
    get remote() { return remote; }, set local(value: Ledger) { local = value; },
    setRemote: (next: Ledger) => { remote = next; revision++; } };
}
describe('versioned cloud transaction loop', () => {
  it('keeps trades opened while a pull is in flight', async () => {
    const s = setup(emptyLedger()); const wait = deferred<{ revision: number; book: Ledger }>();
    s.transport.read = () => wait.promise;
    const pending = syncLedger({ ...s, signal: new AbortController().signal, push: false });
    s.local = { ...emptyLedger(), positions: [position('during-fetch')] };
    wait.resolve({ revision: 1, book: { ...emptyLedger(), closedTrades: [closed('remote')] } });
    await pending;
    expect(s.getLocal().positions[0].id).toBe('during-fetch'); expect(s.getLocal().closedTrades).toHaveLength(1);
  });
  it('retries a compare-and-swap conflict instead of overwriting another device', async () => {
    const s = setup({ ...emptyLedger(), positions: [position('local')] });
    const write = s.transport.compareAndSwap;
    s.transport.compareAndSwap = vi.fn(async (expected, book, signal) => {
      if (expected === 0) { s.setRemote({ ...emptyLedger(), positions: [position('other-device')] }); return false; }
      return write(expected, book, signal);
    });
    await syncLedger({ ...s, signal: new AbortController().signal, push: true });
    expect(s.remote.positions.map(p => p.id).sort()).toEqual(['local', 'other-device']);
    expect(s.transport.compareAndSwap).toHaveBeenCalledTimes(2);
  });
  it('performs a second atomic commit for a close/open occurring while the first push awaits', async () => {
    const s = setup({ ...emptyLedger(), positions: [position('first')] });
    const write = s.transport.compareAndSwap;
    let first = true;
    s.transport.compareAndSwap = vi.fn(async (expected, book, signal) => {
      if (first) { first = false; s.local = mergeLedgers({ ...emptyLedger(), closedTrades: [closed('first')], positions: [position('second')] }, s.getLocal()); }
      return write(expected, book, signal);
    });
    await syncLedger({ ...s, signal: new AbortController().signal, push: true });
    expect(s.remote.positions.map(p => p.id)).toEqual(['second']); expect(s.remote.closedTrades[0].positionId).toBe('first');
    expect(s.transport.compareAndSwap).toHaveBeenCalledTimes(2);
  });
  it('pushes an empty visible history with persistent tombstones', async () => {
    const previous = mergeLedgers({ ...emptyLedger(), closedTrades: [closed('one')] }, emptyLedger());
    const s = setup(clearLedgerHistory(previous)); s.setRemote(previous);
    await syncLedger({ ...s, signal: new AbortController().signal, push: true });
    expect(s.remote.closedTrades).toEqual([]); expect(s.remote.deletedTradeIds).toContain('closed_one');
    expect(s.remote.closedPositionIds).toContain('one');
  });
  it('ignores a response after identity cancellation', async () => {
    const controller = new AbortController(); const wait = deferred<{ revision: number; book: Ledger }>();
    const apply = vi.fn(); const getLocal = vi.fn(emptyLedger);
    const pending = syncLedger({ transport: { read: () => wait.promise, compareAndSwap: vi.fn() }, getLocal, apply, signal: controller.signal, push: true });
    controller.abort(); wait.resolve({ revision: 1, book: { ...emptyLedger(), positions: [position('A-private')] } });
    await expect(pending).rejects.toThrow('cancelled'); expect(apply).not.toHaveBeenCalled(); expect(getLocal).not.toHaveBeenCalled();
  });
  it('caps conflict retries while retaining local work', async () => {
    const s = setup({ ...emptyLedger(), positions: [position()] }); s.transport.compareAndSwap = vi.fn(async () => false);
    await expect(syncLedger({ ...s, signal: new AbortController().signal, push: true })).rejects.toThrow('retry');
    expect(s.transport.compareAndSwap).toHaveBeenCalledTimes(5); expect(s.getLocal().positions).toHaveLength(1);
    expect(durableLedger(s.getLocal()).positions[0].currentPrice).toBe(s.getLocal().positions[0].entryPrice);
  });
});

it('binds the RPC payload to the initiating account, independently of late SDK auth changes', async () => {
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: true, error: null }) }));
  const transport = supabaseLedgerTransport({ rpc } as unknown as SupabaseClient, 'account-A');
  await transport.compareAndSwap(2, emptyLedger(), new AbortController().signal);
  expect(rpc).toHaveBeenCalledWith('save_paper_book_v2', { expected_user_id: 'account-A', expected_revision: 2, next_book: emptyLedger() });
});
it('exports more than 1,000 legacy rows with stable scoped pagination, without revaluing them', async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ({ id: String(i).padStart(6, '0'), user_id: 'A', profit: 100000 }));
  const eq = vi.fn(); const order = vi.fn(); const range = vi.fn();
  const sb = { from: (table: string) => ({ select: () => ({ eq: (column: string, user: string) => {
    eq(column, user); return { order: (column: string, options: unknown) => {
      order(column, options); return { range: (from: number, to: number) => {
        range(from, to); return { abortSignal: async () => ({ data: table === 'positions' ? rows.slice(from, to + 1) : [], error: null }) };
      } };
    } };
  } }) }) } as unknown as SupabaseClient;
  const result = await exportLegacyCloud(sb, 'A', new AbortController().signal);
  expect(result.positions).toHaveLength(1203); expect(result.positions[1202]).toEqual(rows[1202]);
  expect(eq).toHaveBeenCalledWith('user_id', 'A'); expect(order).toHaveBeenCalledWith('id', { ascending: true });
  expect(range).toHaveBeenCalledWith(1000, 1499);
});
