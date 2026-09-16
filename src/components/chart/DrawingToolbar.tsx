import React, { useState, useRef, useEffect } from 'react';
import {
  MousePointer,
  Crosshair,
  CircleDot,
  Eraser,
  TrendingUp,
  Minus,
  ArrowRight,
  SeparatorVertical,
  Columns,
  AlignJustify,
  Grid,
  Square,
  Circle,
  Paintbrush,
  Type,
  MessageSquare,
  Tag,
  ArrowUp,
  ArrowDown,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Ruler,
  Magnet,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Layers,
  Trash2,
  Expand,
  ChevronRight,
} from 'lucide-react';
import type { ChartTheme, DrawingTool, CursorType } from '../../types/chart';

interface DrawingToolbarProps {
  theme: ChartTheme;
  activeTool: DrawingTool;
  selectedColor: string;
  showDrawingsManager: boolean;
  magnetMode: boolean;
  lockDrawings: boolean;
  hideAllDrawings: boolean;
  cursorType: CursorType;
  onSelectTool: (tool: DrawingTool) => void;
  onToggleMagnetMode: () => void;
  onToggleLockDrawings: () => void;
  onToggleHideDrawings: () => void;
  onSelectCursorType: (cursor: CursorType) => void;
  onFitContent: () => void;
  onSelectColor: (color: string) => void;
  onToggleDrawingsManager: () => void;
  onClearDrawings: () => void;
}

