import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { IChartApi } from 'lightweight-charts';
import { AnimatePresence } from 'motion/react';
import type { Candlestick, Pattern, TechnicalIndicatorsState, Timeframe } from '../types';
import { useTrading } from '../context/TradingContext';
import {
  FOREX_SESSIONS,
  ForexSessionKey,
  generateSessionBlocks,
} from '../utils/forexSessions';
import type {
  AnimTradeFilter,
  AnimatedTrade,
  ChartPoint,
  ChartTheme,
  DrawingsState,
  DrawingTool,
  HudData,
  PatternMarkerFilter,
  SidebarTab,
} from '../types/chart';
import { EMPTY_DRAWINGS } from '../types/chart';
import { useChartCore } from '../hooks/useChartCore';
import { loadDrawings, saveDrawings } from '../utils/chart/drawingTools';
import { ChartHeader } from './chart/ChartHeader';
import { DrawingToolbar } from './chart/DrawingToolbar';
import { DrawingsManager } from './chart/DrawingsManager';
import { ChartOverlays, PriceStreak } from './chart/ChartOverlays';
import { SubChartPanels } from './chart/SubChartPanels';
import { ChartSidebar } from './chart/ChartSidebar';

interface TradingChartProps {
  data: Candlestick[];
  symbol: string;
  timeframe: Timeframe;
  patterns: Pattern[];
  indicators: TechnicalIndicatorsState;
}

