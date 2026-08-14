import React from 'react';
import { motion } from 'motion/react';
import {
  LineChart,
  TrendingUp,
  Activity,
  Ruler,
  MousePointer,
  Minus,
  Type,
  ArrowUpRight,
  ArrowDownRight,
  AlignJustify,
  Trash2,
  Camera,
  Expand,
  Sun,
  Moon,
  Eye,
  EyeOff,
  Layers,
} from 'lucide-react';
import type { Pattern, TechnicalIndicatorsState, Timeframe } from '../../types';
import {
  FOREX_SESSIONS,
  ForexSessionKey,
  getSessionLocalHoursString,
  getLocalTimezoneName,
} from '../../utils/forexSessions';
import type {
  AnimTradeFilter,
  ChartTheme,
  DrawingsState,
  DrawingTool,
  PatternMarkerFilter,
  SidebarTab,
} from '../../types/chart';
import { PAIRS_CONFIG } from '../../utils/forexData';
import { resolveHorizontalLine } from '../../utils/chart/drawingTools';

interface IndicatorDef {
  key: keyof TechnicalIndicatorsState;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  activeColor: string;
}

interface ChartSidebarProps {
  theme: ChartTheme;
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  onClose: () => void;
  symbol: string;
  indicators: TechnicalIndicatorsState;
  onToggleIndicator: (key: keyof TechnicalIndicatorsState) => void;
  patterns: Pattern[];
  visibleChartPatterns: Pattern[];
  highlightedPattern: Pattern | null;
  setHighlightedPattern: (pattern: Pattern | null) => void;
  showPatternMarkers: boolean;
  setShowPatternMarkers: (visible: boolean) => void;
  patternMarkerFilter: PatternMarkerFilter;
  setPatternMarkerFilter: (filter: PatternMarkerFilter) => void;
  enabledSessions: Record<ForexSessionKey, boolean>;
  onToggleSession: (key: ForexSessionKey) => void;
  showSessionShading: boolean;
  setShowSessionShading: (visible: boolean) => void;
  drawings: DrawingsState;
  setDrawings: React.Dispatch<React.SetStateAction<DrawingsState>>;
  activeTool: DrawingTool;
  setActiveTool: (tool: DrawingTool) => void;
  selectedColor: string;
  setSelectedColor: (color: string) => void;
  onClearDrawings: () => void;
  showTradeAnimations: boolean;
  setShowTradeAnimations: (visible: boolean) => void;
  showPatternBeams: boolean;
  setShowPatternBeams: (visible: boolean) => void;
  animTradeFilter: AnimTradeFilter;
  setAnimTradeFilter: (filter: AnimTradeFilter) => void;
  timeframe: Timeframe;
  setSelectedTimeframe: (tf: Timeframe) => void;
  isExpandedFullScreen: boolean;
  setIsExpandedFullScreen: (expanded: boolean) => void;
  onFitContent: () => void;
  onSnapshot: () => void;
}

const INDICATORS: IndicatorDef[] = [
  { key: 'sma', label: 'SMA (20)', desc: 'Simple Moving Average', icon: <LineChart className="w-3.5 h-3.5" />, color: '#3b82f6', activeColor: 'text-blue-400' },
  { key: 'ema', label: 'EMA (50)', desc: 'Exponential Moving Average', icon: <LineChart className="w-3.5 h-3.5" />, color: '#eab308', activeColor: 'text-yellow-400' },
  { key: 'rsi', label: 'RSI (14)', desc: 'Relative Strength Index', icon: <Activity className="w-3.5 h-3.5" />, color: '#f43f5e', activeColor: 'text-rose-400' },
  { key: 'macd', label: 'MACD (12, 26, 9)', desc: 'Moving Average Convergence Divergence', icon: <Activity className="w-3.5 h-3.5" />, color: '#3b82f6', activeColor: 'text-blue-400' },
  { key: 'bollinger', label: 'Bollinger Bands (20, 2)', desc: 'Volatility Bands', icon: <Activity className="w-3.5 h-3.5" />, color: '#a855f7', activeColor: 'text-purple-400' },
  { key: 'fibonacci', label: 'Fibonacci Levels', desc: 'Auto Retracement Levels', icon: <AlignJustify className="w-3.5 h-3.5" />, color: '#94a3b8', activeColor: 'text-slate-400' },
];

