import { TIMEFRAMES, TIME_CONFIG } from '../shared/timeframes';
import React from 'react';
import { useTrading, TradingProvider } from './context/TradingContext';
import { TechnicalIndicatorsState } from './types';
// --- Code-split heavy panes (2026-09-16) -------------------------------------------------------
// Before this, `vite build` emitted ONE 1,334,349-byte JS chunk (385 KB gzipped) because every pane
// — and with them recharts — sat in the entry graph, so the first paint waited on the whole terminal.
// These three are the expensive ones: the chart, and the two panes that pull in recharts. They are not
// needed to render the shell, the HUD, or the watchlist, and a cold Suspense boundary costs one extra
// request only on first open of each pane.
const TradingChart = React.lazy(() => import('./components/TradingChart').then((m) => ({ default: m.TradingChart })));
import { Watchlist } from './components/Watchlist';
import { SignalPanel } from './components/SignalPanel';
const PositionsPanel = React.lazy(() => import('./components/PositionsPanel').then((m) => ({ default: m.PositionsPanel })));
// Also lazy here (not only via PositionsPanel) because it is rendered as a top-level pane on desktop
// and mobile; a static import at either site would drag recharts back into the entry chunk.
const PerformanceDashboard = React.lazy(() => import('./components/PerformanceDashboard').then((m) => ({ default: m.PerformanceDashboard })));
import { PatternPanel } from './components/PatternPanel';
import { WeeklyCalendar } from './components/WeeklyCalendar';
import { AiAssistant } from './components/AiAssistant';
import { SupabaseSync } from './components/SupabaseSync';
import { formatPrice } from './utils/forexData';

/** Keeps every split boundary honest about what it is waiting for (and gives screen readers a state). */
const Lazy: React.FC<{ children: React.ReactNode; label: string; tall?: boolean }> = ({ children, label, tall }) => (
  <React.Suspense
    fallback={
      <div
        role="status"
        aria-busy="true"
        className={`w-full ${tall ? 'h-[620px]' : 'h-24'} rounded-lg border border-zinc-800 bg-zinc-950/60 flex items-center justify-center text-zinc-500 font-mono text-xs animate-pulse`}
      >
        {label}
      </div>
    }
  >
    {children}
  </React.Suspense>
);
// Must be an import, not a '/src/...' string literal: Vite only emits/rewrites assets that are
// imported, so the literal path survived in the production bundle and 404'd (masked by the SPA
// fallback returning index.html with status 200 for a .jpg request).
import appLogo from './assets/images/app_logo_1782444134483.jpg';
import { 
  Activity, 
  Clock, 
  PanelLeft, 
  PanelRight,
  Sun,
  Moon
} from 'lucide-react';

/**
 * This badge used to be a binary LIVE/POLL derived from the socket alone, so a rate-limited or
 * failing feed was indistinguishable from a healthy one (prices just stopped moving, silently).
 * 'degraded' now says so out loud; wsConnected still drives the tooltip-free socket truth.
 */
const FEED_BADGE: Record<'connecting' | 'live' | 'polling' | 'degraded', { label: string; tone: string; dot: string; title: string }> = {
  live:       { label: 'LIVE',     tone: 'text-emerald-400', dot: 'bg-emerald-400 animate-pulse', title: 'Streaming live over WebSocket' },
  polling:    { label: 'POLL',     tone: 'text-amber-500',   dot: 'bg-amber-500',                 title: 'WebSocket unavailable - polling /api/market/prices' },
  degraded:   { label: 'DEGRADED', tone: 'text-rose-400',    dot: 'bg-rose-500 animate-pulse',     title: 'Feed requests failing or rate limited - retrying with backoff' },
  connecting: { label: 'CONNECT',  tone: 'text-zinc-400',    dot: 'bg-zinc-500',                   title: 'Connecting to the market feed' },
};

export default function App() {
  return (
    <TradingProvider>
      <TradingTerminal />
    </TradingProvider>
  );
}

