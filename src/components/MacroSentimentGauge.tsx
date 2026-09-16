import React, { useState, useEffect } from 'react';
import { Landmark, TrendingUp, ShieldAlert, Percent, RefreshCw } from 'lucide-react';

interface CentralBankRate {
  currency: string;
  centralBank: string;
  rate: number;
  lastUpdated: string;
}

interface MacroData {
  rates: Record<string, CentralBankRate>;
  sentiment: {
    score: number;
    classification: string;
    marketBias: string;
  };
  differentials: Record<string, number>;
  activePairDifferential: {
    baseRate: number;
    quoteRate: number;
    spread: number;
  };
}

interface MacroSentimentGaugeProps {
  selectedSymbol: string;
}

export function MacroSentimentGauge({ selectedSymbol }: MacroSentimentGaugeProps) {
  const [data, setData] = useState<MacroData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchMacro = async () => {
    try {
      const res = await fetch(`/api/market/macro?symbol=${selectedSymbol}`);
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      }
    } catch (e) {
      console.warn('Failed to load macro sentiment:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMacro();
    const interval = setInterval(fetchMacro, 60_000);
    return () => clearInterval(interval);
  }, [selectedSymbol]);

  if (!data) return null;

  const base = selectedSymbol.slice(0, 3);
  const quote = selectedSymbol.slice(3, 6);
  const diff = data.activePairDifferential;

  const sentimentColor = data.sentiment.score > 55
    ? 'text-emerald-400'
    : data.sentiment.score < 45
    ? 'text-rose-400'
    : 'text-amber-400';

  const spreadColor = diff.spread > 0
    ? 'text-emerald-400'
    : diff.spread < 0
    ? 'text-rose-400'
    : 'text-zinc-200';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400">
            <Landmark className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold font-mono tracking-tight text-zinc-100 flex items-center gap-1.5">
              Macro Sentiment & Rate Differentials
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-emerald-400 font-mono">CENTRAL BANKS</span>
            </h2>
            <p className="text-[10px] text-zinc-400 font-sans">
              Benchmark monetary policy rates & global risk-on/off posture
            </p>
          </div>
        </div>

        <button
          onClick={fetchMacro}
          disabled={loading}
          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          title="Refresh macro data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 2-Column Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Card 1: Active Pair Carry Trade Yield Differential */}
        <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mb-1">
            <span className="uppercase">Carry Trade Yield Spread</span>
            <Percent className="w-3.5 h-3.5 text-zinc-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-mono font-bold text-zinc-200">{base} vs {quote}</span>
            <span className={`text-base font-mono font-extrabold ${spreadColor}`}>
              {diff.spread > 0 ? `+${diff.spread}%` : `${diff.spread}%`}
            </span>
          </div>
          <div className="mt-2 text-[10px] text-zinc-400 flex items-center justify-between border-t border-zinc-800/60 pt-1.5">
            <span>{base} Rate: <strong className="text-zinc-200">{diff.baseRate}%</strong></span>
            <span>{quote} Rate: <strong className="text-zinc-200">{diff.quoteRate}%</strong></span>
          </div>
        </div>

        {/* Card 2: Global Risk Appetite (Alternative.me Index) */}
        <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mb-1">
            <span className="uppercase">Risk-On / Risk-Off Bias</span>
            <ShieldAlert className="w-3.5 h-3.5 text-zinc-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className={`text-xs font-mono font-bold ${sentimentColor}`}>
              {data.sentiment.classification}
            </span>
            <span className={`text-base font-mono font-extrabold ${sentimentColor}`}>
              {data.sentiment.score}/100
            </span>
          </div>
          <div className="mt-2 text-[10px] text-zinc-400 border-t border-zinc-800/60 pt-1.5">
            Posture: <strong className="text-zinc-200">{data.sentiment.marketBias}</strong>
          </div>
        </div>
      </div>

      {/* Central Bank Policy Rate Grid */}
      <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-2.5">
        <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 block mb-2 font-bold">
          Global Benchmark Policy Rates
        </span>
        <div className="grid grid-cols-4 gap-2 text-center font-mono">
          {Object.values(data.rates).map((cb) => (
            <div key={cb.currency} className="bg-zinc-900/60 rounded p-1.5 border border-zinc-800/50">
              <span className="text-[10px] font-bold text-zinc-300 block">{cb.currency}</span>
              <span className="text-xs font-extrabold text-emerald-400">{cb.rate.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
