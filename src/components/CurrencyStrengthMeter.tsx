import React, { useState, useEffect } from 'react';
import { Gauge, ArrowUpRight, ArrowDownRight, Zap, RefreshCw } from 'lucide-react';
import { PAIRS_CONFIG } from '../utils/forexData';

export interface CurrencyStrengthItem {
  currency: string;
  strength: number; // 0.0 to 10.0
  bias: 'Bullish' | 'Neutral' | 'Bearish';
}

interface CurrencyStrengthMeterProps {
  onSelectPair?: (symbol: string) => void;
}

export function CurrencyStrengthMeter({ onSelectPair }: CurrencyStrengthMeterProps) {
  const [data, setData] = useState<CurrencyStrengthItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchStrength = async () => {
    try {
      const res = await fetch('/api/market/strength');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setData(json.data);
      }
    } catch (e) {
      console.warn('Failed to load currency strength:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStrength();
    const interval = setInterval(fetchStrength, 10_000);
    return () => clearInterval(interval);
  }, []);

  const strongest = data[0];
  const weakest = data[data.length - 1];

  let suggestedSymbol: string | null = null;
  let suggestedAction: 'LONG' | 'SHORT' = 'LONG';

  if (strongest && weakest && strongest.currency !== weakest.currency) {
    const direct = `${strongest.currency}${weakest.currency}`;
    const inverse = `${weakest.currency}${strongest.currency}`;
    if (PAIRS_CONFIG[direct]) {
      suggestedSymbol = direct;
      suggestedAction = 'LONG';
    } else if (PAIRS_CONFIG[inverse]) {
      suggestedSymbol = inverse;
      suggestedAction = 'SHORT';
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400">
            <Gauge className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold font-mono tracking-tight text-zinc-100 flex items-center gap-1.5">
              Live Currency Strength Matrix
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-emerald-400 font-mono">8 MAJOR CCYS</span>
            </h2>
            <p className="text-[10px] text-zinc-400 font-sans">
              Real-time relative strength calculated across cross-currency pairs
            </p>
          </div>
        </div>

        <button
          onClick={fetchStrength}
          disabled={loading}
          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          title="Refresh currency strength"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Suggested Confluence Setup Banner */}
      {suggestedSymbol && (
        <div className="bg-gradient-to-r from-emerald-950/30 via-zinc-900 to-zinc-900 border border-emerald-500/30 rounded-lg p-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="text-[10px]">
              <span className="font-bold text-emerald-300">Confluence Setup:</span>{' '}
              <span className="text-zinc-200 font-mono font-bold">
                {strongest.currency} (Strong: {strongest.strength}) vs {weakest.currency} (Weak: {weakest.strength})
              </span>
            </div>
          </div>
          <button
            onClick={() => onSelectPair && onSelectPair(suggestedSymbol!)}
            className="text-[10px] font-mono text-emerald-400 font-bold px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 hover:bg-emerald-900 hover:border-emerald-400 transition-all cursor-pointer shadow-sm flex items-center gap-1"
            title={`Switch active chart to ${suggestedSymbol.slice(0, 3)}/${suggestedSymbol.slice(3)}`}
          >
            <span>{suggestedAction} {suggestedSymbol.slice(0, 3)}/{suggestedSymbol.slice(3)}</span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Strength Bars List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {data.map((item) => {
          const pct = Math.max(5, Math.min(100, item.strength * 10));
          const isBullish = item.strength >= 6.5;
          const isBearish = item.strength <= 3.5;

          const barColor = isBullish
            ? 'bg-gradient-to-r from-emerald-600 to-emerald-400'
            : isBearish
            ? 'bg-gradient-to-r from-rose-600 to-rose-400'
            : 'bg-gradient-to-r from-amber-600 to-amber-400';

          const textColor = isBullish
            ? 'text-emerald-400'
            : isBearish
            ? 'text-rose-400'
            : 'text-amber-400';

          return (
            <div
              key={item.currency}
              className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-2 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-zinc-100 flex items-center gap-1">
                  {item.currency}
                  {isBullish && <ArrowUpRight className="w-3 h-3 text-emerald-400" />}
                  {isBearish && <ArrowDownRight className="w-3 h-3 text-rose-400" />}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-1 py-0.2 rounded font-semibold ${
                    isBullish ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30' :
                    isBearish ? 'bg-rose-950/60 text-rose-300 border border-rose-500/30' :
                    'bg-zinc-800 text-zinc-400'
                  }`}>
                    {item.bias}
                  </span>
                  <span className={`font-bold ${textColor}`}>{item.strength.toFixed(1)}</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