function TradingTerminal() {
  const {
    mobileTab,
    setMobileTab,
    leftSidebarOpen,
    setLeftSidebarOpen,
    rightSidebarOpen,
    setRightSidebarOpen,
    isPending,
    startTransition,
    selectedSymbol,
    selectedTimeframe,
    setSelectedTimeframe,
    indicators,
    handleToggleIndicator,
    feedStatus,
    utcTime,
    liveQuote,
    activeData,
    activePatterns,
    currentPrice,
    volatility,
    priceRange,
    theme,
    toggleTheme
  } = useTrading();

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'} font-sans flex flex-col selection:bg-emerald-600/30`}>
      
      {/* 1. TOP GLOBAL INSTRUMENT BAR / HUD HEADER */}
      <header className={`px-4 py-3 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} border-b flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0`} id="global_header">
        {/* Trademark brand logo */}
        <div className="flex items-center justify-between w-full sm:w-auto gap-4">
          <div className="flex items-center gap-2.5">
            <div className="relative w-9 h-9 rounded-lg overflow-hidden shadow-lg shadow-emerald-950/40 border border-emerald-500/30">
              <img src={appLogo} className="w-full h-full object-cover" alt="ApexFX Logo" referrerPolicy="no-referrer" />
            </div>
            <div>
              <h1 className={`font-display font-black text-base tracking-tight ${theme === 'dark' ? 'text-white' : 'text-zinc-950'} flex items-center gap-1.5 leading-none`}>
                ApexFX <span className="text-emerald-400 text-[10px] font-mono px-1 py-0.5 rounded bg-emerald-950/40 border border-emerald-900/30 uppercase tracking-wider font-bold">Terminal</span>
              </h1>
              <p className={`text-[9px] ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'} font-medium tracking-wider uppercase mt-0.5 font-mono`}>
                Next-Gen Multi-Confluence Engine
              </p>
            </div>
          </div>

          {/* Theme switcher button */}
          <button
            onClick={toggleTheme}
            className={`p-2 rounded-lg transition-all border cursor-pointer flex items-center justify-center ${
              theme === 'dark' 
                ? 'bg-zinc-900 hover:bg-zinc-800 text-amber-400 border-zinc-800 hover:border-zinc-700 shadow-md' 
                : 'bg-white hover:bg-zinc-100 text-indigo-600 border-zinc-200 hover:border-zinc-300 shadow-sm'
            }`}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Session Theme`}
            id="theme_toggle_btn"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Global summary stats ticker row */}
        <div className="hidden lg:flex items-center gap-6 text-xs text-zinc-400 font-mono">
          <div className="space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase block leading-none">Live Segment</span>
            <div className="text-zinc-200 font-semibold flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>Full-Spectrum Scanning</span>
            </div>
          </div>

          <div className="space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase block leading-none">Volume Index</span>
            <div className="text-zinc-200 font-semibold text-right">
              {activeData[activeData.length - 1]?.volume?.toLocaleString() || 'N/A'} lots
            </div>
          </div>

          <div className="space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase block leading-none">Terminal GMT</span>
            <div className="text-emerald-400 font-bold flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>{utcTime || 'SYS TICK'}</span>
            </div>
          </div>

          <div className="space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase block leading-none">Stream Status</span>
            <div
              role="status"
              aria-live="polite"
              aria-label={`Market feed status: ${feedStatus}`}
              title={FEED_BADGE[feedStatus].title}
              className={`font-bold flex items-center gap-1.5 ${FEED_BADGE[feedStatus].tone}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${FEED_BADGE[feedStatus].dot}`} />
              <span className="font-sans text-xs uppercase tracking-tight">{FEED_BADGE[feedStatus].label}</span>
            </div>
          </div>
        </div>

        {/* Selected currency pair quick-display statistics */}
        <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-800/80 rounded-lg py-1.5 px-3 relative">
          <div className="text-left font-mono">
            <span className="text-[9px] text-zinc-500 uppercase block leading-none">Active Pair</span>
            <span className="text-xs font-extrabold text-zinc-200">{selectedSymbol.slice(0, 3)}/{selectedSymbol.slice(3)}</span>
          </div>

          {volatility && (
            <>
              <div className="h-6 w-px bg-zinc-800" />
              <div className="text-left font-mono relative group cursor-help">
                <span className="text-[9px] text-zinc-500 uppercase block leading-none flex items-center gap-1">
                  ATR Risk
                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${
                    volatility.riskLevel === 'LOW' ? 'bg-emerald-400' :
                    volatility.riskLevel === 'MEDIUM' ? 'bg-amber-400' : 'bg-rose-400'
                  }`} />
                </span>
                <span className={`text-xs font-bold leading-tight flex items-center gap-0.5 ${volatility.color}`}>
                  {volatility.formattedAtr}
                  <span className="text-[9px] opacity-75 font-normal">({volatility.riskLevel})</span>
                </span>
                {/* Tooltip on hover */}
                <div className="absolute right-[-10px] sm:right-0 top-full mt-2.5 hidden group-hover:block z-50 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-lg p-2.5 shadow-2xl text-[10px] w-48 leading-relaxed text-zinc-400">
                  <span className="font-bold text-zinc-100 block mb-1">Volatility Analysis</span>
                  <span>Current ATR is <strong className="text-zinc-200">{volatility.formattedAtr}</strong>. This indicates a <strong className={volatility.color}>{volatility.riskLevel} VOLATILITY</strong> environment (Ratio: <strong className="text-zinc-200">{volatility.ratio.toFixed(2)}x</strong> vs hist-avg).</span>
                </div>
              </div>
            </>
          )}

          {priceRange && (
            <>
              <div className="hidden md:block h-6 w-px bg-zinc-800" />
              <div className="hidden md:flex flex-col text-left font-mono text-[10px] w-32 relative group cursor-help">
                <div className="flex justify-between text-[8px] text-zinc-500 uppercase leading-none mb-1">
                  <span>Range Low</span>
                  <span>High</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-semibold text-zinc-400 leading-none">
                    {formatPrice(priceRange.low, selectedSymbol)}
                  </span>
                  <div className="flex-1 h-1.5 bg-zinc-900 rounded-full relative overflow-visible border border-zinc-800/60">
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]" 
                      style={{ left: `calc(${priceRange.percentage}% - 3px)` }}
                    />
                  </div>
                  <span className="text-[9px] font-semibold text-zinc-400 leading-none">
                    {formatPrice(priceRange.high, selectedSymbol)}
                  </span>
                </div>
                {/* Tooltip detail on hover */}
                <div className="absolute right-[-40px] sm:right-1/2 sm:translate-x-1/2 top-full mt-2.5 hidden group-hover:block z-50 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-lg p-2.5 shadow-2xl text-[10px] w-52 leading-relaxed text-zinc-400">
                  <span className="font-bold text-zinc-100 block mb-1">Period Session Range ({selectedTimeframe})</span>
                  <div className="grid grid-cols-2 gap-y-1 gap-x-2 border-b border-zinc-800/60 pb-1.5 mb-1.5 font-mono">
                    <span className="text-zinc-500">Low:</span>
                    <span className="text-zinc-300 font-semibold text-right">{formatPrice(priceRange.low, selectedSymbol)}</span>
                    <span className="text-zinc-500">High:</span>
                    <span className="text-zinc-300 font-semibold text-right">{formatPrice(priceRange.high, selectedSymbol)}</span>
                    <span className="text-zinc-500">Current Price:</span>
                    <span className="text-emerald-400 font-bold text-right">{formatPrice(currentPrice, selectedSymbol)}</span>
                  </div>
                  <span>The active price is at <strong className="text-zinc-200">{priceRange.percentage.toFixed(1)}%</strong> of the current {selectedTimeframe} session range.</span>
                </div>
              </div>
            </>
          )}

          <div className="h-6 w-px bg-zinc-800" />

          <div className="text-right font-mono flex items-center gap-3">
            <div>
              <span className="text-[9px] text-zinc-500 uppercase block leading-none">{liveQuote?.priceBasis === 'mid' ? 'Observed midpoint' : 'Display price'}</span>
              <span className="text-xs font-bold text-zinc-100">{currentPrice > 0 ? formatPrice(currentPrice, selectedSymbol) : '—'}</span>
            </div>
            {liveQuote && (
              <>
                <div className="h-4 w-px bg-zinc-800" />
                <div className="text-right">
                  {/* Label comes from the server's actual source; it used to hardcode
                      "Twelve Data" while the fallback feed was Yahoo. */}
                  <span className="text-[9px] text-zinc-500 uppercase block leading-none">
                    {liveQuote.source ?? 'Unknown'}{liveQuote.priceBasis === 'mid' ? ' · midpoint' : ''} · {liveQuote.instrumentKind ?? 'unknown'} · {liveQuote.quality ?? 'unknown'}
                  </span>
                  <span className={`text-xs font-bold ${liveQuote.dayStatsAvailable === false ? 'text-zinc-200' : Number.isFinite(liveQuote.change) && liveQuote.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    <span className="sr-only">Last observed price: </span>{Number.isFinite(liveQuote.price) && liveQuote.price > 0 ? formatPrice(liveQuote.price, selectedSymbol) : '—'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE / MULTI-GRID LAYOUT */}
      <main className="flex-1 overflow-hidden flex flex-col md:flex-row">
        
        {/* Left Side: Live FX Watchlist (Docked Left on Desktop) */}
        {leftSidebarOpen ? (
          <aside className="hidden md:flex w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 p-3 flex-col gap-3 h-full overflow-y-auto">
            <Watchlist />
          </aside>
        ) : (
          <aside 
            className="hidden md:flex w-12 shrink-0 border-r border-zinc-800 bg-zinc-950 flex-col items-center py-4 h-full cursor-pointer hover:bg-zinc-900 transition-colors group" 
            onClick={() => setLeftSidebarOpen(true)}
            title="Expand Watchlist"
          >
            <PanelLeft className="w-5 h-5 text-zinc-500 group-hover:text-zinc-300" />
            <div className="mt-12 -rotate-90 text-[11px] font-mono tracking-[0.2em] text-zinc-600 group-hover:text-zinc-400 uppercase whitespace-nowrap">
              Watchlist
            </div>
          </aside>
        )}

        {/* Center: Chart Workspace Canvas + controls */}
        <section className="flex-1 bg-zinc-950 border-r border-zinc-800 flex flex-col overflow-y-auto p-4 space-y-4">
          
          {/* Controls Bar: Timeframes, Indicators toggles */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
            {/* Timeframe selector list */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase font-mono font-bold tracking-wide text-zinc-400">Timeframe</span>
              <div className="flex flex-wrap gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 w-fit max-w-full">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    title={TIME_CONFIG[tf].label}
                    aria-pressed={selectedTimeframe === tf}
                    disabled={isPending}
                    onClick={() => {
                      startTransition(() => {
                        setSelectedTimeframe(tf);
                      });
                    }}
                    className={`px-3 py-1 text-xs font-mono font-bold rounded-md transition-all cursor-pointer ${
                      selectedTimeframe === tf
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Indicator Quick-toggles bar */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase font-mono font-bold tracking-wide text-zinc-400">Overlay Indicators</span>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(indicators) as Array<keyof TechnicalIndicatorsState>).map((key) => {
                  const isActive = indicators[key];
                  return (
                    <button
                      key={key}
                      onClick={() => handleToggleIndicator(key)}
                      className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-md border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-zinc-100 text-zinc-950 border-white font-bold'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      {key.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Core Visual Chart pane */}
          {activeData.length > 0 ? (
            <Lazy label="Loading chart…" tall>
              <TradingChart
                data={activeData}
                symbol={selectedSymbol}
                timeframe={selectedTimeframe}
                patterns={activePatterns}
                indicators={indicators}
              />
            </Lazy>
          ) : (
            <div className="w-full h-[620px] rounded-lg border border-zinc-800 bg-zinc-950 flex items-center justify-center text-zinc-500 font-mono text-xs">
              Initializing Forex charting buffer...
            </div>
          )}

          {/* Mobile responsive tab buttons */}
          {/* Mobile Navigation Tabs */}
          <div className="md:hidden grid grid-cols-6 gap-1 bg-zinc-900 p-1 border border-zinc-800 rounded-xl relative z-10 select-none">
            {(['chart', 'watchlist', 'signals', 'trader', 'performance', 'analysis'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                className={`py-2 text-[9px] font-bold text-center capitalize rounded-lg transition-all cursor-pointer ${
                  mobileTab === tab
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Bottom Grid for Secondary Panels (Visible side-by-side on desktop screen dimensions) */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            
            {/* Pattern Scanner and weekly economic calendar */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-1 gap-4">
              <PatternPanel />
              <WeeklyCalendar />
            </div>

            {/* AI Assistant Chat pane */}
            <div className="h-full">
              <AiAssistant />
            </div>

          </div>

          {/* Comprehensive Performance & Telemetry Dashboard */}
          <div className="w-full">
            <Lazy label="Loading performance telemetry…">
              <PerformanceDashboard />
            </Lazy>
          </div>

        </section>

        {/* Right Side: Execution & Trade Signal Analysis Deck (Hidden on Mobile, tabs manage toggle) */}
        {rightSidebarOpen ? (
          <aside className="hidden md:flex w-80 shrink-0 border-l border-zinc-800 bg-zinc-950 p-4 flex-col gap-4 h-full overflow-y-auto">
            <SignalPanel />
            <Lazy label="Loading positions…">
              <PositionsPanel />
            </Lazy>
            <SupabaseSync />
          </aside>
        ) : (
          <aside 
            className="hidden md:flex w-12 shrink-0 border-l border-zinc-800 bg-zinc-950 flex-col items-center py-4 h-full cursor-pointer hover:bg-zinc-900 transition-colors group" 
            onClick={() => setRightSidebarOpen(true)}
            title="Expand Tools"
          >
            <PanelRight className="w-5 h-5 text-zinc-500 group-hover:text-zinc-300" />
            <div className="mt-12 -rotate-90 text-[11px] font-mono tracking-[0.2em] text-zinc-600 group-hover:text-zinc-400 uppercase whitespace-nowrap">
              Trade Tools
            </div>
          </aside>
        )}

        {/* Mobile Tab Overlay displays */}
        <div className={`md:hidden flex-1 ${mobileTab !== 'chart' ? 'block' : 'hidden'} p-4 bg-zinc-950 overflow-y-auto space-y-4`}>
          {mobileTab === 'watchlist' && (
            <Watchlist />
          )}

          {mobileTab === 'signals' && (
            <SignalPanel />
          )}

          {mobileTab === 'trader' && (
            <div className="space-y-4">
              <Lazy label="Loading positions…">
                <PositionsPanel />
              </Lazy>
              <SupabaseSync />
            </div>
          )}

          {mobileTab === 'performance' && (
            <Lazy label="Loading performance telemetry…">
              <PerformanceDashboard />
            </Lazy>
          )}

          {mobileTab === 'analysis' && (
            <div className="space-y-4">
              <AiAssistant />
              <PatternPanel />
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