export const TradingChart: React.FC<TradingChartProps> = React.memo(({
  data,
  symbol,
  timeframe,
  patterns,
  indicators,
}) => {
  const { theme: globalTheme, positions, closedTrades, handleChartSnapshot, handleToggleIndicator } = useTrading();
  const theme: ChartTheme = globalTheme === 'light' ? 'light' : 'dark';

  // --- Price Streak (consecutive candles) ---
  const priceStreak: PriceStreak = useMemo(() => {
    const closes = data.map((d) => d.close);
    let count = 0;
    let type: PriceStreak['type'] = 'neutral';
    if (closes.length > 1) {
      const lastDiff = closes[closes.length - 1] - closes[closes.length - 2];
      if (lastDiff > 0) type = 'bullish';
      else if (lastDiff < 0) type = 'bearish';
      if (type !== 'neutral') {
        for (let i = closes.length - 1; i > 0; i--) {
          const diff = closes[i] - closes[i - 1];
          if ((type === 'bullish' && diff > 0) || (type === 'bearish' && diff < 0)) {
            count++;
          } else {
            break;
          }
        }
      }
    }
    return { count, type };
  }, [data]);

  // --- Chart Core Refs ---
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const rsiContainerRef = React.useRef<HTMLDivElement | null>(null);
  const rsiChartRef = React.useRef<IChartApi | null>(null);
  const macdContainerRef = React.useRef<HTMLDivElement | null>(null);
  const macdChartRef = React.useRef<IChartApi | null>(null);

  // --- Drawing State ---
  const [drawings, setDrawings] = useState<DrawingsState>(() => loadDrawings(symbol));
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [trendlineStart, setTrendlineStart] = useState<ChartPoint | null>(null);
  const [fibStart, setFibStart] = useState<ChartPoint | null>(null);
  const [selectedColor, setSelectedColor] = useState('#eab308');
  const [showDrawingsManager, setShowDrawingsManager] = useState(false);

  // --- Pattern Layer State ---
  const [showPatternMarkers, setShowPatternMarkers] = useState(true);
  const [patternMarkerFilter, setPatternMarkerFilter] = useState<PatternMarkerFilter>('all');
  const [highlightedPattern, setHighlightedPattern] = useState<Pattern | null>(null);

  // --- Session Shading State ---
  const [showSessionShading, setShowSessionShading] = useState(false);
  const [enabledSessions, setEnabledSessions] = useState<Record<ForexSessionKey, boolean>>(() => {
    const initial: Record<ForexSessionKey, boolean> = { tokyo: true, london: true, newyork: true, sydney: true };
    try {
      const cached = localStorage.getItem('forexinsight_sessions');
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, unknown>;
        // Migrate the legacy "asia" key to the current "tokyo" session key
        return {
          tokyo: typeof parsed.tokyo === 'boolean' ? parsed.tokyo : (typeof parsed.asia === 'boolean' ? parsed.asia : initial.tokyo),
          london: typeof parsed.london === 'boolean' ? parsed.london : initial.london,
          newyork: typeof parsed.newyork === 'boolean' ? parsed.newyork : initial.newyork,
          sydney: typeof parsed.sydney === 'boolean' ? parsed.sydney : initial.sydney,
        };
      }
    } catch { /* ignore */ }
    return initial;
  });

  // --- Trade Animation State ---
  const [showTradeAnimations, setShowTradeAnimations] = useState(false);
  const [showPatternBeams, setShowPatternBeams] = useState(true);
  const [animTradeFilter, setAnimTradeFilter] = useState<AnimTradeFilter>('all');

  // --- Layout State ---
  const [showChartSidebar, setShowChartSidebar] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('indicators');
  const [hudData, setHudData] = useState<HudData | null>(null);
  const [isRsiMinimized, setIsRsiMinimized] = useState(false);
  const [isMacdMinimized, setIsMacdMinimized] = useState(false);
  const [preferredHeight, setPreferredHeight] = useState(460);
  const [isExpandedFullScreen, setIsExpandedFullScreen] = useState(false);

  const chartHeight = isExpandedFullScreen
    ? Math.max(window.innerHeight - 170, 400)
    : preferredHeight;

  // --- Derived memos ---
  const activeFeaturesCount = useMemo(() => {
    let count = 0;
    if (indicators.sma) count++;
    if (indicators.ema) count++;
    if (indicators.rsi) count++;
    if (indicators.macd) count++;
    if (indicators.bollinger) count++;
    if (indicators.fibonacci) count++;
    if (showSessionShading) count++;
    if (showTradeAnimations) count++;
    if (showPatternMarkers) count++;
    return count;
  }, [indicators, showSessionShading, showTradeAnimations, showPatternMarkers]);

  const visibleChartPatterns = useMemo(() => {
    if (!showPatternMarkers) return [];
    if (patternMarkerFilter === 'all') return patterns;
    if (patternMarkerFilter === 'high_winrate') {
      return patterns.filter((p) => p.winRate && p.winRate >= 60);
    }
    return patterns.filter((p) => p.type === patternMarkerFilter);
  }, [patterns, showPatternMarkers, patternMarkerFilter]);

  const sessionBlocks = useMemo(() => {
    return generateSessionBlocks(data, timeframe, enabledSessions);
  }, [data, timeframe, enabledSessions]);

  const symbolTradesToAnimate: AnimatedTrade[] = useMemo(() => {
    const list: AnimatedTrade[] = [];
    const activePositions = animTradeFilter === 'closed' ? [] : positions;
    const closedList = animTradeFilter === 'open' ? [] : closedTrades;
    list.push(...activePositions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      type: p.type,
      entryPrice: p.entryPrice,
      amount: p.amount,
      pnl: p.pnl,
      time: p.time,
      isClosed: false,
    })));
    list.push(...closedList.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      type: t.type,
      entryPrice: t.entryPrice,
      amount: t.amount,
      pnl: t.pnl,
      time: t.time,
      isClosed: true,
      exitPrice: t.exitPrice,
      closeReason: t.closeReason,
    })));
    return list;
  }, [animTradeFilter, positions, closedTrades]);

  // --- Chart core lifecycle ---
  useChartCore({
    containerRef,
    rsiContainerRef,
    macdContainerRef,
    chartRef,
    rsiChartRef,
    macdChartRef,
    symbol,
    timeframe,
    data,
    indicators,
    theme,
    chartHeight,
    isExpandedFullScreen,
    isRsiMinimized,
    isMacdMinimized,
    drawings,
    setDrawings,
    activeTool,
    setActiveTool,
    trendlineStart,
    setTrendlineStart,
    fibStart,
    setFibStart,
    selectedColor,
    setHudData,
    patterns,
    visibleChartPatterns,
    highlightedPattern,
    sessionBlocks,
    showSessionShading,
    symbolTradesToAnimate,
    showTradeAnimations,
    showPatternBeams,
  });

  // --- Persist drawings per symbol ---
  useEffect(() => {
    saveDrawings(symbol, drawings);
  }, [drawings, symbol]);

  // --- Reset chart autoScale on symbol change ---
  // Fixes: after manual zoom/pan, switching symbols left the chart
  // locked on the old price range, appearing empty or misaligned.
  useEffect(() => {
    if (chartRef.current) {
      try {
        const mainSeries = (chartRef.current as any)._chartApi?.mainSeries?.();
        if (mainSeries?.priceScale) {
          mainSeries.priceScale().applyOptions({ autoScale: true });
        }
        chartRef.current.timeScale().fitContent();
      } catch {
        /* ignore — chart may not be fully initialized yet */
      }
    }
  }, [symbol]);

  // --- Handlers ---
  const handleTakeSnapshot = useCallback(() => {
    if (chartRef.current) {
      const imageDataUrl = chartRef.current.takeScreenshot().toDataURL('image/png');
      const textArea = document.createElement('textarea');
      textArea.value = imageDataUrl;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      document.body.removeChild(textArea);
      // Attach the snapshot to the AI assistant (context state + scroll into view)
      handleChartSnapshot(imageDataUrl);
      window.dispatchEvent(
        new CustomEvent('apexfx:snapshot', {
          detail: { imageDataUrl, symbol, timeframe },
        })
      );
    }
  }, [symbol, timeframe]);

  const handleSetChartHeight = useCallback((height: number) => {
    setPreferredHeight(height);
  }, []);

  const handleClearDrawings = useCallback(() => {
    if (window.confirm('Delete all custom drawings on this chart?')) {
      setDrawings(EMPTY_DRAWINGS);
      setActiveTool('none');
      setTrendlineStart(null);
      setFibStart(null);
    }
  }, []);

  const handleToggleSession = useCallback((key: ForexSessionKey) => {
    setEnabledSessions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleToggleIndicatorLocal = useCallback((key: keyof TechnicalIndicatorsState) => {
    handleToggleIndicator(key);
  }, [handleToggleIndicator]);

  const handleFitContent = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  const filteredTradesForAnim = useMemo(
    () => symbolTradesToAnimate.filter((t) => t.symbol === symbol),
    [symbolTradesToAnimate, symbol]
  );

  return (
    <div className={`flex flex-col gap-2 ${isExpandedFullScreen ? 'h-[calc(100vh-4rem)]' : ''}`}>
      <ChartHeader
        symbol={symbol}
        timeframe={timeframe}
        data={data}
        theme={theme}
        activeTool={activeTool}
        preferredHeight={preferredHeight}
        isExpandedFullScreen={isExpandedFullScreen}
        showChartSidebar={showChartSidebar}
        activeFeaturesCount={activeFeaturesCount}
        onSelectTimeframe={(tf) => {
          // Timeframe switching is managed by the parent (App/TradingView context)
          window.dispatchEvent(new CustomEvent('apexfx:timeframe', { detail: { timeframe: tf } }));
        }}
        onSetChartHeight={handleSetChartHeight}
        onToggleSidebar={() => setShowChartSidebar((v) => !v)}
        onSnapshot={handleTakeSnapshot}
        onToggleFullScreen={() => setIsExpandedFullScreen((v) => !v)}
      />

      <div className="flex gap-2">
        {/* Drawing Toolbar */}
        <DrawingToolbar
          theme={theme}
          activeTool={activeTool}
          selectedColor={selectedColor}
          showDrawingsManager={showDrawingsManager}
          onSelectTool={setActiveTool}
          onFitContent={handleFitContent}
          onSelectColor={setSelectedColor}
          onToggleDrawingsManager={() => setShowDrawingsManager((v) => !v)}
          onClearDrawings={handleClearDrawings}
        />

        {/* Main Chart Column */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <div className={`relative ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/70' : 'bg-white border-zinc-200'} border rounded-lg overflow-hidden shadow-md`}>
            <div ref={containerRef} style={{ height: chartHeight }} className="w-full" />

            {data.length === 0 && (
              <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 z-40 ${theme === 'dark' ? 'bg-zinc-900/85 text-zinc-400' : 'bg-white/85 text-zinc-500'}`}>
                <span className="text-2xl">📡</span>
                <span className="text-xs font-mono font-semibold">Live market data unavailable</span>
                <span className="text-[10px] font-mono opacity-70">Waiting for the real-time feed (Yahoo Finance / WebSocket)…</span>
              </div>
            )}

            <ChartOverlays
              theme={theme}
              symbol={symbol}
              timeframe={timeframe}
              sessionBlocks={sessionBlocks}
              showSessionShading={showSessionShading}
              enabledSessions={enabledSessions}
              priceStreak={priceStreak}
              drawings={drawings}
              showTradeAnimations={showTradeAnimations}
              symbolTradesToAnimate={filteredTradesForAnim}
              showPatternBeams={showPatternBeams}
              hudData={hudData}
            />
          </div>

          {/* RSI / MACD Sub-charts */}
          <SubChartPanels
            theme={theme}
            symbol={symbol}
            indicators={indicators}
            onToggleIndicator={handleToggleIndicatorLocal}
            isRsiMinimized={isRsiMinimized}
            setIsRsiMinimized={setIsRsiMinimized}
            isMacdMinimized={isMacdMinimized}
            setIsMacdMinimized={setIsMacdMinimized}
            rsiContainerRef={rsiContainerRef}
            macdContainerRef={macdContainerRef}
            isExpandedFullScreen={isExpandedFullScreen}
            hudData={hudData}
          />
        </div>

        {/* Drawings Manager Drawer */}
        <AnimatePresence>
          {showDrawingsManager && (
            <div className="hidden md:block">
              <DrawingsManager
                theme={theme}
                symbol={symbol}
                drawings={drawings}
                setDrawings={setDrawings}
                patterns={patterns}
                visibleChartPatterns={visibleChartPatterns}
                highlightedPattern={highlightedPattern}
                setHighlightedPattern={setHighlightedPattern}
                showPatternMarkers={showPatternMarkers}
                setShowPatternMarkers={setShowPatternMarkers}
                onClose={() => setShowDrawingsManager(false)}
              />
            </div>
          )}
        </AnimatePresence>

        {/* Chart Sidebar */}
        <AnimatePresence>
          {showChartSidebar && (
            <ChartSidebar
              theme={theme}
              sidebarTab={sidebarTab}
              setSidebarTab={setSidebarTab}
              onClose={() => setShowChartSidebar(false)}
              symbol={symbol}
              indicators={indicators}
              onToggleIndicator={handleToggleIndicatorLocal}
              patterns={patterns}
              visibleChartPatterns={visibleChartPatterns}
              highlightedPattern={highlightedPattern}
              setHighlightedPattern={setHighlightedPattern}
              showPatternMarkers={showPatternMarkers}
              setShowPatternMarkers={setShowPatternMarkers}
              patternMarkerFilter={patternMarkerFilter}
              setPatternMarkerFilter={setPatternMarkerFilter}
              enabledSessions={enabledSessions}
              onToggleSession={handleToggleSession}
              showSessionShading={showSessionShading}
              setShowSessionShading={setShowSessionShading}
              drawings={drawings}
              setDrawings={setDrawings}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              selectedColor={selectedColor}
              setSelectedColor={setSelectedColor}
              onClearDrawings={handleClearDrawings}
              showTradeAnimations={showTradeAnimations}
              setShowTradeAnimations={setShowTradeAnimations}
              showPatternBeams={showPatternBeams}
              setShowPatternBeams={setShowPatternBeams}
              animTradeFilter={animTradeFilter}
              setAnimTradeFilter={setAnimTradeFilter}
              timeframe={timeframe}
              setSelectedTimeframe={(tf) => {
                window.dispatchEvent(new CustomEvent('apexfx:timeframe', { detail: { timeframe: tf } }));
              }}
              isExpandedFullScreen={isExpandedFullScreen}
              setIsExpandedFullScreen={setIsExpandedFullScreen}
              onFitContent={handleFitContent}
              onSnapshot={handleTakeSnapshot}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
