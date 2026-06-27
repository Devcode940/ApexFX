import React, { useState } from 'react';
import { Pattern } from '../types';
import { Sparkles, Eye, TrendingUp, TrendingDown, RefreshCw, Award, ShieldCheck, HelpCircle } from 'lucide-react';

import { useTrading } from '../context/TradingContext';

interface PatternPanelProps {}

export const PatternPanel: React.FC<PatternPanelProps> = React.memo(() => {
  const {
    activePatterns: patterns,
    highlightedPattern,
    setHighlightedPattern: onHighlightPattern,
  } = useTrading();
  const [filterType, setFilterType] = useState<'all' | 'profitable'>('all');
  const [sortBy, setSortBy] = useState<'chronological' | 'profitability'>('profitability');

  // Filter and Sort the patterns
  let processedPatterns = [...patterns];

  if (filterType === 'profitable') {
    // Only show patterns with winRate >= 65% or Reliability Medium/High
    processedPatterns = processedPatterns.filter(p => (p.winRate || 50) >= 65);
  }

  if (sortBy === 'profitability') {
    // Sort descending by winRate/score
    processedPatterns.sort((a, b) => (b.score || 0) - (a.score || 0));
  } else {
    // Chronological (latest first)
    processedPatterns.reverse();
  }

  // Limit visible items to 8
  const visiblePatterns = processedPatterns.slice(0, 8);

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden h-full" id="patterns_panel_component">
      {/* Header */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
            <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200">
              Profitable Patterns Scanner
            </h2>
          </div>
          <span className="text-[9px] bg-emerald-950/50 text-emerald-400 font-mono px-2 py-0.5 rounded border border-emerald-900/30 font-bold uppercase tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
            Auto Scanning
          </span>
        </div>

        {/* Filter & Sort Controls */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex bg-zinc-950 rounded p-0.5 border border-zinc-800 text-[10px] font-mono">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                filterType === 'all'
                  ? 'bg-zinc-800 text-zinc-100 font-bold'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              All ({patterns.length})
            </button>
            <button
              onClick={() => setFilterType('profitable')}
              className={`px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                filterType === 'profitable'
                  ? 'bg-emerald-950/65 text-emerald-400 font-bold border border-emerald-900/40'
                  : 'text-zinc-500 hover:text-emerald-500'
              }`}
            >
              High Probability ({patterns.filter(p => (p.winRate || 0) >= 65).length})
            </button>
          </div>

          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-zinc-500">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-zinc-700 text-[10px]"
            >
              <option value="profitability">Win Rate %</option>
              <option value="chronological">Recent</option>
            </select>
          </div>
        </div>
      </div>

      {/* Body List */}
      <div className="p-4 flex-1 overflow-y-auto space-y-3">
        {visiblePatterns.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-10 space-y-2">
            <div className="p-3 bg-zinc-900 rounded-full text-zinc-600">
              <RefreshCw className="w-6 h-6 animate-spin" style={{ animationDuration: '3s' }} />
            </div>
            <p className="text-zinc-500 text-xs font-mono max-w-xs leading-relaxed">
              {filterType === 'profitable'
                ? 'No high-probability setups scanned in this historical range. Lower filter thresholds to scan all.'
                : 'Analyzing historical candlesticks... Scanning current active market ranges for profitable triggers.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
              Scanned Active Segment (Showing top {visiblePatterns.length})
            </p>

            <div className="space-y-3">
              {visiblePatterns.map((pat) => {
                const isSelected = highlightedPattern && highlightedPattern.id === pat.id;
                const isBullish = pat.type === 'bullish';
                const isBearish = pat.type === 'bearish';

                let sentimentBadge = 'bg-zinc-900 text-zinc-400';
                if (isBullish) sentimentBadge = 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30';
                if (isBearish) sentimentBadge = 'bg-rose-950/40 text-rose-400 border border-rose-900/30';

                const winRate = pat.winRate || 50;
                const profitFactor = pat.profitFactor || 1.1;
                const reliability = pat.reliability || 'Low';

                let reliabilityColor = 'text-zinc-400 border-zinc-800 bg-zinc-900/40';
                if (reliability === 'High') reliabilityColor = 'text-emerald-400 border-emerald-900/40 bg-emerald-950/20';
                if (reliability === 'Medium') reliabilityColor = 'text-amber-400 border-amber-900/40 bg-amber-950/20';

                return (
                  <div
                    key={pat.id}
                    className={`p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-zinc-900/95 border-emerald-500 shadow-lg shadow-emerald-950/10'
                        : 'bg-zinc-900/20 border-zinc-800/80 hover:border-zinc-700/60'
                    }`}
                  >
                    {/* Top row: Name, type badge and visual accuracy score */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-display font-bold text-xs text-zinc-100 flex items-center gap-1">
                            {winRate >= 75 && <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                            {pat.name}
                          </span>
                          <span className={`text-[8px] uppercase font-bold px-1.5 py-0.5 rounded leading-none ${sentimentBadge}`}>
                            {pat.type}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-normal font-sans pr-2">
                          {pat.description}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {/* Eye visual highlight button */}
                        <button
                          onClick={() => onHighlightPattern(isSelected ? null : pat)}
                          className={`p-1.5 rounded transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-600 text-white hover:bg-emerald-500 font-medium'
                              : 'bg-zinc-950 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-zinc-800'
                          }`}
                          title={isSelected ? 'Clear visual highlight' : 'Highlight target candle on chart'}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Performance Auto-Evaluator metrics block */}
                    <div className="grid grid-cols-3 gap-1.5 bg-zinc-950/60 p-2 rounded-lg border border-zinc-900 text-center font-mono my-2">
                      <div className="flex flex-col justify-center border-r border-zinc-900">
                        <span className="text-[8px] text-zinc-500 uppercase leading-none">Est. Win Rate</span>
                        <span className={`text-xs font-extrabold mt-0.5 ${
                          winRate >= 72 ? 'text-emerald-400' : winRate >= 64 ? 'text-amber-400' : 'text-zinc-400'
                        }`}>
                          {winRate}%
                        </span>
                      </div>
                      <div className="flex flex-col justify-center border-r border-zinc-900">
                        <span className="text-[8px] text-zinc-500 uppercase leading-none">Profit Factor</span>
                        <span className="text-xs font-bold text-zinc-300 mt-0.5">
                          {profitFactor.toFixed(2)}x
                        </span>
                      </div>
                      <div className="flex flex-col justify-center">
                        <span className="text-[8px] text-zinc-500 uppercase leading-none">Reliability</span>
                        <span className={`text-[9px] font-bold uppercase mt-0.5 tracking-wider px-1 py-0.2 rounded ${reliabilityColor}`}>
                          {reliability}
                        </span>
                      </div>
                    </div>

                    {/* Indicator Confirmations lists */}
                    {pat.indicatorsConfirm && pat.indicatorsConfirm.length > 0 && (
                      <div className="mt-2.5 space-y-1">
                        <div className="text-[8px] text-zinc-500 font-mono uppercase tracking-wider flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-emerald-500" />
                          Auto Confluence Confirmations
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {pat.indicatorsConfirm.map((factor, index) => (
                            <span 
                              key={index}
                              className="text-[8px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded-md leading-none flex items-center gap-0.5"
                            >
                              <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block" />
                              {factor}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Footer line with coordinates */}
                    <div className="flex justify-between items-center text-[9px] text-zinc-500 font-mono mt-2.5 border-t border-zinc-800/40 pt-2">
                      <span>Candle Index: #{pat.candlestickIndex}</span>
                      <span>UTC Stamp: {pat.time}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Quick educational guide */}
      <div className="p-3 bg-zinc-900/45 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono flex items-center justify-between">
        <span>Confluence Scan: active</span>
        <span>Min threshold: 50% WR</span>
      </div>
    </div>
  );
});
