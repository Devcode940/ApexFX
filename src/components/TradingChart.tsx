import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { IChartApi } from 'lightweight-charts';
import { AnimatePresence } from 'motion/react';
import type { Candlestick, Pattern, TechnicalIndicatorsState, Timeframe } from '../types';
import { useTrading } from '../context/TradingContext';
import {
  ForexSessionKey,
  generateSessionBlocks,
} from '../utils/forexSessions';
import type {
  AnimTradeFilter,
  AnimatedTrade,
  ChartPoint,
  ChartTheme,
  DrawingTool,
  HudData,
  PatternMarkerFilter,
  SidebarTab,
} from '../types/chart';
import { EMPTY_DRAWINGS } from '../types/chart';
import { useChartCore } from '../hooks/useChartCore';
import { hasUtcBucketGrid } from '../utils/candles';
import { useScopedDrawings } from '../hooks/useScopedDrawings';
import { copySnapshot, SNAPSHOT_COPY_MESSAGE } from '../utils/clipboard';
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
  const { theme: globalTheme, positions, closedTrades, handleChartSnapshot, handleToggleIndicator, account, historyStatus, historyError, historyMeta, retryHistory, liveQuote } = useTrading();
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
  const { drawings, setDrawings, drawingError, importLegacyDrawings } = useScopedDrawings(symbol, account.owner);
  // What the clipboard actually did, for the last few seconds. Replaces a `catch { }` that made a failed
  // copy indistinguishable from a successful one.
  const [snapshotNote, setSnapshotNote] = useState<string>('');
  const snapshotNoteTimer = useRef<number | undefined>(undefined);
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
    if (patternMarkerFilter === 'high_confluence') {
      return patterns.filter((p) => p.confluence && p.confluence >= 60);
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
      pnl: p.pnl, pnlVersion: p.pnlVersion, pnlQuote: p.pnlQuote, quoteCurrency: p.quoteCurrency,
      time: p.time,
      isClosed: false,
    })));
    list.push(...closedList.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      type: t.type,
      entryPrice: t.entryPrice,
      amount: t.amount,
      pnl: t.pnl, pnlVersion: t.pnlVersion, pnlQuote: t.pnlQuote, quoteCurrency: t.quoteCurrency,
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

  useEffect(() => {
    setTrendlineStart(null); setFibStart(null); setActiveTool('none');
  }, [symbol, account.owner]);

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
  const handleTakeSnapshot = useCallback(async () => {
    if (!chartRef.current) return;
    const canvas = chartRef.current.takeScreenshot();
    const imageDataUrl = canvas.toDataURL('image/png');

    // Policy lives in utils/clipboard (unit-tested): real image first, data-URL text as a labelled
    // fallback, and an honest outcome when the browser refuses. Never throws.
    const outcome = await copySnapshot({
      canvas,
      dataUrl: imageDataUrl,
      clipboard: navigator.clipboard,
      ClipboardItem: typeof window !== 'undefined' ? window.ClipboardItem : undefined,
    });
    setSnapshotNote(SNAPSHOT_COPY_MESSAGE[outcome]);
    window.clearTimeout(snapshotNoteTimer.current);
    snapshotNoteTimer.current = window.setTimeout(() => setSnapshotNote(''), 4000);

    // Attach the snapshot to the AI assistant (context state + scroll into view). The old extra channel,
    // a window CustomEvent named 'apexfx:snapshot', is gone: nothing in src/ ever listened for it, and an
    // unobserved event is how a feature looks alive while being dead.
    handleChartSnapshot(imageDataUrl);
    // handleChartSnapshot is a stable useCallback([]) from context, so adding it costs nothing
    // and removes the stale-closure hazard exhaustive-deps was flagging.
  }, [handleChartSnapshot]);

  useEffect(() => () => window.clearTimeout(snapshotNoteTimer.current), []);

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
  }, [setDrawings]);

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

      <div className="flex flex-wrap gap-2 text-[10px] text-zinc-400" role="status">
        <span>Chart: {historyMeta?.provider ?? 'unknown'} · {historyMeta?.instrumentKind ?? 'unknown'} · {data.at(-1)?.provisional ? 'partial observed bar' : 'provider history'}</span>
        {historyMeta?.provider === 'demo' && <span className="text-amber-400">Synthetic demo series — not provider data; trading is disabled.</span>}
        {historyMeta && liveQuote && (historyMeta.instrumentKind !== liveQuote.instrumentKind || historyMeta.provider !== liveQuote.source || historyMeta.providerSymbol !== liveQuote.providerSymbol) && <span className="text-amber-400">Quote/chart source mismatch — prices are not merged.</span>}
        {timeframe === 'W' && <span>W: available daily OHLC · Monday–Sunday UTC · current / incomplete first week is provisional.</span>}
        {!hasUtcBucketGrid(data, timeframe) && <span>Non-UTC provider grid: history refresh only; quote buckets are not mixed.</span>}
        {historyError && <span className="text-amber-400">{historyError}</span>}
        <button className="underline" onClick={retryHistory} disabled={historyStatus === 'loading'}>Retry / refresh history</button>
        <button className="underline" onClick={() => { if (!window.confirm('Import legacy drawings for this symbol into the current guest/account namespace?')) return; try { importLegacyDrawings(); } catch (error) { setSnapshotNote(String(error)); } }}>Import legacy drawings</button>
        {drawingError && <span className="text-amber-400">{drawingError}</span>}
      </div>
      {snapshotNote && (
        <div
          role="status"
          aria-live="polite"
          className="self-start -mt-0.5 rounded border border-zinc-800 bg-zinc-950/80 px-2 py-1 text-[10px] font-mono text-zinc-400"
        >
          {snapshotNote}
        </div>
      )}

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
                <span className="text-xs font-mono font-semibold">{historyStatus === 'loading' ? 'Loading historical candles…' : 'Historical candles unavailable'}</span>
                <span className="text-[10px] font-mono opacity-70">{historyError ?? 'No valid historical bars yet. Use Retry / refresh history above.'}</span>
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
