import React, { useMemo, useState } from 'react';
import { ShieldCheck, Flag, TriangleAlert } from 'lucide-react';
import { useTrading } from '../context/TradingContext';
import { DEFAULT_CHALLENGE, evaluateChallenge, loadChallengeConfig, saveChallengeConfig, type ChallengeConfig } from '../utils/challenge';

/**
 * Funded-account-style self-assessment over the LOCAL paper journal only.
 * Not affiliated with, verified by, or redeemable at any prop firm; it is a
 * discipline tracker with the same rule shapes the industry publicized.
 */
const Bar = ({ label, used, limit, tone }: { label: string; used: number; limit: number; tone: 'emerald' | 'amber' | 'red' }) => {
  const pct = limit > 0 ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
  const color = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[9px] uppercase tracking-wider text-zinc-500">
        <span>{label}</span>
        <span className="font-mono text-zinc-400">{used.toFixed(1)} / {limit.toFixed(1)} %</span>
      </div>
      <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export const ChallengePanel: React.FC = () => {
  const { positions, closedTrades } = useTrading();
  const [stored, setStored] = useState(() => loadChallengeConfig() ?? { enabled: false, config: { ...DEFAULT_CHALLENGE } });
  const { enabled, config } = stored;
  const update = (patch: Partial<StoredConfig>) => setStored(prev => { const next = { ...prev, ...patch }; saveChallengeConfig(next.enabled ? next : null); return next; });
  type StoredConfig = Partial<{ enabled: boolean; config: ChallengeConfig }>;
  const evaluation = useMemo(() => enabled ? evaluateChallenge(config, { closedTrades, openPositions: positions }) : null, [enabled, config, closedTrades, positions]);

  const statusTone = evaluation?.status === 'passed' ? 'text-emerald-400 border-emerald-900/50 bg-emerald-950/30' : evaluation?.status === 'failed' ? 'text-red-400 border-red-900/50 bg-red-950/30' : 'text-amber-300 border-amber-900/40 bg-amber-950/20';

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950 p-3 space-y-2.5" data-testid="challenge-panel">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-300"><ShieldCheck className="w-4 h-4 text-emerald-400/80" /> Prop-style challenge</span>
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => update({ enabled: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-500" />
          Track rules on this journal
        </label>
      </div>
      {!enabled && <p className="text-[10px] text-zinc-500">Enable to grade the local paper book against configurable profit target, daily-loss, and drawdown rules. Self-assessment only — not affiliated with or certified by any prop firm.</p>}
      {enabled && evaluation && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${statusTone}`}>{evaluation.status}</span>
            <span className="text-[10px] text-zinc-500 font-mono">equity ${evaluation.equityUsd.toLocaleString()} · days {evaluation.daysTraded}/{evaluation.minTradingDays}{evaluation.excludedTradesWithoutUsdPnl > 0 ? ` · ${evaluation.excludedTradesWithoutUsdPnl} trade(s) excluded: USD value unavailable` : ''}</span>
          </div>
          {evaluation.failedRules.length > 0 && (
            <div className="space-y-0.5">
              {evaluation.failedRules.map(rule => <p key={rule} className="flex items-start gap-1 text-[10px] text-red-400"><TriangleAlert size={11} className="mt-0.5 shrink-0" />{rule}</p>)}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Bar label={`Profit ${evaluation.profitPct}% / target`} used={Math.max(0, evaluation.profitPct)} limit={evaluation.targetPct} tone={evaluation.profitPct >= evaluation.targetPct ? 'emerald' : 'amber'} />
            <Bar label="Daily loss used" used={evaluation.dailyLossUsedPct} limit={evaluation.dailyLossLimitPct} tone={evaluation.dailyLossUsedPct > evaluation.dailyLossLimitPct * 0.7 ? 'red' : 'emerald'} />
            <Bar label="Drawdown cushion" used={Math.max(0, evaluation.maxDrawdownPct - evaluation.drawdownBufferPct)} limit={evaluation.maxDrawdownPct} tone={evaluation.drawdownBufferPct < evaluation.maxDrawdownPct * 0.4 ? 'red' : 'emerald'} />
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[9px] uppercase text-zinc-500">
            {[['Balance base', 'startingBalanceUsd'], ['Target %', 'profitTargetPct'], ['Daily loss %', 'dailyLossPct'], ['Max DD %', 'maxDrawdownPct'], ['Min days', 'minTradingDays']].map(([label, key]) => (
              <label key={key} className="space-y-0.5">{label}
                <input type="number" min={0} step={key === 'startingBalanceUsd' ? 500 : 0.5} value={config[key as keyof ChallengeConfig] as number}
                  onChange={e => update({ config: { ...config, [key]: Math.max(key === 'startingBalanceUsd' ? 100 : 0.1, Number(e.target.value) || 0) } })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 font-mono text-[10px] text-zinc-200" />
              </label>
            ))}
            <label className="flex items-end gap-1 pb-0.5 normal-case">
              <input type="checkbox" checked={config.trailingDrawdown} onChange={e => update({ config: { ...config, trailingDrawdown: e.target.checked } })} className="w-3 h-3 accent-emerald-500" />
              <span className="text-[9px] text-zinc-500">trailing DD floor</span>
            </label>
          </div>
          <p className="text-[9px] text-zinc-600 leading-snug flex items-start gap-1"><Flag size={10} className="mt-0.5 shrink-0" /> Rules replay the realized journal chronologically (intraday breaches count), add open-position marks to today, and treat trades without a computable USD value as excluded rather than guessing. Firms' actual terms differ — read theirs.</p>
        </>
      )}
    </div>
  );
};

export default ChallengePanel;