const ACTIVE_TOOLS: { tool: DrawingTool; label: string; icon: React.ReactNode; color: string }[] = [
  { tool: 'none', label: 'Selection', icon: <MousePointer className="w-4 h-4" />, color: 'text-zinc-400' },
  { tool: 'horizontal', label: 'Horizontal Line', icon: <Minus className="w-4 h-4" />, color: 'text-indigo-400' },
  { tool: 'trendline_start', label: 'Trendline', icon: <TrendingUp className="w-4 h-4" />, color: 'text-emerald-400' },
  { tool: 'annotation', label: 'Text Label', icon: <Type className="w-4 h-4" />, color: 'text-amber-400' },
  { tool: 'rr_long', label: 'Long Setup', icon: <ArrowUpRight className="w-4 h-4" />, color: 'text-emerald-400' },
  { tool: 'rr_short', label: 'Short Setup', icon: <ArrowDownRight className="w-4 h-4" />, color: 'text-red-400' },
  { tool: 'fib_start', label: 'Fibonacci', icon: <AlignJustify className="w-4 h-4" />, color: 'text-blue-400' },
];

const DRAWING_COLORS = ['#eab308', '#22c55e', '#f43f5e', '#3b82f6', '#a855f7'];

const PATTERN_FILTERS: { id: PatternMarkerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bullish', label: 'Bullish' },
  { id: 'bearish', label: 'Bearish' },
  { id: 'high_winrate', label: 'High Win%' },
];

const ANIM_FILTERS: { id: AnimTradeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];

const tabButtonClass = (active: boolean, theme: ChartTheme) =>
  `px-2 py-1.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider transition-all cursor-pointer flex-1 text-center ${
    active
      ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 shadow-sm'
      : (theme === 'dark' ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border border-transparent' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 border border-transparent')
  }`;

