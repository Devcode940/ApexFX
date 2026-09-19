import React, { useState, useEffect } from 'react';
import { isSupabaseConfigured, requireSupabaseClient } from '../lib/supabase.ts';
import { Database, Cloud, CloudOff, RefreshCw, Lock, User, Check, AlertCircle, ExternalLink, ShieldCheck } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TradePosition, ClosedTrade } from '../types';
import { mergePositions, mergeTrades, positionPips, tradePips } from '../utils/supabaseSync';

import { useTrading } from '../context/TradingContext';

/**
 * Upsert on the per-user composite key, falling back to the legacy global `id` key.
 *
 * `supabase-schema.sql` now declares PRIMARY KEY (user_id, id) so two accounts can hold the same
 * local id. Postgres rejects an `ON CONFLICT` clause that matches no constraint (SQLSTATE 42P10),
 * so a database that has not been migrated yet would otherwise stop syncing entirely — a schema
 * improvement must not be able to break the running app. The fallback keeps it working and says so.
 */
async function upsertRows(
  sb: SupabaseClient,
  table: 'positions' | 'closed_trades',
  rows: Record<string, unknown>[]
) {
  const first = await sb.from(table).upsert(rows, { onConflict: 'user_id,id' });
  const msg = String(first.error?.message ?? '');
  if (first.error && (first.error.code === '42P10' || /no unique or exclusion constraint/i.test(msg))) {
    const legacy = await sb.from(table).upsert(rows, { onConflict: 'id' });
    if (!legacy.error) {
      console.warn(
        `[ApexFX] ${table}: synced against the legacy global "id" primary key. ` +
        `Run the migration block in supabase-schema.sql for per-user keys — until then, two accounts ` +
        `using the same local id collide (the second upsert is blocked by RLS and reports a policy violation).`
      );
    }
    return legacy;
  }
  return first;
}

interface SupabaseSyncProps {}

