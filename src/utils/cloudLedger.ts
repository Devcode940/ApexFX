import type { SupabaseClient } from '@supabase/supabase-js';
import { durableLedger, emptyLedger, mergeLedgers, parseLedger, type Ledger } from './ledger';

export interface CloudSnapshot { revision: number; book: Ledger }
export interface LedgerTransport {
  read: (signal: AbortSignal) => Promise<CloudSnapshot>;
  compareAndSwap: (revision: number, book: Ledger, signal: AbortSignal) => Promise<boolean>;
}
function checkActive(signal: AbortSignal) { if (signal.aborted) throw new Error('Sync cancelled: account changed or request timed out.'); }

/** Re-read local state after EVERY await. A successful CAS is atomic but not the end if local work continued. */
export async function syncLedger(args: {
  transport: LedgerTransport; getLocal: () => Ledger; apply: (book: Ledger) => void; signal: AbortSignal; push: boolean;
}): Promise<void> {
  const { transport, getLocal, apply, signal, push } = args;
  for (let attempt = 0; attempt < 5; attempt++) {
    checkActive(signal);
    const remote = await transport.read(signal);
    checkActive(signal);
    const merged = mergeLedgers(getLocal(), remote.book);
    apply(merged);
    if (!push) return;
    const snapshot = durableLedger(getLocal());
    const written = JSON.stringify(snapshot);
    const committed = await transport.compareAndSwap(remote.revision, snapshot, signal);
    checkActive(signal);
    if (!committed) continue;
    // apply/getLocal are generation-bound by the hook, as well as checked with this signal.
    apply(snapshot);
    if (JSON.stringify(durableLedger(getLocal())) === written) return;
  }
  throw new Error('Book changed repeatedly during sync. Your local work is kept; retry to finish syncing.');
}

export function supabaseLedgerTransport(sb: SupabaseClient, userId: string): LedgerTransport {
  return {
    async read(signal) {
      const { data, error } = await sb.from('paper_books_v2').select('revision,book').eq('user_id', userId).abortSignal(signal).maybeSingle();
      if (error) throw new Error(`Cloud book unavailable: ${error.message}. Apply supabase/migrations/20260923_paper_books.sql; legacy tables are never used as an unsafe fallback.`);
      if (!data) return { revision: 0, book: emptyLedger() };
      if (!Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('Invalid cloud revision.');
      return { revision: data.revision, book: parseLedger(data.book) };
    },
    async compareAndSwap(revision, book, signal) {
      const { data, error } = await sb.rpc('save_paper_book_v2', { expected_user_id: userId, expected_revision: revision, next_book: book }).abortSignal(signal);
      if (error) throw new Error(`Atomic cloud save failed: ${error.message}`);
      return data === true;
    },
  };
}

/** Explicit legacy export only: stable pagination, no implicit upload or ownership assumptions. */
export async function exportLegacyCloud(sb: SupabaseClient, userId: string, signal: AbortSignal) {
  const output: Record<string, unknown[]> = {};
  for (const table of ['positions', 'closed_trades'] as const) {
    const rows: unknown[] = [];
    for (let offset = 0; offset < 100_000; offset += 500) {
      checkActive(signal);
      const { data, error } = await sb.from(table).select('*').eq('user_id', userId).order('id', { ascending: true }).range(offset, offset + 499).abortSignal(signal);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 500) break;
      if (offset + 500 >= 100_000) throw new Error('Legacy export exceeds the browser limit. Use a database export instead.');
    }
    output[table] = rows;
  }
  return output;
}