export const ChartSidebar: React.FC<ChartSidebarProps> = (props) => {
  const {
    theme,
    sidebarTab,
    setSidebarTab,
    onClose,
    symbol,
    indicators,
    onToggleIndicator,
    patterns,
    visibleChartPatterns,
    highlightedPattern,
    setHighlightedPattern,
    showPatternMarkers,
    setShowPatternMarkers,
    patternMarkerFilter,
    setPatternMarkerFilter,
    enabledSessions,
    onToggleSession,
    showSessionShading,
    setShowSessionShading,
    drawings,
    setDrawings,
    activeTool,
    setActiveTool,
    selectedColor,
    setSelectedColor,
    onClearDrawings,
    showTradeAnimations,
    setShowTradeAnimations,
    showPatternBeams,
    setShowPatternBeams,
    animTradeFilter,
    setAnimTradeFilter,
    timeframe,
    setSelectedTimeframe,
    isExpandedFullScreen,
    setIsExpandedFullScreen,
    onFitContent,
    onSnapshot,
  } = props;

  const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
  const precision = config.pipDecimal + 1;

  const rowClass = `${theme === 'dark' ? 'bg-zinc-950/50 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`;

  return (
    <motion.aside
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className={`w-64 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/80 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'} border rounded-lg p-2.5 flex flex-col gap-2.5 shrink-0 h-full overflow-y-auto shadow-2xl`}
    >
      {/* Sidebar Header */}
      <div className={`flex items-center justify-between border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'} pb-2`}>
        <span className={`text-[11px] font-mono font-bold ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} uppercase tracking-wider flex items-center gap-1.5`}>
          <Layers className="w-3.5 h-3.5 text-emerald-400" />
          Chart Controls
        </span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs font-bold px-1">✕</button>
      </div>

      {/* Sidebar Tabs */}
      <div className={`flex gap-1 p-0.5 ${theme === 'dark' ? 'bg-zinc-950/50 border-zinc-800/50' : 'bg-zinc-50 border-zinc-200'} rounded-md border`}>
        <button type="button" onClick={() => setSidebarTab('indicators')} className={tabButtonClass(sidebarTab === 'indicators', theme)}>Indicators</button>
        <button type="button" onClick={() => setSidebarTab('patterns_sessions')} className={tabButtonClass(sidebarTab === 'patterns_sessions', theme)}>Patterns</button>
        <button type="button" onClick={() => setSidebarTab('drawings')} className={tabButtonClass(sidebarTab === 'drawings', theme)}>Drawings</button>
        <button type="button" onClick={() => setSidebarTab('view_anims')} className={tabButtonClass(sidebarTab === 'view_anims', theme)}>View</button>
      </div>

      {/* TAB 1: Indicators */}
      {sidebarTab === 'indicators' && (
        <div className="flex flex-col gap-1.5">
          {INDICATORS.map((ind) => {
            const active = indicators[ind.key];
            return (
              <button
                key={ind.key}
                type="button"
                onClick={() => onToggleIndicator(ind.key)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-left transition-all cursor-pointer ${
                  active
                    ? (theme === 'dark' ? 'bg-emerald-950/40 border-emerald-800/50' : 'bg-emerald-50 border-emerald-300')
                    : (theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300')
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${active ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: ind.color }}
                />
                <span
                  className={`text-xs font-mono font-semibold ${active ? ind.activeColor : (theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}`}
                >
                  {ind.label}
                </span>
                <span className="ml-auto text-[9px] text-zinc-500">{active ? 'ON' : 'OFF'}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* TAB 2: Patterns & Sessions */}
      {sidebarTab === 'patterns_sessions' && (
        <div className="flex flex-col gap-3">
          {/* Pattern Layer Controls */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Pattern Markers</span>
              <button
                type="button"
                onClick={() => setShowPatternMarkers(!showPatternMarkers)}
                className={`flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded cursor-pointer border ${
                  showPatternMarkers
                    ? (theme === 'dark' ? 'bg-emerald-950/70 text-emerald-400 border-emerald-900/50' : 'bg-emerald-100 text-emerald-700 border-emerald-300')
                    : (theme === 'dark' ? 'bg-zinc-800 text-zinc-400 border-zinc-700' : 'bg-zinc-100 text-zinc-500 border-zinc-300')
                }`}
              >
                {showPatternMarkers ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                {showPatternMarkers ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="flex gap-1">
              {PATTERN_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPatternMarkerFilter(f.id)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold cursor-pointer border transition-all flex-1 ${
                    patternMarkerFilter === f.id
                      ? (theme === 'dark' ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' : 'bg-emerald-100 text-emerald-700 border-emerald-300')
                      : (theme === 'dark' ? 'bg-zinc-950/50 text-zinc-500 border-zinc-800/50 hover:border-zinc-700' : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-zinc-300')
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className={`max-h-40 overflow-y-auto space-y-1 mt-1 pr-0.5`}>
              {visibleChartPatterns.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No patterns detected on this timeframe</div>
              ) : (
                visibleChartPatterns.map((pat) => {
                  const isHighlighted = highlightedPattern && highlightedPattern.id === pat.id;
                  const isBullish = pat.type === 'bullish';
                  return (
                    <div
                      key={pat.id}
                      className={`flex items-center justify-between ${rowClass} transition-all cursor-pointer hover:border-zinc-600 ${
                        isHighlighted ? (theme === 'dark' ? '!bg-emerald-950/50 !border-emerald-500 !text-emerald-300' : '!bg-emerald-50 !border-emerald-400 !text-emerald-800') : ''
                      }`}
                      onClick={() => setHighlightedPattern(isHighlighted ? null : pat)}
                      title={isHighlighted ? 'Click to unhighlight pattern' : 'Click to highlight pattern on chart'}
                    >
                      <div className="flex items-center gap-1.5 truncate pr-1">
                        <span className={isBullish ? 'text-emerald-400' : 'text-rose-400'}>
                          {isBullish ? '▲' : '▼'}
                        </span>
                        <span className="truncate">{pat.name}</span>
                        {pat.winRate && <span className="text-[9px] text-zinc-500 font-bold">{pat.winRate}%</span>}
                      </div>
                      {isHighlighted && <span className="text-emerald-400 text-[9px]">⭐</span>}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'}`} />

          {/* Session Overlay Controls */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Session Overlay</span>
              <button
                type="button"
                onClick={() => setShowSessionShading(!showSessionShading)}
                className={`flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded cursor-pointer border ${
                  showSessionShading
                    ? (theme === 'dark' ? 'bg-indigo-950/70 text-indigo-300 border-indigo-900/60' : 'bg-indigo-100 text-indigo-700 border-indigo-300')
                    : (theme === 'dark' ? 'bg-zinc-800 text-zinc-400 border-zinc-700' : 'bg-zinc-100 text-zinc-500 border-zinc-300')
                }`}
              >
                {showSessionShading ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="flex flex-wrap gap-1">
              {FOREX_SESSIONS.map((sess) => {
                const active = enabledSessions[sess.key];
                return (
                  <button
                    key={sess.key}
                    type="button"
                    onClick={() => onToggleSession(sess.key)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold cursor-pointer border transition-all ${
                      active
                        ? (theme === 'dark' ? 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60' : 'bg-indigo-100 text-indigo-700 border-indigo-300')
                        : (theme === 'dark' ? 'bg-zinc-950/50 text-zinc-500 border-zinc-800/50 hover:border-zinc-700' : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-zinc-300')
                    }`}
                    title={`${sess.name} (${getSessionLocalHoursString(sess)} ${getLocalTimezoneName()})`}
                  >
                    {sess.flag} {sess.city}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Patterns Available List (all historical, for reference) */}
          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'}`} />
          <div className="flex flex-col gap-1">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>
              Detected Patterns ({patterns.length})
            </span>
            {patterns.length === 0 && <div className="text-[10px] text-zinc-600 italic px-1">None on current view</div>}
          </div>
        </div>
      )}

      {/* TAB 3: Drawing Tools */}
      {sidebarTab === 'drawings' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Active Tool</span>
              <span className={`text-[9px] font-mono ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'}`}>Double-click chart = Auto Fit</span>
            </div>

            <div className="grid grid-cols-3 gap-1">
              {ACTIVE_TOOLS.map((item) => (
                <button
                  key={item.tool}
                  type="button"
                  onClick={() => setActiveTool(item.tool)}
                  className={`flex flex-col items-center gap-1 px-1 py-1.5 rounded-md border text-[8.5px] font-mono font-bold transition-all cursor-pointer ${
                    activeTool === item.tool
                      ? (theme === 'dark' ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/70 shadow-sm' : 'bg-emerald-100 text-emerald-700 border-emerald-300 shadow-sm')
                      : (theme === 'dark' ? 'bg-zinc-950/50 text-zinc-400 border-zinc-800/50 hover:border-zinc-600' : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-zinc-300')
                  }`}
                >
                  <span className={activeTool === item.tool ? 'text-emerald-400' : item.color}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 mt-1">
              <span className={`text-[9px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'}`}>Color:</span>
              {DRAWING_COLORS.map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => setSelectedColor(col)}
                  className={`w-3.5 h-3.5 rounded-full border transition-all cursor-pointer ${
                    selectedColor === col ? 'border-white scale-125 shadow-md' : 'border-transparent hover:scale-110'
                  }`}
                  style={{ backgroundColor: col }}
                  title={`Use drawing color ${col}`}
                />
              ))}
            </div>
          </div>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'}`} />

          {/* Layers Summary */}
          <div className="flex flex-col gap-1.5">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Active Layers</span>
            <div className="space-y-1">
              <div className={`${rowClass} flex items-center justify-between`}>
                <span className="flex items-center gap-1.5"><Minus className="w-3 h-3 text-indigo-400" /> Support/Resistance</span>
                <span className="text-zinc-500">{drawings.horizontalLines.length}</span>
              </div>
              <div className={`${rowClass} flex items-center justify-between`}>
                <span className="flex items-center gap-1.5"><TrendingUp className="w-3 h-3 text-emerald-400" /> Trendlines</span>
                <span className="text-zinc-500">{drawings.trendlines.length}</span>
              </div>
              <div className={`${rowClass} flex items-center justify-between`}>
                <span className="flex items-center gap-1.5"><Type className="w-3 h-3 text-amber-400" /> Labels</span>
                <span className="text-zinc-500">{drawings.annotations.length}</span>
              </div>
              <div className={`${rowClass} flex items-center justify-between`}>
                <span className="flex items-center gap-1.5"><ArrowUpRight className="w-3 h-3 text-emerald-400" /> Setups</span>
                <span className="text-zinc-500">{(drawings.riskRewards || []).length}</span>
              </div>
              <div className={`${rowClass} flex items-center justify-between`}>
                <span className="flex items-center gap-1.5"><AlignJustify className="w-3 h-3 text-blue-400" /> Fibonacci</span>
                <span className="text-zinc-500">{(drawings.fibonacci || []).length}</span>
              </div>
            </div>
          </div>

          {/* Layer Entry Detail */}
          <div className="flex flex-col gap-1.5">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Layers Detail</span>
            {drawings.horizontalLines.length > 0 && (
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {drawings.horizontalLines.map((item, idx) => {
                  const { price, color } = resolveHorizontalLine(item);
                  return (
                    <div key={idx} className={`${rowClass} flex items-center justify-between`}>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        {price.toFixed(precision)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDrawings((prev) => ({ ...prev, horizontalLines: prev.horizontalLines.filter((_, i) => i !== idx) }))}
                        className="text-zinc-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {(drawings.riskRewards || []).length > 0 && (
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {(drawings.riskRewards || []).map((tool) => (
                  <div key={tool.id} className={`${rowClass} flex items-center justify-between`}>
                    <span className={`flex items-center gap-1.5 ${tool.type === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tool.type === 'long' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {tool.type} @ {tool.entry.price.toFixed(precision)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDrawings((prev) => ({ ...prev, riskRewards: prev.riskRewards.filter((t) => t.id !== tool.id) }))}
                      className="text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {(drawings.fibonacci || []).length > 0 && (
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {(drawings.fibonacci || []).map((tool) => (
                  <div key={tool.id} className={`${rowClass} flex items-center justify-between`}>
                    <span className="flex items-center gap-1.5">
                      <AlignJustify className="w-3 h-3 text-blue-400" />
                      Fib @ {tool.start.price.toFixed(precision)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDrawings((prev) => ({ ...prev, fibonacci: prev.fibonacci.filter((t) => t.id !== tool.id) }))}
                      className="text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {drawings.annotations.length > 0 && (
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {drawings.annotations.map((ann, idx) => (
                  <div key={idx} className={`${rowClass} flex items-center justify-between`}>
                    <span className="truncate pr-1">{ann.text}</span>
                    <button
                      type="button"
                      onClick={() => setDrawings((prev) => ({ ...prev, annotations: prev.annotations.filter((_, i) => i !== idx) }))}
                      className="text-zinc-500 hover:text-red-400 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {drawings.trendlines.length > 0 && (
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {drawings.trendlines.map((tl, idx) => (
                  <div key={idx} className={`${rowClass} flex items-center justify-between`}>
                    <span className="truncate pr-1">TL #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => setDrawings((prev) => ({ ...prev, trendlines: prev.trendlines.filter((_, i) => i !== idx) }))}
                      className="text-zinc-500 hover:text-red-400 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {drawings.horizontalLines.length === 0 && drawings.trendlines.length === 0 && drawings.annotations.length === 0 && (drawings.riskRewards || []).length === 0 && (drawings.fibonacci || []).length === 0 && (
              <div className="text-[10px] text-zinc-600 italic px-1">No drawings yet</div>
            )}
          </div>

          <button
            type="button"
            onClick={onClearDrawings}
            className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border text-[10px] font-mono font-bold text-rose-400 border-rose-900/40 hover:bg-rose-950/40 transition-all cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            Clear All Drawings
          </button>
        </div>
      )}

      {/* TAB 4: View & Animations */}
      {sidebarTab === 'view_anims' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Quick Timeframe</span>
            <div className="flex gap-1">
              {(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setSelectedTimeframe(tf)}
                  className={`px-1.5 py-1 rounded text-[9px] font-mono font-bold cursor-pointer border transition-all flex-1 ${
                    timeframe === tf
                      ? (theme === 'dark' ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' : 'bg-emerald-100 text-emerald-700 border-emerald-300')
                      : (theme === 'dark' ? 'bg-zinc-950/50 text-zinc-500 border-zinc-800/50 hover:border-zinc-700' : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-zinc-300')
                  }`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'}`} />

          <div className="flex flex-col gap-1.5">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Chart View</span>
            <button
              type="button"
              onClick={onFitContent}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[10px] font-mono font-semibold transition-all cursor-pointer ${
                theme === 'dark' ? 'bg-zinc-950/50 border-zinc-800/50 text-zinc-300 hover:border-zinc-600' : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              <Expand className="w-3.5 h-3.5 text-emerald-400" />
              Fit Content (all candles)
            </button>
            <button
              type="button"
              onClick={() => setIsExpandedFullScreen(!isExpandedFullScreen)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[10px] font-mono font-semibold transition-all cursor-pointer ${
                theme === 'dark' ? 'bg-zinc-950/50 border-zinc-800/50 text-zinc-300 hover:border-zinc-600' : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {isExpandedFullScreen ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-zinc-400" />}
              {isExpandedFullScreen ? 'Normal Mode' : 'Full Chart Screen'}
            </button>
            <button
              type="button"
              onClick={onSnapshot}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[10px] font-mono font-semibold transition-all cursor-pointer ${
                theme === 'dark' ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-300 hover:border-emerald-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:border-emerald-300'
              }`}
            >
              <Camera className="w-3.5 h-3.5 text-emerald-400" />
              Snapshot for AI
            </button>
          </div>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'}`} />

          <div className="flex flex-col gap-1.5">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Trade Animations</span>

            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-mono ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Show Trade Animations</span>
              <button
                type="button"
                onClick={() => setShowTradeAnimations(!showTradeAnimations)}
                className={`w-9 h-4.5 rounded-full transition-all cursor-pointer border relative ${
                  showTradeAnimations ? (theme === 'dark' ? 'bg-emerald-600 border-emerald-500' : 'bg-emerald-500 border-emerald-400') : (theme === 'dark' ? 'bg-zinc-700 border-zinc-600' : 'bg-zinc-300 border-zinc-200')
                }`}
                style={{ height: 18 }}
                title="Toggle animated trade entry/exit overlays"
              >
                <span
                  className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${
                    showTradeAnimations ? 'left-[calc(100%-16px)]' : 'left-0.5'
                  }`}
                  style={{ top: 1 }}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-mono ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Pattern Beams</span>
              <button
                type="button"
                onClick={() => setShowPatternBeams(!showPatternBeams)}
                className={`w-9 rounded-full transition-all cursor-pointer border relative ${
                  showPatternBeams ? (theme === 'dark' ? 'bg-sky-600 border-sky-500' : 'bg-sky-500 border-sky-400') : (theme === 'dark' ? 'bg-zinc-700 border-zinc-600' : 'bg-zinc-300 border-zinc-200')
                }`}
                style={{ height: 18 }}
                title="Toggle pattern-to-trade vector beams"
              >
                <span
                  className={`absolute w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${
                    showPatternBeams ? 'left-[calc(100%-16px)]' : 'left-0.5'
                  }`}
                  style={{ top: 1 }}
                />
              </button>
            </div>

            <div className="flex gap-1 mt-1">
              {ANIM_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAnimTradeFilter(f.id)}
                  className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold cursor-pointer border transition-all flex-1 ${
                    animTradeFilter === f.id
                      ? (theme === 'dark' ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' : 'bg-emerald-100 text-emerald-700 border-emerald-300')
                      : (theme === 'dark' ? 'bg-zinc-950/50 text-zinc-500 border-zinc-800/50 hover:border-zinc-700' : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-zinc-300')
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {showTradeAnimations && (
              <div className={`text-[9px] font-mono ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'} italic px-0.5`}>
                Entry/Exit markers animate on the chart using live &amp; closed trade data.
              </div>
            )}
          </div>
        </div>
      )}
    </motion.aside>
  );
};