export const SupabaseSync: React.FC<SupabaseSyncProps> = () => {
  const {
    positions,
    closedTrades,
    setPositions,
    setClosedTrades,
  } = useTrading();

  const onImportSync = (syncedPositions: TradePosition[], syncedTrades: ClosedTrade[]) => {
    setPositions(syncedPositions);
    setClosedTrades(syncedTrades);
  };
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Check current session
  useEffect(() => {
    const sb = requireSupabaseClient();
    if (!sb) return;

    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Show a message helper
  const showMsg = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = requireSupabaseClient();
    if (!sb) {
      showMsg('Supabase API keys are not configured yet.', 'error');
      return;
    }
    if (!email || !password) {
      showMsg('Please fill in all fields.', 'error');
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        showMsg('Sign-up successful! Check your email or try logging in.', 'success');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showMsg('Welcome back! Account connected successfully.', 'success');
      }
    } catch (err: any) {
      showMsg(err.message || 'Authentication failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    const sb = requireSupabaseClient();
    if (!sb) {
      showMsg('Supabase API keys are not configured yet.', 'error');
      return;
    }
    setLoading(true);
    try {
      await sb.auth.signOut();
      showMsg('Signed out of cloud account.', 'info');
    } catch (err: any) {
      showMsg(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Push local data to Supabase
  const handlePushSync = async () => {
    if (!session) return;
    const sb = requireSupabaseClient();
    if (!sb) {
      showMsg('Supabase is not configured; cannot sync.', 'error');
      return;
    }
    setSyncing(true);
    try {
      const userId = session.user.id;

      // 1. Sync active positions
      if (positions.length > 0) {
        // Map types carefully matching Supabase Schema
        const mappedPositions = positions.map(pos => ({
          id: pos.id,
          user_id: userId,
          symbol: pos.symbol,
          type: pos.type,
          entry_price: pos.entryPrice,
          lots: pos.amount,
          stop_loss: pos.sl || null,
          take_profit: pos.tp || null,
          timestamp: pos.openedAt ?? Date.now(),
          // Was a literal 0, which made the column dead data with no error anywhere.
          pips: positionPips(pos),
          profit: pos.pnl
        }));

        const { error: posErr } = await upsertRows(sb, 'positions', mappedPositions);
        if (posErr) throw posErr;
      }

      // 2. Sync closed trades
      if (closedTrades.length > 0) {
        const mappedTrades = closedTrades.map(trade => ({
          id: trade.id,
          user_id: userId,
          symbol: trade.symbol,
          type: trade.type,
          entry_price: trade.entryPrice,
          exit_price: trade.exitPrice,
          lots: trade.amount,
          profit: trade.pnl,
          // Was `* (symbol.includes('JPY') ? 100 : 10000)` inline here, which is 100x wrong for
          // gold (2-decimal instrument) and disagrees with the panel's own table for silver.
          pips: tradePips(trade),
          open_time: trade.openedAt ?? Date.now() - 3600000,
          close_time: trade.closedAt ?? Date.now(),
          close_reason: trade.closeReason
        }));

        const { error: tradeErr } = await upsertRows(sb, 'closed_trades', mappedTrades);
        if (tradeErr) throw tradeErr;
      }

      showMsg('Synced local logs to Supabase successfully!', 'success');
    } catch (err: any) {
      console.error("Sync error:", err);
      showMsg('Sync failed: ' + (err.message || 'Check database permissions or schema'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  // Pull data from Supabase
  const handlePullSync = async () => {
    if (!session) return;
    const sb = requireSupabaseClient();
    if (!sb) {
      showMsg('Supabase is not configured; cannot sync.', 'error');
      return;
    }
    setSyncing(true);
    try {
      // 1. Fetch positions
      const { data: dbPositions, error: posErr } = await sb
        .from('positions')
        .select('*');
      
      if (posErr) throw posErr;

      // 2. Fetch closed trades
      const { data: dbTrades, error: tradeErr } = await sb
        .from('closed_trades')
        .select('*');

      if (tradeErr) throw tradeErr;

      // Map back to app types
      const mappedPositions: TradePosition[] = (dbPositions || []).map(pos => ({
        id: pos.id,
        symbol: pos.symbol,
        type: pos.type as 'BUY' | 'SELL',
        entryPrice: Number(pos.entry_price),
        currentPrice: Number(pos.entry_price), // Will be updated by price feed
        amount: Number(pos.lots),
        sl: pos.stop_loss ? Number(pos.stop_loss) : undefined,
        tp: pos.take_profit ? Number(pos.take_profit) : undefined,
        pnl: Number(pos.profit || 0),
        openedAt: pos.timestamp || undefined,
        time: new Date(pos.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      }));

      const mappedTrades: ClosedTrade[] = (dbTrades || []).map(trade => ({
        id: trade.id,
        symbol: trade.symbol,
        type: trade.type as 'BUY' | 'SELL',
        entryPrice: Number(trade.entry_price),
        exitPrice: Number(trade.exit_price),
        amount: Number(trade.lots),
        pnl: Number(trade.profit),
        time: new Date(trade.close_time || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        closeReason: (trade.close_reason as ClosedTrade['closeReason']) || 'Manual',
        openedAt: trade.open_time || undefined,
        closedAt: trade.close_time || undefined
      }));

      // Merge, never replace: a pull used to `setPositions(remoteRows)`, which silently deleted any
      // local position or closed trade that had not been pushed yet (offline session, second device,
      // a trade closed after the last sync).
      const nextPositions = mergePositions(positions, mappedPositions);
      const nextTrades = mergeTrades(closedTrades, mappedTrades);
      onImportSync(nextPositions, nextTrades);
      showMsg(
        `Merged ${mappedPositions.length} position(s) and ${mappedTrades.length} trade(s) from Supabase ` +
        `(local-only rows kept: ${nextPositions.length - mappedPositions.length} position(s), ` +
        `${nextTrades.length - mappedTrades.length} trade(s)).`,
        'success'
      );
    } catch (err: any) {
      console.error("Restore error:", err);
      showMsg('Pull failed: ' + (err.message || 'Check connection'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div id="supabase-sync-panel" className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-4 space-y-4">
      {/* Title & Status */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider leading-none">
              Supabase Integration
            </h3>
            <span className="text-[9px] text-zinc-500">PostgreSQL + Cloud Auth</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isSupabaseConfigured ? (
            session ? (
              <span className="flex items-center gap-1 text-[9px] font-semibold bg-emerald-950/50 text-emerald-400 px-2 py-0.5 border border-emerald-900/50 rounded-full">
                <Cloud className="w-2.5 h-2.5" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[9px] font-semibold bg-amber-950/50 text-amber-400 px-2 py-0.5 border border-amber-900/50 rounded-full">
                <CloudOff className="w-2.5 h-2.5" /> Signed Out
              </span>
            )
          ) : (
            <span className="flex items-center gap-1 text-[9px] font-semibold bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
              Local Storage
            </span>
          )}
        </div>
      </div>

      {message && (
        <div className={`p-2.5 rounded-lg border text-[10px] leading-snug flex items-start gap-2 ${
          message.type === 'success' ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-400' :
          message.type === 'error' ? 'bg-rose-950/30 border-rose-900/40 text-rose-400' :
          'bg-indigo-950/30 border-indigo-900/40 text-indigo-400'
        }`}>
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {/* Conditional Interface */}
      {!isSupabaseConfigured ? (
        // Guide mode when API keys are not supplied in .env
        <div className="space-y-3.5">
          <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/40 space-y-2 text-[11px] leading-relaxed text-zinc-400">
            <p className="font-semibold text-zinc-200">🛠️ Step-by-Step Setup Guide</p>
            <p>You can connect your own database and deploy to Vercel instantly. We've built all schemas and configuration for you!</p>
            <ol className="list-decimal pl-4.5 space-y-1 text-zinc-400">
              <li>Create a project on <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-0.5">Supabase <ExternalLink className="w-2 h-2" /></a></li>
              <li>Go to the **SQL Editor**, paste the pre-built schema from <code className="text-zinc-300 font-mono text-[10px]">supabase-schema.sql</code>, and click **Run**.</li>
              <li>Add the credentials to your Vercel or local environment variables:</li>
            </ol>
            <div className="bg-black/40 p-2 rounded border border-zinc-800 font-mono text-[9px] text-zinc-300 space-y-1 mt-2">
              <div>VITE_SUPABASE_URL="your-supabase-url"</div>
              <div>VITE_SUPABASE_ANON_KEY="your-anon-key"</div>
            </div>
            <p className="text-[10px] text-zinc-500 pt-1">
              Once these variables are set up, the Cloud Sync panel will activate automatically!
            </p>
          </div>

          <div className="p-3 bg-indigo-950/20 border border-indigo-900/30 rounded-lg space-y-2">
            <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Ready for Vercel Deployment
            </h4>
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              We have fully configured the <code className="text-zinc-300">vercel.json</code> routing and created serverless entry points in the <code className="text-zinc-300">/api</code> directory. You can deploy this exact directory to Vercel with a single click.
            </p>
          </div>
        </div>
      ) : (
        // When configured, show login form or sync dashboards
        <div className="space-y-3">
          {!session ? (
            <form onSubmit={handleAuth} className="space-y-2.5">
              <p className="text-[10px] text-zinc-400 leading-snug">
                Log in or register with your Supabase account to sync your trades, positions, and charting drawings across devices.
              </p>
              <div>
                <input 
                  type="email" 
                  placeholder="Email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-zinc-950 text-xs text-zinc-200 border border-zinc-800 rounded px-3 py-2 outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div className="relative">
                <input 
                  type="password" 
                  placeholder="Password (min 6 chars)"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-zinc-950 text-xs text-zinc-200 border border-zinc-800 rounded px-3 py-2 outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  onClick={() => setIsSignUp(false)}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2 rounded transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-indigo-950/50"
                >
                  {loading && !isSignUp ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                  Login
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  onClick={() => setIsSignUp(true)}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs py-2 rounded transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {loading && isSignUp ? <RefreshCw className="w-3 h-3 animate-spin" /> : <User className="w-3 h-3" />}
                  Sign Up
                </button>
              </div>
            </form>
          ) : (
            // User is signed in
            <div className="space-y-3.5">
              <div className="flex items-center justify-between bg-zinc-950/60 border border-zinc-800/40 p-2.5 rounded-lg text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[10px] text-indigo-400 font-bold uppercase">
                    {session.user.email?.slice(0, 2)}
                  </div>
                  <div className="overflow-hidden">
                    <div className="text-[10px] text-zinc-400 truncate max-w-44 font-medium">{session.user.email}</div>
                    <div className="text-[8px] text-zinc-500 font-mono truncate">{session.user.id}</div>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-[9px] font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 px-2 py-1 rounded border border-rose-950/30 transition-colors cursor-pointer"
                >
                  Logout
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={handlePushSync}
                  disabled={syncing}
                  className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-lg transition-colors flex flex-col items-center gap-1 cursor-pointer shadow-lg shadow-indigo-950/30"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  <span>Sync to Cloud</span>
                </button>
                <button
                  onClick={handlePullSync}
                  disabled={syncing}
                  className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold text-xs rounded-lg transition-colors flex flex-col items-center gap-1 cursor-pointer border border-zinc-800"
                >
                  <Check className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Pull from Cloud</span>
                </button>
              </div>

              <div className="p-2.5 bg-zinc-950/30 border border-zinc-800 rounded-lg text-[10px] text-zinc-500 font-mono space-y-1">
                <div className="flex justify-between">
                  <span>Local Active Positions:</span>
                  <span className="text-zinc-300 font-bold">{positions.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Local Closed Trades:</span>
                  <span className="text-zinc-300 font-bold">{closedTrades.length}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
