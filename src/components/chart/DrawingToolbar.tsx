import React from 'react';
import {
  MousePointer,
  TrendingUp,
  Minus,
  Type,
  Trash2,
  Expand,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  AlignJustify,
} from 'lucide-react';
import type { ChartTheme, DrawingTool } from '../../types/chart';

interface DrawingToolbarProps {
  theme: ChartTheme;
  activeTool: DrawingTool;
  selectedColor: string;
  showDrawingsManager: boolean;
  onSelectTool: (tool: DrawingTool) => void;
  onFitContent: () => void;
  onSelectColor: (color: string) => void;
  onToggleDrawingsManager: () => void;
  onClearDrawings: () => void;
}

const COLOR_PALETTE = [
  { name: 'gold', value: '#eab308' },
  { name: 'emerald', value: '#22c55e' },
  { name: 'rose', value: '#f43f5e' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'purple', value: '#a855f7' },
];

const toolButtonClass = (active: boolean, theme: ChartTheme) =>
  `p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
    active
      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
      : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
  }`;

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  theme,
  activeTool,
  selectedColor,
  showDrawingsManager,
  onSelectTool,
  onFitContent,
  onSelectColor,
  onToggleDrawingsManager,
  onClearDrawings,
}) => {
  return (
    <div className={`flex flex-col gap-2 p-1.5 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/80 text-zinc-100 shadow-xl' : 'bg-white border-zinc-200 text-zinc-900 shadow-lg'} border rounded-lg w-11 shrink-0 items-center justify-start py-4`}>
      <button
        onClick={() => onSelectTool('none')}
        className={toolButtonClass(activeTool === 'none', theme)}
        title="Normal Selection / Cursor"
      >
        <MousePointer className="w-4 h-4" />
      </button>

      <button
        onClick={onFitContent}
        className={`p-2 rounded-lg text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'} transition-all cursor-pointer flex items-center justify-center relative group`}
        title="Auto Fit Chart (Fit all candles on screen)"
      >
        <Expand className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
        <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
      </button>

      <button
        onClick={() => onSelectTool('horizontal')}
        className={toolButtonClass(activeTool === 'horizontal', theme)}
        title="Horizontal Line (Support & Resistance Level)"
      >
        <Minus className="w-4 h-4" />
        <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />
      </button>

      <button
        onClick={() => onSelectTool('trendline_start')}
        className={toolButtonClass(activeTool === 'trendline_start' || activeTool === 'trendline_end', theme)}
        title="Trendline Tool (Click Start & End points)"
      >
        <TrendingUp className="w-4 h-4" />
        <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
      </button>

      <button
        onClick={() => onSelectTool('annotation')}
        className={toolButtonClass(activeTool === 'annotation', theme)}
        title="Text Label / Custom Note"
      >
        <Type className="w-4 h-4" />
        <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
      </button>

      <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

      {/* Long / Short Risk/Reward Tool */}
      <button
        onClick={() => onSelectTool('rr_long')}
        className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
          activeTool === 'rr_long' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
        }`}
        title="Long Position (Risk/Reward)"
      >
        <ArrowUpRight className="w-4 h-4 text-emerald-400" />
      </button>
      <button
        onClick={() => onSelectTool('rr_short')}
        className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
          activeTool === 'rr_short' ? 'bg-red-600 text-white shadow-md shadow-red-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
        }`}
        title="Short Position (Risk/Reward)"
      >
        <ArrowDownRight className="w-4 h-4 text-red-400" />
      </button>

      <button
        onClick={() => onSelectTool('fib_start')}
        className={toolButtonClass(activeTool === 'fib_start' || activeTool === 'fib_end', theme)}
        title="Fibonacci Retracement"
      >
        <AlignJustify className="w-4 h-4" />
        <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-400" />
      </button>

      <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />
      <div className="flex flex-col gap-1.5 py-1 items-center">
        {COLOR_PALETTE.map((col) => (
          <button
            key={col.value}
            onClick={() => onSelectColor(col.value)}
            className={`w-3.5 h-3.5 rounded-full border transition-all cursor-pointer ${
              selectedColor === col.value
                ? 'border-white scale-110 shadow-md shadow-black'
                : 'border-transparent hover:scale-110'
            }`}
            style={{ backgroundColor: col.value }}
            title={`Use ${col.name} drawing color`}
          />
        ))}
      </div>

      <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

      {/* Layers Manager Button */}
      <button
        onClick={onToggleDrawingsManager}
        className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
          showDrawingsManager ? (theme === 'dark' ? 'bg-zinc-800 text-emerald-400 border border-zinc-700' : 'bg-zinc-100 text-emerald-600 border border-zinc-300') : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
        }`}
        title="Manage Active Drawing Layers"
      >
        <Layers className="w-4 h-4" />
      </button>

      <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

      <button
        onClick={onClearDrawings}
        className={`p-2 rounded-lg text-rose-400 hover:text-rose-200 ${theme === 'dark' ? 'hover:bg-rose-950/40' : 'hover:bg-rose-50'} transition-all cursor-pointer flex items-center justify-center`}
        title="Delete All Custom Drawings"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};
