import React, { useCallback, useState } from 'react';
import { FlaskConical, Loader2, AlertTriangle } from 'lucide-react';
import { useTrading } from '../context/TradingContext';

interface BacktestTrade {
  side: 'BUY' | 'SELL';
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  bars: number;
}

interface BacktestResponse {
  ok: boolean;
  error?: string;
  engine?: string;
  provider?: string;
  bars?: number;
  stats?: {
    tradeCount: number;
    winCount: number;
    winRatePct: number;
    netPnlQuote: number;
    profitFactor: number | null;
    maxDrawdownQuote: number;
    maxDrawdownPct: number;
    barsInMarket: number;
  };
  trades?: BacktestTrade[];
  equityCurve?: { index: number; equity: number }[];
  disclaimer?: string;
}

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) => (
  <div className="rounded border border-zinc-800/80 bg-zinc-900/60 px-2 py-1.5">
    <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
    <div className={`font-mono text-xs font-bold ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-zinc-100'}`}>{value}</div>
  </div>
);

const EquitySparkline = ({ points }: { points: { index: number; equity: number }[] }) => {
  if (points.length < 2) return null;
  const width = 220;
  const height = 34;
  const values = points.map(p => p.equity);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * width).toFixed(1)},${(height - ((p.equity - min) / span) * height).toFixed(1)}`)
    .join(' ');
  const zero = height - ((0 - min) / span) * height;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-9" role="img" aria-label="Equity curve">
      <line x1="0" x2={width} y1={zero} y2={zero} stroke="#3f3f46" strokeDasharray="3 3" strokeWidth="0.5" />
      <path d={path} fill="none" stroke={values[values.length - 1]! >= 0 ? '#34d399' : '#f87171'} strokeWidth="1.2" />
    </svg>
  );
};

const BacktestPanel: React.FC = () => {
  const { selectedSymbol, selectedTimeframe } = useTrading();
  const [fast, setFast] = useState(12);
  const [slow, setSlow] = useState(48);
  const [lots, setLots] = useState(0.1);
  const [commission, setCommission] = useState(4);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [response, setResponse] = useState<BacktestResponse | null>(null);

  const run = useCallback(async () => {
    setStatus('loading');
    try {
      const params = new URLSearchParams({ symbol: selectedSymbol, timeframe: selectedTimeframe, fast: String(fast), slow: String(slow), lots: String(lots), commission: String(commission) });
      const res = await fetch(`/api/backtest?${params.toString()}`);
      const body: BacktestResponse = await res.json();
      setResponse(body.ok ? body : { ok: false, error: body.error || `Request failed (${res.status})` });
      setStatus('done');
    } catch {
      setResponse({ ok: false, error: 'Network error while reaching the backtest service.' });
      setStatus('done');
    }
  }, [selectedSymbol, selectedTimeframe, fast, slow, lots, commission]);

  const quoteCcy = selectedSymbol.slice(3);
  const stats = response?.stats;

  return (
    <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl shadow-lg overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between">
        <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-amber-400/80" /> Strategy lab
        </h2>
        <span className="text-[10px] text-zinc-500 font-mono">{selectedSymbol} · {selectedTimeframe} · SMA cross</span>
      </div>
      <div className="p-3 space-y-2.5">
        <div className="grid grid-cols-4 gap-1.5">
          <label className="text-[9px] uppercase text-zinc-500 space-y-0.5">Fast
            <input type="number" min={2} max={200} value={fast} onChange={e => setFast(Number(e.target.value) || 2)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 font-mono text-xs text-zinc-100" />
          </label>
          <label className="text-[9px] uppercase text-zinc-500 space-y-0.5">Slow
            <input type="number" min={5} max={400} value={slow} onChange={e => setSlow(Number(e.target.value) || 5)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 font-mono text-xs text-zinc-100" />
          </label>
          <label className="text-[9px] uppercase text-zinc-500 space-y-0.5">Lots
            <input type="number" min={0.01} step={0.01} value={lots} onChange={e => setLots(Number(e.target.value) || 0.01)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 font-mono text-xs text-zinc-100" />
          </label>
          <label className="text-[9px] uppercase text-zinc-500 space-y-0.5">Cmmt/lot
            <input type="number" min={0} step={0.5} value={commission} onChange={e => setCommission(Math.max(0, Number(e.target.value) || 0))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 font-mono text-xs text-zinc-100" />
          </label>
        </div>
        <button
          onClick={run}
          disabled={status === 'loading' || fast >= slow}
          className="w-full flex items-center justify-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 text-amber-300 text-xs font-semibold py-1.5 transition-colors"
        >
          {status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          {status === 'loading' ? 'Simulating…' : 'Run on cached real candles'}
        </button>
        {fast >= slow && <p className="text-[10px] text-amber-500/80">Fast period must be smaller than the slow period.</p>}
        {status === 'done' && response && !response.ok && (
          <p className="flex items-start gap-1.5 text-[11px] text-red-400"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{response.error}</p>
        )}
        {status === 'done' && response?.ok && stats && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Trades" value={String(stats.tradeCount)} />
              <Stat label="Win rate" value={`${stats.winRatePct}%`} />
              <Stat label={`Net P&L (${quoteCcy})`} value={`${stats.netPnlQuote >= 0 ? '+' : ''}${stats.netPnlQuote.toLocaleString()}`} tone={stats.netPnlQuote > 0 ? 'pos' : stats.netPnlQuote < 0 ? 'neg' : undefined} />
              <Stat label="Profit factor" value={stats.profitFactor === null ? '∞ (no losses)' : String(stats.profitFactor)} />
              <Stat label="Max DD" value={`${stats.maxDrawdownPct}%`} tone={stats.maxDrawdownPct > 25 ? 'neg' : undefined} />
              <Stat label="Bars in mkt" value={`${stats.barsInMarket}/${response.bars ?? 0}`} />
            </div>
            {response.equityCurve && <EquitySparkline points={response.equityCurve} />}
            {(response.trades ?? []).length > 0 && (
              <div className="text-[10px] font-mono text-zinc-500 space-y-0.5">
                {(response.trades ?? []).slice(-4).map((t, i) => (
                  <div key={`${t.entryIndex}-${i}`} className="flex justify-between">
                    <span className={t.side === 'BUY' ? 'text-emerald-500/80' : 'text-red-500/80'}>{t.side === 'BUY' ? '▲ long' : '▼ short'}</span>
                    <span>{t.exitIndex - t.entryIndex} bars</span>
                    <span className={t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.pnl >= 0 ? '+' : ''}{Math.round(t.pnl).toLocaleString()} {quoteCcy}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] text-zinc-600 leading-snug">{response.disclaimer} P&amp;L is denominated in the quote currency ({quoteCcy}). Data source: {response.provider}.</p>
          </div>
        )}
        {status === 'idle' && (
          <p className="text-[10px] text-zinc-600 leading-snug">
            Simulates a fast/slow SMA crossover on the same real weekly/intraday candles the chart uses, charging an indicative
            half-spread per side plus your commission per lot. Educational only.
          </p>
        )}
      </div>
    </div>
  );
};

export default BacktestPanel;
