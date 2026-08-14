import React from 'react';
import { Trash2, Layers, AlignJustify, ArrowUpRight, ArrowDownRight, Sparkles, Eye } from 'lucide-react';
import type { Pattern } from '../../types';
import type { ChartTheme, DrawingsState } from '../../types/chart';
import { PAIRS_CONFIG } from '../../utils/forexData';
import { resolveHorizontalLine } from '../../utils/chart/drawingTools';

interface DrawingsManagerProps {
  theme: ChartTheme;
  symbol: string;
  drawings: DrawingsState;
  setDrawings: React.Dispatch<React.SetStateAction<DrawingsState>>;
  patterns: Pattern[];
  visibleChartPatterns: Pattern[];
  highlightedPattern: Pattern | null;
  setHighlightedPattern: (pattern: Pattern | null) => void;
  showPatternMarkers: boolean;
  setShowPatternMarkers: (visible: boolean) => void;
  onClose: () => void;
}

const listRowClass = (theme: ChartTheme) =>
  `flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`;

export const DrawingsManager: React.FC<DrawingsManagerProps> = ({
  theme,
  symbol,
  drawings,
  setDrawings,
  patterns,
  visibleChartPatterns,
  highlightedPattern,
  setHighlightedPattern,
  showPatternMarkers,
  setShowPatternMarkers,
  onClose,
}) => {
  const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
  const precision = config.pipDecimal + 1;

  return (
    <div className={`w-60 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/80 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'} border rounded-lg p-3 flex flex-col gap-3 shrink-0 h-full overflow-y-auto shadow-2xl animate-fade-in`}>
      <div className={`flex items-center justify-between border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'} pb-2`}>
        <span className={`text-[11px] font-mono font-bold ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} uppercase tracking-wider flex items-center gap-1.5`}>
          <Layers className="w-3.5 h-3.5 text-emerald-400" />
          Drawing Layers
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-xs font-bold px-1"
        >
          ✕
        </button>
      </div>

      {/* Horizontal Lines List */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
          Support &amp; Resistance ({drawings.horizontalLines.length})
        </div>
        {drawings.horizontalLines.length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic px-1">No horizontal lines</div>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {drawings.horizontalLines.map((item, idx) => {
              const { price, color } = resolveHorizontalLine(item);
              return (
                <div key={idx} className={listRowClass(theme)}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className={theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}>{price.toFixed(precision)}</span>
                  </div>
                  <button
                    onClick={() => {
                      setDrawings((prev) => ({
                        ...prev,
                        horizontalLines: prev.horizontalLines.filter((_, i) => i !== idx),
                      }));
                    }}
                    className="text-zinc-500 hover:text-red-400 p-0.5"
                    title="Delete line"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Trendlines List */}
      <div className="space-y-1.5 mt-2">
        <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
          Trendlines ({drawings.trendlines.length})
        </div>
        {drawings.trendlines.length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic px-1">No trendlines</div>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {drawings.trendlines.map((tl, idx) => {
              const color = tl.color || '#eab308';
              return (
                <div key={idx} className={listRowClass(theme)}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className={theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}>TL #{idx + 1} ({Math.abs(tl.end.price - tl.start.price).toFixed(precision)})</span>
                  </div>
                  <button
                    onClick={() => {
                      setDrawings((prev) => ({
                        ...prev,
                        trendlines: prev.trendlines.filter((_, i) => i !== idx),
                      }));
                    }}
                    className="text-zinc-500 hover:text-red-400 p-0.5"
                    title="Delete trendline"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Annotations List */}
      <div className="space-y-1.5 mt-2">
        <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
          Labels &amp; Notes ({drawings.annotations.length})
        </div>
        {drawings.annotations.length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic px-1">No custom notes</div>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {drawings.annotations.map((ann, idx) => {
              const color = ann.color || '#a855f7';
              return (
                <div key={idx} className={listRowClass(theme)}>
                  <div className="flex items-center gap-1.5 min-w-0 max-w-[80%]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} truncate`} title={ann.text}>{ann.text}</span>
                  </div>
                  <button
                    onClick={() => {
                      setDrawings((prev) => ({
                        ...prev,
                        annotations: prev.annotations.filter((_, i) => i !== idx),
                      }));
                    }}
                    className="text-zinc-500 hover:text-red-400 p-0.5"
                    title="Delete label"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Risk/Reward Tools List */}
      <div className="space-y-1.5 mt-2">
        <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
          Long/Short Tools ({(drawings.riskRewards || []).length})
        </div>
        {(drawings.riskRewards || []).length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic px-1">No setups</div>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {drawings.riskRewards.map((tool) => {
              return (
                <div key={tool.id} className={listRowClass(theme)}>
                  <div className="flex items-center gap-1.5">
                    {tool.type === 'long' ? <ArrowUpRight className="w-3 h-3 text-emerald-400" /> : <ArrowDownRight className="w-3 h-3 text-red-400" />}
                    <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} capitalize`}>{tool.type} @ {tool.entry.price.toFixed(precision)}</span>
                  </div>
                  <button
                    onClick={() => {
                      setDrawings((prev) => ({
                        ...prev,
                        riskRewards: prev.riskRewards.filter((t) => t.id !== tool.id),
                      }));
                    }}
                    className="text-zinc-500 hover:text-red-400 p-0.5"
                    title="Delete tool"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fibonacci List */}
      <div className="space-y-1.5 mt-2">
        <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
          Fibonacci ({(drawings.fibonacci || []).length})
        </div>
        {(drawings.fibonacci || []).length === 0 ? (
          <div className="text-[10px] text-zinc-600 italic px-1">No fibs</div>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {drawings.fibonacci.map((tool) => {
              return (
                <div key={tool.id} className={listRowClass(theme)}>
                  <div className="flex items-center gap-1.5">
                    <AlignJustify className="w-3 h-3 text-blue-400" />
                    <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} capitalize`}>Fib @ {tool.start.price.toFixed(precision)}</span>
                  </div>
                  <button
                    onClick={() => {
                      setDrawings((prev) => ({
                        ...prev,
                        fibonacci: prev.fibonacci.filter((t) => t.id !== tool.id),
                      }));
                    }}
                    className="text-zinc-500 hover:text-red-400 p-0.5"
                    title="Delete tool"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pattern Markers Layer Section */}
      <div className={`space-y-2 mt-3 pt-2.5 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase text-zinc-400 font-bold tracking-wider flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            Pattern Layer ({visibleChartPatterns.length})
          </div>
          <button
            type="button"
            onClick={() => setShowPatternMarkers(!showPatternMarkers)}
            className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded cursor-pointer ${
              showPatternMarkers
                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-900/50'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {showPatternMarkers ? 'VISIBLE' : 'HIDDEN'}
          </button>
        </div>

        {showPatternMarkers && (
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {patterns.length === 0 ? (
              <div className="text-[10px] text-zinc-600 italic px-1">No historical patterns detected</div>
            ) : (
              patterns.map((pat) => {
                const isHighlighted = highlightedPattern && highlightedPattern.id === pat.id;
                const isBullish = pat.type === 'bullish';
                return (
                  <div
                    key={pat.id}
                    className={`flex items-center justify-between border rounded px-2 py-1 text-[10px] font-mono transition-all ${
                      isHighlighted
                        ? 'bg-emerald-950/50 border-emerald-500 text-emerald-300 shadow-sm'
                        : (theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:border-zinc-300')
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate pr-1">
                      <span className={isBullish ? 'text-emerald-400' : 'text-rose-400'}>
                        {isBullish ? '▲' : '▼'}
                      </span>
                      <span className="truncate">{pat.name}</span>
                      {pat.winRate && (
                        <span className="text-[9px] text-zinc-500 font-bold">
                          {pat.winRate}%
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setHighlightedPattern(isHighlighted ? null : pat)}
                      className={`p-1 rounded cursor-pointer ${
                        isHighlighted ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-200'
                      }`}
                      title="Highlight and focus pattern on chart"
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
