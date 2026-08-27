import React from 'react';
import { AlertCircle, Camera, Maximize2, Minimize2, SlidersHorizontal } from 'lucide-react';
import type { Candlestick, Timeframe } from '../../types';
import type { ChartTheme, DrawingTool } from '../../types/chart';

interface ChartHeaderProps {
  symbol: string;
  timeframe: Timeframe;
  data: Candlestick[];
  theme: ChartTheme;
  activeTool: DrawingTool;
  preferredHeight: number;
  isExpandedFullScreen: boolean;
  showChartSidebar: boolean;
  activeFeaturesCount: number;
  onSelectTimeframe: (tf: Timeframe) => void;
  onSetChartHeight: (height: number) => void;
  onToggleSidebar: () => void;
  onSnapshot: () => void;
  onToggleFullScreen: () => void;
}

const ACTIVE_TOOL_HINTS: Record<DrawingTool, string | null> = {
  none: null,
  horizontal: 'Click chart to place Support/Resistance',
  trendline_start: 'Click chart for Trendline START point',
  trendline_end: 'Click chart for Trendline END point',
  annotation: 'Click chart to add Custom Text label',
  rr_long: 'Click chart to place Long Position entry',
  rr_short: 'Click chart to place Short Position entry',
  fib_start: 'Click chart for Fibonacci START point',
  fib_end: 'Click chart for Fibonacci END point',
};

const CHART_SIZES = [
  { label: 'Medium', val: 460 },
  { label: 'Large', val: 620 },
  { label: 'XL', val: 780 },
];

export const ChartHeader: React.FC<ChartHeaderProps> = ({
  symbol,
  timeframe,
  data,
  theme,
  activeTool,
  preferredHeight,
  isExpandedFullScreen,
  showChartSidebar,
  activeFeaturesCount,
  onSelectTimeframe,
  onSetChartHeight,
  onToggleSidebar,
  onSnapshot,
  onToggleFullScreen,
}) => {
  const last = data[data.length - 1];
  const toolHint = ACTIVE_TOOL_HINTS[activeTool];

  return (
    <div className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'} border rounded-lg py-2 px-3.5 shadow-md`}>
      <div className="flex items-center gap-3">
        <span className={`font-display font-black text-sm ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'} flex items-center gap-1.5 leading-none`}>
          {symbol.slice(0, 3)}/{symbol.slice(3)}
          <span className="text-emerald-400 text-[10px] px-1 py-0.5 rounded bg-emerald-950/40 border border-emerald-900/30 uppercase font-mono">{timeframe}</span>
        </span>
        <div className={`text-[10px] ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'} font-mono hidden sm:flex items-center gap-2`}>
          <span>O: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{last?.open}</strong></span>
          <span>H: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{last?.high}</strong></span>
          <span>L: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{last?.low}</strong></span>
          <span>C: <strong className={last && last.close >= last.open ? 'text-green-500' : 'text-rose-500'}>{last?.close}</strong></span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {toolHint && (
          <div className="text-[10px] font-mono text-amber-400 flex items-center gap-1 animate-pulse bg-amber-950/20 px-2 py-0.5 rounded border border-amber-900/30">
            <AlertCircle className="w-3 h-3" />
            <span>{toolHint}</span>
          </div>
        )}

        {/* Quick Timeframe Bar */}
        <div className="hidden lg:flex items-center gap-1 bg-zinc-950/60 p-1 rounded border border-zinc-800/60 text-[10px] font-mono font-bold">
          {(['1m', '5m', '15m', '1H', '4H', 'D'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onSelectTimeframe(tf)}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                timeframe === tf
                  ? 'bg-emerald-600 text-white font-black shadow-sm'
                  : (theme === 'dark' ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200')
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Quick Chart Size Selector */}
        <div className="hidden sm:flex items-center gap-1 bg-zinc-950/60 p-1 rounded border border-zinc-800/60 text-[10px] font-mono font-bold">
          <span className="text-[9px] text-zinc-500 uppercase px-1">Chart Size</span>
          {CHART_SIZES.map((size) => (
            <button
              key={size.val}
              type="button"
              onClick={() => onSetChartHeight(size.val)}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                preferredHeight === size.val && !isExpandedFullScreen
                  ? 'bg-emerald-600 text-white font-black shadow-sm'
                  : (theme === 'dark' ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200')
              }`}
              title={`Expand chart canvas height to ${size.val}px (${size.label})`}
            >
              {size.label}
            </button>
          ))}
        </div>

        {/* Consolidated Chart Tools & Indicators Sidebar Toggle Button */}
        <button
          type="button"
          onClick={onToggleSidebar}
          className={`p-1.5 px-2.5 rounded-lg border transition-all cursor-pointer flex items-center gap-2 text-xs font-mono font-bold shadow-sm ${
            showChartSidebar
              ? (theme === 'dark' ? 'bg-emerald-950/70 text-emerald-400 border-emerald-800/80 shadow-emerald-950/40' : 'bg-emerald-100 text-emerald-800 border-emerald-300')
              : (theme === 'dark' ? 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800 hover:border-zinc-700' : 'bg-white text-zinc-600 hover:text-zinc-900 border-zinc-200 hover:border-zinc-300')
          }`}
          title="Toggle Chart Tools, Indicators & Overlay Sidebar"
          id="chart_sidebar_toggle_btn"
        >
          <SlidersHorizontal className={`w-4 h-4 ${showChartSidebar ? 'text-emerald-400 animate-pulse' : 'text-zinc-400'}`} />
          <span className="hidden sm:inline">Chart Tools &amp; Indicators</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-extrabold ${
            showChartSidebar ? 'bg-emerald-900/80 text-emerald-200' : 'bg-zinc-800 text-zinc-400'
          }`}>
            {activeFeaturesCount}
          </span>
        </button>

        <button
          onClick={onSnapshot}
          className={`p-1.5 ${theme === 'dark' ? 'bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-400 hover:text-emerald-200 border-emerald-900/60 hover:border-emerald-700' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-700 border-emerald-200 hover:border-emerald-300'} rounded border transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-mono font-bold`}
          title="Take a snapshot of this chart and analyze with Co-Pilot"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Snapshot for AI</span>
        </button>

        <button
          onClick={onToggleFullScreen}
          className={`p-1.5 ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800 hover:border-zinc-700' : 'hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900 border-zinc-200 hover:border-zinc-300'} rounded border transition-colors cursor-pointer flex items-center gap-1 text-xs font-mono font-bold`}
          title={isExpandedFullScreen ? "Exit Fullscreen Screen" : "Maximize Full Chart Screen"}
        >
          {isExpandedFullScreen ? (
            <>
              <Minimize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Normal Mode</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Full Chart Screen</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
