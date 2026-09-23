import React, { useState, useEffect, useRef } from 'react';
import { isSupabaseConfigured, requireSupabaseClient } from '../lib/supabase';
import { Database, RefreshCw, ShieldCheck, Download } from 'lucide-react';
import { useTrading } from '../context/TradingContext';
import { exportLegacyCloud, supabaseLedgerTransport, syncLedger } from '../utils/cloudLedger';
import { bookStorageKey, durableLedger } from '../utils/ledger';

function downloadJson(value: unknown, name: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const SupabaseSync: React.FC = () => {
  const { account, positions, closedTrades, bookReady, bookGeneration, storageError, legacyAvailable, importLegacy, restoreBook, getLedger, applyRemoteLedger } = useTrading();
  const session = account.session;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const epoch = ++generation.current;
    const previous = pending.current;
    previous?.abort();
    setSyncing(false); setMessage(''); setPassword('');
    return () => { generation.current = epoch + 1; pending.current?.abort(); };
  }, [account.owner, bookGeneration]);
  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    const sb = requireSupabaseClient();
    if (!sb) return;
    setLoading(true);
    try {
      const { error } = isSignUp ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setMessage(isSignUp ? 'Check your email to complete sign-up.' : 'Account connected. Its local book is separate from guest and other accounts.');
      setPassword('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Authentication failed.'); }
    finally { setLoading(false); }
  };
  const handleLogout = async () => {
    pending.current?.abort();
    const sb = requireSupabaseClient();
    if (!sb) return;
    try { const { error } = await sb.auth.signOut(); if (error) setMessage(error.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Sign-out failed.'); }
  };
  const run = async (kind: 'push' | 'pull' | 'archive') => {
    const sb = requireSupabaseClient();
    if (!session || !sb || pending.current || syncing || (kind !== 'archive' && !bookReady)) return;
    const epoch = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 30_000);
    setSyncing(true); setMessage('');
    try {
      if (kind === 'archive') {
        const archive = await exportLegacyCloud(sb, session.user.id, controller.signal);
        if (epoch !== generation.current || controller.signal.aborted) return;
        downloadJson(archive, `apexfx-legacy-cloud-${session.user.id}.json`);
        setMessage('Legacy cloud archive exported without changing or importing it. Old profit fields may be quote currency, not USD.');
      } else {
        await syncLedger({ transport: supabaseLedgerTransport(sb, session.user.id), getLocal: getLedger,
          apply: applyRemoteLedger, signal: controller.signal, push: kind === 'push' });
        if (epoch === generation.current && !controller.signal.aborted) setMessage(kind === 'push' ? 'Versioned book synced atomically.' : 'Cloud book merged into the latest local book. Local-only trades are kept.');
      }
    } catch (error) {
      if (epoch === generation.current) setMessage(controller.signal.aborted ? 'Sync cancelled or timed out; local work is retained.' : error instanceof Error ? error.message : 'Sync failed.');
    } finally {
      clearTimeout(timer);
      if (epoch === generation.current) { setSyncing(false); pending.current = null; }
    }
  };
  const button = 'rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs hover:bg-zinc-700 disabled:opacity-40';
  return <section id="supabase-sync-panel" className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/90 p-4 text-zinc-200">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><Database size={16} /> Account &amp; paper journal</h2>
    <p className="text-xs text-zinc-400"><ShieldCheck className="inline" size={13} /> {session ? session.user.email : 'Guest book'} · USD account · observed-quote simulation</p>
    <p className="text-xs text-zinc-500">Guest and each account have separate books. Sign-out hides the account book; it does not erase its local backup.</p>
    {(storageError || account.error) && <p role="alert" className="text-xs text-amber-300">{storageError || account.error}</p>}
    <button className={button} disabled={!account.owner} onClick={() => {
      try {
        const raw = account.owner ? localStorage.getItem(bookStorageKey(account.owner)) : null;
        downloadJson(bookReady ? { owner: account.owner, book: durableLedger(getLedger()) } : { owner: account.owner, raw }, 'apexfx-book-backup.json');
      } catch (error) { setMessage(String(error)); }
    }}><Download size={13} className="mr-1 inline" />Export book / raw backup</button>
    <label className={`${button} inline-block cursor-pointer`}>Restore / repair a v2 backup
      <input className="sr-only" type="file" accept="application/json,.json" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file || file.size > 8_000_000) { setMessage('Choose a JSON backup under 8 MB.'); return; }
        if (!window.confirm('Restore into this guest/account book? Confirm ownership. Valid current records/tombstones are merged, not replaced. An unreadable original is preserved before repair.')) return;
        const epoch = generation.current;
        try {
          const backup = JSON.parse(await file.text());
          if (epoch !== generation.current) return;
          restoreBook(backup); setMessage('Validated backup restored. Original corrupt data, if any, is kept under the recovery-original key.');
        } catch (error) { if (epoch === generation.current) setMessage(error instanceof Error ? error.message : 'Invalid backup.'); }
      }} />
    </label>
    <button className={button} onClick={() => {
      try { const raw = account.owner && localStorage.getItem(`${bookStorageKey(account.owner)}:recovery-original`); if (!raw) throw new Error('No saved recovery original for this book.'); downloadJson({ owner: account.owner, raw }, 'apexfx-recovery-original.json'); }
      catch (error) { setMessage(String(error)); }
    }}>Export recovery original</button>
    {legacyAvailable && <div className="space-y-2 rounded border border-amber-800 p-2 text-xs text-amber-200">
      <p>Unscoped legacy data found. Ownership cannot be inferred. Nothing is imported or uploaded automatically; JPY-cross history without historical USD conversion remains unknown.</p>
      <button className={button} onClick={() => {
        if (!window.confirm('Import unscoped legacy data into THIS book? Confirm it belongs to you. Old unlinked positions/history require manual review. Original keys will be preserved.')) return;
        try { importLegacy(); setMessage('Legacy data imported explicitly. Original keys preserved. Review unknown conversion and instrument entries before syncing.'); }
        catch (error) { setMessage(String(error)); }
      }}>Import legacy local book into {session ? 'this account' : 'guest'}</button>
      <button className={button} onClick={() => downloadJson({ positions: localStorage.getItem('forexinsight_positions'), closedTrades: localStorage.getItem('forexinsight_closed_trades') }, 'apexfx-unscoped-original.json')}>Export original legacy keys</button>
    </div>}
    {!isSupabaseConfigured ? <p className="text-xs text-zinc-500">Cloud authentication is not configured. Your guest journal still works locally.</p> : !account.ready ? <p>Loading account…</p> : !session ?
      <form onSubmit={handleAuth} className="space-y-2">
        <label className="block text-xs">Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full rounded bg-zinc-950 p-2" /></label>
        <label className="block text-xs">Password<input required minLength={isSignUp ? 8 : undefined} type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full rounded bg-zinc-950 p-2" /></label>
        <button disabled={loading} className={button} type="submit">{isSignUp ? 'Create account' : 'Sign in'}</button>
        <button type="button" className="ml-3 text-xs text-indigo-300" onClick={() => setIsSignUp(v => !v)}>{isSignUp ? 'Use existing account' : 'Create an account'}</button>
      </form> : <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button disabled={syncing || !bookReady} className={button} onClick={() => void run('push')}><RefreshCw className={`mr-1 inline ${syncing ? 'animate-spin' : ''}`} size={12} />Sync to cloud</button>
          <button disabled={syncing || !bookReady} className={button} onClick={() => void run('pull')}>Merge from cloud</button>
          <button disabled={syncing} className={button} onClick={() => void run('archive')}>Export legacy cloud tables</button>
          <button className={button} onClick={() => void handleLogout()}>Sign out</button>
        </div>
        <p className="text-[11px] text-zinc-500">{positions.length} open · {closedTrades.length} closed. Cloud v2 requires the additive SQL migration. No fallback writes to legacy tables.</p>
      </div>}
    {message && <p role="status" className="break-words text-xs text-indigo-200">{message}</p>}
  </section>;
};