const COLOR_PALETTE = [
  { name: 'emerald', value: '#10b981' },
  { name: 'gold', value: '#eab308' },
  { name: 'rose', value: '#f43f5e' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'purple', value: '#a855f7' },
  { name: 'cyan', value: '#06b6d4' },
];

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  theme,
  activeTool,
  selectedColor,
  showDrawingsManager,
  magnetMode,
  lockDrawings,
  hideAllDrawings,
  cursorType,
  onSelectTool,
  onToggleMagnetMode,
  onToggleLockDrawings,
  onToggleHideDrawings,
  onSelectCursorType,
  onFitContent,
  onSelectColor,
  onToggleDrawingsManager,
  onClearDrawings,
}) => {
  const [openFlyout, setOpenFlyout] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Close flyouts on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenFlyout(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toolButtonClass = (active: boolean) =>
    `p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
      active
        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
        : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
    }`;

  const isTrendActive =
    activeTool === 'trendline_start' ||
    activeTool === 'trendline_end' ||
    activeTool === 'horizontal' ||
    activeTool === 'horizontal_ray' ||
    activeTool === 'vertical_line' ||
    activeTool === 'channel_p1' ||
    activeTool === 'channel_p2' ||
    activeTool === 'channel_p3';

  const isFibActive =
    activeTool === 'fib_start' ||
    activeTool === 'fib_end' ||
    activeTool === 'fib_ext_p1' ||
    activeTool === 'fib_ext_p2' ||
    activeTool === 'fib_ext_p3' ||
    activeTool === 'gann_box_p1' ||
    activeTool === 'gann_box_p2';

  const isPatternActive =
    activeTool.startsWith('pattern_hs_') ||
    activeTool.startsWith('pattern_xabcd_') ||
    activeTool.startsWith('pattern_elliott_');

  const isPredictionActive =
    activeTool === 'rr_long' ||
    activeTool === 'rr_short' ||
    activeTool === 'ruler_start' ||
    activeTool === 'ruler_end';

  const isShapeActive =
    activeTool === 'rect_start' ||
    activeTool === 'rect_end' ||
    activeTool === 'circle_start' ||
    activeTool === 'circle_end' ||
    activeTool === 'brush';

  const isAnnotationActive =
    activeTool === 'annotation' ||
    activeTool === 'callout' ||
    activeTool === 'price_label' ||
    activeTool === 'arrow_up' ||
    activeTool === 'arrow_down';

  return (
    <div
      ref={toolbarRef}
      className={`relative flex flex-col gap-1.5 p-1.5 ${
        theme === 'dark'
          ? 'bg-zinc-900 border-zinc-800/80 text-zinc-100 shadow-xl'
          : 'bg-white border-zinc-200 text-zinc-900 shadow-lg'
      } border rounded-lg w-11 shrink-0 items-center justify-start py-3 select-none z-30`}
    >
      {/* 1. CURSORS GROUP */}
      <div className="relative group">
        <button
          onClick={() => {
            if (openFlyout === 'cursor') setOpenFlyout(null);
            else setOpenFlyout('cursor');
          }}
          className={toolButtonClass(cursorType !== 'crosshair' || activeTool === 'none')}
          title="Cursors & Pointer Mode"
        >
          {cursorType === 'crosshair' && <Crosshair className="w-4 h-4" />}
          {cursorType === 'dot' && <CircleDot className="w-4 h-4" />}
          {cursorType === 'arrow' && <MousePointer className="w-4 h-4" />}
          {cursorType === 'eraser' && <Eraser className="w-4 h-4 text-rose-400" />}
          <span className="absolute bottom-0.5 right-0.5 text-[8px] leading-none opacity-60">▸</span>
        </button>

        {openFlyout === 'cursor' && (
          <div className="absolute left-12 top-0 z-50 w-44 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1 space-y-0.5 font-mono text-xs">
            <div className="px-2 py-1 text-[9px] uppercase font-bold text-zinc-500 border-b border-zinc-800">
              Cursors
            </div>
            <button
              onClick={() => {
                onSelectCursorType('crosshair');
                onSelectTool('none');
                setOpenFlyout(null);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left ${cursorType === 'crosshair' ? 'text-emerald-400 font-bold bg-zinc-900' : 'text-zinc-300'}`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Crosshair</span>
            </button>
            <button
              onClick={() => {
                onSelectCursorType('dot');
                onSelectTool('none');
                setOpenFlyout(null);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left ${cursorType === 'dot' ? 'text-emerald-400 font-bold bg-zinc-900' : 'text-zinc-300'}`}
            >
              <CircleDot className="w-3.5 h-3.5" />
              <span>Dot Cursor</span>
            </button>
            <button
              onClick={() => {
                onSelectCursorType('arrow');
                onSelectTool('none');
                setOpenFlyout(null);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left ${cursorType === 'arrow' ? 'text-emerald-400 font-bold bg-zinc-900' : 'text-zinc-300'}`}
            >
              <MousePointer className="w-3.5 h-3.5" />
              <span>Arrow Pointer</span>
            </button>
            <button
              onClick={() => {
                onSelectCursorType('eraser');
                onSelectTool('cursor_eraser');
                setOpenFlyout(null);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left ${cursorType === 'eraser' ? 'text-rose-400 font-bold bg-zinc-900' : 'text-rose-300'}`}
            >
              <Eraser className="w-3.5 h-3.5 text-rose-400" />
              <span>Eraser</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. TREND TOOLS GROUP */}
      <div className="relative group">
        <button
          onClick={() => {
            if (openFlyout === 'trend') setOpenFlyout(null);
            else setOpenFlyout('trend');
          }}
          className={toolButtonClass(isTrendActive)}
          title="Trend Lines & Levels"
        >
          <TrendingUp className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 text-[8px] leading-none opacity-60">▸</span>
        </button>

        {openFlyout === 'trend' && (
          <div className="absolute left-12 top-0 z-50 w-52 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1 space-y-0.5 font-mono text-xs">
            <div className="px-2 py-1 text-[9px] uppercase font-bold text-zinc-500 border-b border-zinc-800">
              Trend Tools
            </div>
            <button
              onClick={() => {
                onSelectTool('trendline_start');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>Trendline (Ray)</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('horizontal');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Minus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Horizontal Line (S/R)</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('horizontal_ray');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
              <span>Horizontal Ray</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('vertical_line');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <SeparatorVertical className="w-3.5 h-3.5 text-amber-400" />
              <span>Vertical Time Line</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('channel_p1');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Columns className="w-3.5 h-3.5 text-blue-400" />
              <span>Parallel Channel</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. FIBONACCI & GANN TOOLS GROUP */}
      <div className="relative group">
        <button
          onClick={() => {
            if (openFlyout === 'fib') setOpenFlyout(null);
            else setOpenFlyout('fib');
          }}
          className={toolButtonClass(isFibActive)}
          title="Fibonacci & Gann Tools"
        >
          <AlignJustify className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 text-[8px] leading-none opacity-60">▸</span>
        </button>

        {openFlyout === 'fib' && (
          <div className="absolute left-12 top-0 z-50 w-52 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1 space-y-0.5 font-mono text-xs">
            <div className="px-2 py-1 text-[9px] uppercase font-bold text-zinc-500 border-b border-zinc-800">
              Fibonacci &amp; Gann
            </div>
            <button
              onClick={() => {
                onSelectTool('fib_start');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <AlignJustify className="w-3.5 h-3.5 text-blue-400" />
              <span>Fib Retracement</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('fib_ext_p1');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>Fib Trend Extension</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('gann_box_p1');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Grid className="w-3.5 h-3.5 text-amber-400" />
              <span>Gann Box / Square</span>
            </button>
          </div>
        )}
      </div>

      {/* 4. GEOMETRIC SHAPES GROUP */}
      <div className="relative group">
        <button
          onClick={() => {
            if (openFlyout === 'shapes') setOpenFlyout(null);
            else setOpenFlyout('shapes');
          }}
          className={toolButtonClass(isShapeActive)}
          title="Geometric Shapes (Supply/Demand Zones)"
        >
          <Square className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 text-[8px] leading-none opacity-60">▸</span>
        </button>

        {openFlyout === 'shapes' && (
          <div className="absolute left-12 top-0 z-50 w-52 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1 space-y-0.5 font-mono text-xs">
            <div className="px-2 py-1 text-[9px] uppercase font-bold text-zinc-500 border-b border-zinc-800">
              Geometric Shapes
            </div>
            <button
              onClick={() => {
                onSelectTool('rect_start');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Square className="w-3.5 h-3.5 text-emerald-400" />
              <span>Rectangle (S/D Zone)</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('circle_start');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Circle className="w-3.5 h-3.5 text-purple-400" />
              <span>Circle / Ellipse</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('brush');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Paintbrush className="w-3.5 h-3.5 text-amber-400" />
              <span>Freehand Brush</span>
            </button>
          </div>
        )}
      </div>

      {/* 5. ANNOTATION TOOLS GROUP */}
      <div className="relative group">
        <button
          onClick={() => {
            if (openFlyout === 'annotations') setOpenFlyout(null);
            else setOpenFlyout('annotations');
          }}
          className={toolButtonClass(isAnnotationActive)}
          title="Annotation & Text Tools"
        >
          <Type className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 text-[8px] leading-none opacity-60">▸</span>
        </button>

        {openFlyout === 'annotations' && (
          <div className="absolute left-12 top-0 z-50 w-48 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1 space-y-0.5 font-mono text-xs">
            <div className="px-2 py-1 text-[9px] uppercase font-bold text-zinc-500 border-b border-zinc-800">
              Annotation Tools
            </div>
            <button
              onClick={() => {
                onSelectTool('annotation');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Type className="w-3.5 h-3.5 text-amber-400" />
              <span>Text Note</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('callout');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
              <span>Speech Callout</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('price_label');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Tag className="w-3.5 h-3.5 text-emerald-400" />
              <span>Price Label Tag</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('arrow_up');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>Bullish Arrow (▲)</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('arrow_down');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <ArrowDown className="w-3.5 h-3.5 text-rose-400" />
              <span>Bearish Arrow (▼)</span>
            </button>
          </div>
        )}
      </div>

      {/* 6. PATTERNS GROUP */}
      <div className="relative group">
        <button
          onClick={() => {
            if (openFlyout === 'patterns') setOpenFlyout(null);
            else setOpenFlyout('patterns');
          }}
          className={toolButtonClass(isPatternActive)}
          title="Chart Patterns (Head & Shoulders, Harmonic XABCD, Elliott Wave)"
        >
          <Activity className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 text-[8px] leading-none opacity-60">▸</span>
        </button>

        {openFlyout === 'patterns' && (
          <div className="absolute left-12 top-0 z-50 w-52 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1 space-y-0.5 font-mono text-xs">
            <div className="px-2 py-1 text-[9px] uppercase font-bold text-zinc-500 border-b border-zinc-800">
              Pattern Tools
            </div>
            <button
              onClick={() => {
                onSelectTool('pattern_hs_p1');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Activity className="w-3.5 h-3.5 text-purple-400" />
              <span>Head &amp; Shoulders</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('pattern_xabcd_p1');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>Harmonic XABCD</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('pattern_elliott_p1');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Elliott Wave (1-2-3-4-5)</span>
            </button>
          </div>
        )}
      </div>

      {/* 7. PREDICTION & MEASUREMENT GROUP */}
      <div className="relative group">
        <button
          onClick={() => {
            if (openFlyout === 'prediction') setOpenFlyout(null);
            else setOpenFlyout('prediction');
          }}
          className={toolButtonClass(isPredictionActive)}
          title="Forecasting & Measurement Tools"
        >
          <Ruler className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 text-[8px] leading-none opacity-60">▸</span>
        </button>

        {openFlyout === 'prediction' && (
          <div className="absolute left-12 top-0 z-50 w-52 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-1 space-y-0.5 font-mono text-xs">
            <div className="px-2 py-1 text-[9px] uppercase font-bold text-zinc-500 border-b border-zinc-800">
              Measurement &amp; Forecast
            </div>
            <button
              onClick={() => {
                onSelectTool('ruler_start');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <Ruler className="w-3.5 h-3.5 text-cyan-400" />
              <span>Date &amp; Price Ruler</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('rr_long');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
              <span>Long Position (R:R)</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('rr_short');
                setOpenFlyout(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-left text-zinc-300"
            >
              <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
              <span>Short Position (R:R)</span>
            </button>
          </div>
        )}
      </div>

      <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

      {/* 8. CHART MANAGEMENT UTILITIES */}
      {/* Magnet Mode Toggle */}
      <button
        onClick={onToggleMagnetMode}
        className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
          magnetMode
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-sm'
            : `text-zinc-500 hover:text-zinc-300 ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`
        }`}
        title={`Magnet Mode: ${magnetMode ? 'ON (Snaps to Candle OHLC)' : 'OFF'}`}
      >
        <Magnet className={`w-4 h-4 ${magnetMode ? 'animate-bounce text-amber-400' : ''}`} />
      </button>

      {/* Lock All Drawings Toggle */}
      <button
        onClick={onToggleLockDrawings}
        className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
          lockDrawings
            ? 'bg-rose-950/60 text-rose-400 border border-rose-800/80'
            : `text-zinc-500 hover:text-zinc-300 ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`
        }`}
        title={`Lock Drawings: ${lockDrawings ? 'LOCKED (Protected from edits)' : 'UNLOCKED'}`}
      >
        {lockDrawings ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
      </button>

      {/* Hide / Show All Drawings Toggle */}
      <button
        onClick={onToggleHideDrawings}
        className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
          hideAllDrawings
            ? 'bg-indigo-950/60 text-indigo-400 border border-indigo-800/80'
            : `text-zinc-500 hover:text-zinc-300 ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`
        }`}
        title={`Drawings Visibility: ${hideAllDrawings ? 'HIDDEN' : 'VISIBLE'}`}
      >
        {hideAllDrawings ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>

      {/* Auto-Fit Canvas */}
      <button
        onClick={onFitContent}
        className={`p-2 rounded-lg text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'} transition-all cursor-pointer flex items-center justify-center relative group`}
        title="Auto Fit Chart (Fit all bars on screen)"
      >
        <Expand className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
      </button>

      {/* Color Palette Selector */}
      <div className="flex flex-col gap-1 py-1 items-center">
        {COLOR_PALETTE.map((col) => (
          <button
            key={col.value}
            onClick={() => onSelectColor(col.value)}
            className={`w-3.5 h-3.5 rounded-full border transition-all cursor-pointer ${
              selectedColor === col.value
                ? 'border-white scale-125 shadow-md shadow-black'
                : 'border-transparent hover:scale-110 opacity-70 hover:opacity-100'
            }`}
            style={{ backgroundColor: col.value }}
            title={`Set color: ${col.name}`}
          />
        ))}
      </div>

      <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

      {/* Layers Manager Drawer Button */}
      <button
        onClick={onToggleDrawingsManager}
        className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
          showDrawingsManager
            ? (theme === 'dark' ? 'bg-zinc-800 text-emerald-400 border border-zinc-700' : 'bg-zinc-100 text-emerald-600 border border-zinc-300')
            : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
        }`}
        title="Manage Active Drawing Layers & Objects"
      >
        <Layers className="w-4 h-4" />
      </button>

      {/* Clear All Drawings */}
      <button
        onClick={() => {
          if (lockDrawings) {
            alert('Drawings are currently locked. Unlock before clearing.');
            return;
          }
          if (window.confirm('Delete all custom chart drawings?')) {
            onClearDrawings();
          }
        }}
        className={`p-2 rounded-lg text-rose-400 hover:text-rose-200 ${theme === 'dark' ? 'hover:bg-rose-950/40' : 'hover:bg-rose-50'} transition-all cursor-pointer flex items-center justify-center`}
        title="Delete All Custom Drawings"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};
