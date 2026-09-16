import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Camera, Maximize2, Minimize2, SlidersHorizontal, Bell, Plus, Trash2, Calendar } from 'lucide-react';
import type { Candlestick, Timeframe } from '../../types';
import type { ChartTheme, DrawingTool } from '../../types/chart';
import { playPriceAlertSound } from '../../utils/soundAlerts';

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

interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: 'above' | 'below';
  createdAt: number;
  triggered?: boolean;
}

interface EconomicRadarEvent {
  title: string;
  currency: string;
  impact: 'High' | 'Medium' | 'Low';
  minutesUntil: number;
  forecast?: string;
  previous?: string;
}

const ACTIVE_TOOL_HINTS: Record<DrawingTool, string | null> = {
  none: null,
  cursor_crosshair: null,
  cursor_dot: null,
  cursor_arrow: null,
  cursor_eraser: 'Click on any drawing to erase/delete it',
  horizontal: 'Click chart to place Support/Resistance Level',
  horizontal_ray: 'Click chart to place Horizontal Ray',
  vertical_line: 'Click chart to place Vertical Time Marker',
  trendline_start: 'Click chart for Trendline START point',
  trendline_end: 'Click chart for Trendline END point',
  channel_p1: 'Click point 1 for Parallel Channel baseline',
  channel_p2: 'Click point 2 for Parallel Channel baseline',
  channel_p3: 'Click to set Parallel Channel width',
  fib_start: 'Click chart for Fibonacci START pivot',
  fib_end: 'Click chart for Fibonacci END pivot',
  fib_ext_p1: 'Click point 1 (Swing Start) for Fib Extension',
  fib_ext_p2: 'Click point 2 (Swing End) for Fib Extension',
  fib_ext_p3: 'Click point 3 (Retracement Pivot) for Fib Extension',
  gann_box_p1: 'Click start corner for Gann Box',
  gann_box_p2: 'Click opposite corner for Gann Box',
  pattern_hs_p1: 'Click Left Shoulder for Head & Shoulders',
  pattern_hs_p2: 'Click Head peak for Head & Shoulders',
  pattern_hs_p3: 'Click Right Shoulder for Head & Shoulders',
  pattern_hs_p4: 'Click Neckline confirmation level',
  pattern_xabcd_p1: 'Click Point X for Harmonic Pattern',
  pattern_xabcd_p2: 'Click Point A for Harmonic Pattern',
  pattern_xabcd_p3: 'Click Point B for Harmonic Pattern',
  pattern_xabcd_p4: 'Click Point C for Harmonic Pattern',
  pattern_xabcd_p5: 'Click Point D (PRZ Target Zone)',
  pattern_elliott_p1: 'Click Wave (1) Peak',
  pattern_elliott_p2: 'Click Wave (2) Pullback',
  pattern_elliott_p3: 'Click Wave (3) Expansion',
  pattern_elliott_p4: 'Click Wave (4) Retracement',
  pattern_elliott_p5: 'Click Wave (5) Crest',
  rr_long: 'Click chart to place Long Position entry',
  rr_short: 'Click chart to place Short Position entry',
  ruler_start: 'Click starting bar for Price/Time Measurement',
  ruler_end: 'Click ending bar to complete Measurement',
  projection_start: 'Click starting price for Projection',
  projection_end: 'Click forecast target price',
  rect_start: 'Click corner 1 for Supply/Demand Rectangle',
  rect_end: 'Click opposite corner for Rectangle',
  circle_start: 'Click center of Circle / Inflection',
  circle_end: 'Click outer edge to set Circle radius',
  brush: 'Click chart to sketch freehand marker',
  annotation: 'Click chart to add Custom Text label',
  callout: 'Click chart to place Speech Callout bubble',
  price_label: 'Click chart to snap Price Label flag',
  arrow_up: 'Click chart to place Bullish Arrow marker',
  arrow_down: 'Click chart to place Bearish Arrow marker',
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

  // Price Alerts State
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => {
    try {
      const saved = localStorage.getItem('apexfx_price_alerts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newAlertPrice, setNewAlertPrice] = useState<string>('');
  const [alertNotice, setAlertNotice] = useState<string | null>(null);

  // Economic News Radar State
  const [upcomingEvent, setUpcomingEvent] = useState<EconomicRadarEvent | null>(null);
  const [showEventDetails, setShowEventDetails] = useState(false);
  const prevPriceRef = useRef<number | null>(null);

  // Sync alerts to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('apexfx_price_alerts', JSON.stringify(alerts));
    } catch {
      // ignore
    }
  }, [alerts]);

  // Monitor price changes against active alerts
  useEffect(() => {
    if (!last || typeof last.close !== 'number') return;
    const currentPrice = last.close;
    const prevPrice = prevPriceRef.current;
    prevPriceRef.current = currentPrice;

    if (prevPrice === null) return;

    setAlerts((prevAlerts) =>
      prevAlerts.map((alert) => {
        if (alert.symbol !== symbol || alert.triggered) return alert;

        let triggered = false;
        if (alert.direction === 'above' && prevPrice < alert.targetPrice && currentPrice >= alert.targetPrice) {
          triggered = true;
        } else if (alert.direction === 'below' && prevPrice > alert.targetPrice && currentPrice <= alert.targetPrice) {
          triggered = true;
        }

        if (triggered) {
          playPriceAlertSound();
          setAlertNotice(`Price Alert Triggered: ${symbol} reached ${alert.targetPrice}!`);
          setTimeout(() => setAlertNotice(null), 6000);
          return { ...alert, triggered: true };
        }
        return alert;
      })
    );
  }, [last, symbol]);

  // Fetch upcoming economic releases for active pair
  useEffect(() => {
    let cancelled = false;
    const fetchRadar = async () => {
      try {
        const res = await fetch('/api/market/calendar');
        if (!res.ok) return;
        const json = await res.json();
        const events: Array<{
          title: string;
          country: string;
          impact: 'High' | 'Medium' | 'Low';
          date: string;
          forecast: string;
          previous: string;
        }> = Array.isArray(json) ? json : (json?.data || []);

        if (cancelled) return;
        const base = symbol.slice(0, 3);
        const quote = symbol.length === 6 ? symbol.slice(3) : '';
        const now = Date.now();

        const upcoming = events
          .filter((e) => {
            if (e.impact !== 'High' && e.impact !== 'Medium') return false;
            if (e.country !== base && e.country !== quote) return false;
            const diffMin = (new Date(e.date).getTime() - now) / 60000;
            return diffMin > 0 && diffMin <= 120;
          })
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

        if (upcoming) {
          const diffMin = Math.round((new Date(upcoming.date).getTime() - now) / 60000);
          setUpcomingEvent({
            title: upcoming.title,
            currency: upcoming.country,
            impact: upcoming.impact,
            minutesUntil: diffMin,
            forecast: upcoming.forecast,
            previous: upcoming.previous,
          });
        } else {
          setUpcomingEvent(null);
        }
      } catch {
        // silent fail
      }
    };

    fetchRadar();
    const interval = setInterval(fetchRadar, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  const activeAlertsForSymbol = alerts.filter((a) => a.symbol === symbol && !a.triggered);

  const handleCreateAlert = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseFloat(newAlertPrice);
    if (isNaN(p) || p <= 0 || !last) return;

    const dir = p >= last.close ? 'above' : 'below';
    const newAlert: PriceAlert = {
      id: Math.random().toString(36).substring(2, 9),
      symbol,
      targetPrice: p,
      direction: dir,
      createdAt: Date.now(),
      triggered: false,
    };

    setAlerts((prev) => [newAlert, ...prev]);
    setNewAlertPrice('');
  };

  const handleDeleteAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className={`relative flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'} border rounded-lg py-2 px-3.5 shadow-md`}>
      {/* Toast Alert Notice */}
      {alertNotice && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-zinc-950 font-mono font-bold text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 animate-bounce">
          <Bell className="w-3.5 h-3.5 animate-spin" />
          <span>{alertNotice}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className={`font-display font-black text-sm ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'} flex items-center gap-1.5 leading-none`}>
          {symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol}
          <span className="text-emerald-400 text-[10px] px-1 py-0.5 rounded bg-emerald-950/40 border border-emerald-900/30 uppercase font-mono">{timeframe}</span>
          <span className="hidden xl:inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/50" title="TradingView Lightweight Charts v5.2 Canvas Engine Active">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            TradingView™ v5.2
          </span>
        </span>

        {/* Economic News Radar Pill */}
        {upcomingEvent && (
          <div className="relative">
            <button
              onClick={() => setShowEventDetails(!showEventDetails)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-all ${
                upcomingEvent.impact === 'High'
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-700 animate-pulse'
                  : 'bg-amber-950/80 text-amber-300 border border-amber-700'
              }`}
              title="Click to view upcoming economic release details"
            >
              <Calendar className="w-3 h-3" />
              <span>{upcomingEvent.currency} {upcomingEvent.title} in {upcomingEvent.minutesUntil}m</span>
            </button>

            {showEventDetails && (
              <div className="absolute top-7 left-0 z-50 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono shadow-xl w-64 space-y-1.5">
                <div className="flex justify-between items-center text-zinc-400 text-[10px]">
                  <span>IMPACT: <strong className={upcomingEvent.impact === 'High' ? 'text-rose-400' : 'text-amber-400'}>{upcomingEvent.impact}</strong></span>
                  <span>{upcomingEvent.minutesUntil} min remaining</span>
                </div>
                <div className="font-bold text-zinc-100">{upcomingEvent.currency}: {upcomingEvent.title}</div>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-400 pt-1 border-t border-zinc-800">
                  <div>Forecast: <span className="text-zinc-200">{upcomingEvent.forecast || 'N/A'}</span></div>
                  <div>Prior: <span className="text-zinc-200">{upcomingEvent.previous || 'N/A'}</span></div>
                </div>
              </div>
            )}
          </div>
        )}

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

        {/* Price Alerts Quick Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAlertModal(!showAlertModal)}
            className={`p-1.5 px-2 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-mono font-bold ${
              activeAlertsForSymbol.length > 0
                ? 'bg-amber-950/50 text-amber-300 border-amber-800/80 shadow-sm'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800 hover:border-zinc-700'
            }`}
            title="Set Price Alert with Web Audio chime"
          >
            <Bell className={`w-3.5 h-3.5 ${activeAlertsForSymbol.length > 0 ? 'text-amber-400 animate-bounce' : 'text-zinc-400'}`} />
            <span className="hidden sm:inline">Alert</span>
            {activeAlertsForSymbol.length > 0 && (
              <span className="text-[10px] px-1 py-0.2 rounded-full font-mono bg-amber-500 text-zinc-950 font-bold">
                {activeAlertsForSymbol.length}
              </span>
            )}
          </button>

          {showAlertModal && (
            <div className="absolute right-0 top-10 z-50 w-72 bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 shadow-2xl space-y-3 animate-fade-in font-mono text-xs">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="font-bold text-zinc-100 flex items-center gap-1">
                  <Bell className="w-3.5 h-3.5 text-amber-400" /> Price Alerts ({symbol})
                </span>
                <button
                  onClick={() => setShowAlertModal(false)}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateAlert} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="any"
                    value={newAlertPrice}
                    onChange={(e) => setNewAlertPrice(e.target.value)}
                    placeholder={last ? `e.g. ${last.close}` : 'Target Price'}
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Set
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500">
                  Current: {last?.close || 'Loading...'} • Fires Web Audio Chime
                </div>
              </form>

              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {alerts.filter((a) => a.symbol === symbol).length === 0 ? (
                  <div className="text-[10px] text-zinc-500 text-center py-2">
                    No alerts set for {symbol}
                  </div>
                ) : (
                  alerts
                    .filter((a) => a.symbol === symbol)
                    .map((a) => (
                      <div
                        key={a.id}
                        className={`flex items-center justify-between p-1.5 rounded text-[11px] border ${
                          a.triggered
                            ? 'bg-zinc-900/40 border-zinc-800 text-zinc-500 line-through'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-200'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={a.direction === 'above' ? 'text-emerald-400' : 'text-rose-400'}>
                            {a.direction === 'above' ? '▲ ≥' : '▼ ≤'}
                          </span>
                          <span>{a.targetPrice}</span>
                          {a.triggered && <span className="text-[9px] text-amber-500 no-underline font-normal">(Fired)</span>}
                        </div>
                        <button
                          onClick={() => handleDeleteAlert(a.id)}
                          className="text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </div>

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
