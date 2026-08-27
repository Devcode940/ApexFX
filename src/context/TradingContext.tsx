import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useTransition } from 'react';
import { 
  WatchlistItem, 
  Timeframe, 
  TechnicalIndicatorsState, 
  TradePosition, 
  ClosedTrade, 
  Pattern, 
  TradingSignal,
  Candlestick,
  LiveQuote
} from '../types';
import {
  createWatchlistFromConfig,
  detectPatterns,
  generateSignal,
  calculateVolatilityDetails,
  getContractSize,
  VolatilityDetails
} from '../utils/forexData';

interface TradingContextType {
  // Mobile / Navigation Tabs
  mobileTab: 'chart' | 'watchlist' | 'signals' | 'trader' | 'performance' | 'analysis';
  setMobileTab: React.Dispatch<React.SetStateAction<'chart' | 'watchlist' | 'signals' | 'trader' | 'performance' | 'analysis'>>;
  leftSidebarOpen: boolean;
  setLeftSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;

  // Core Market State
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
  selectedTimeframe: Timeframe;
  setSelectedTimeframe: (timeframe: Timeframe) => void;
  chartData: Record<string, Record<string, Candlestick[]>>;
  setChartData: React.Dispatch<React.SetStateAction<Record<string, Record<string, Candlestick[]>>>>;
  watchlistItems: WatchlistItem[];
  setWatchlistItems: React.Dispatch<React.SetStateAction<WatchlistItem[]>>;
  indicators: TechnicalIndicatorsState;
  handleToggleIndicator: (key: keyof TechnicalIndicatorsState) => void;
  highlightedPattern: Pattern | null;
  setHighlightedPattern: React.Dispatch<React.SetStateAction<Pattern | null>>;
  aiSnapshot: string | null;
  handleChartSnapshot: (dataUrl: string) => void;
  onClearAttachedImage: () => void;
  wsConnected: boolean;
  positions: TradePosition[];
  setPositions: React.Dispatch<React.SetStateAction<TradePosition[]>>;
  closedTrades: ClosedTrade[];
  setClosedTrades: React.Dispatch<React.SetStateAction<ClosedTrade[]>>;
  handleClearHistory: () => void;
  tickStates: Record<string, 'up' | 'down' | 'none'>;
  utcTime: string;
  liveQuote: LiveQuote | null;
  isRefreshingSignal: boolean;
  handleRefreshSignal: () => void;

  // Derived state
  activeData: Candlestick[];
  currentPrice: number;
  activePatterns: Pattern[];
  activeSignal: TradingSignal | null;
  volatility: VolatilityDetails | null;
  priceRange: {
    low: number;
    high: number;
    percentage: number;
  } | null;

  // Handlers
  handleOpenPosition: (type: 'BUY' | 'SELL', amount: number, sl?: number, tp?: number) => void;
  handleClosePosition: (id: string) => void;

  // Theme Settings
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export const TradingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation for tabbed sidebar on mobile
  const [mobileTab, setMobileTab] = useState<'chart' | 'watchlist' | 'signals' | 'trader' | 'performance' | 'analysis'>('chart');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Theme preference state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('forexinsight_theme') as 'dark' | 'light') || 'dark';
  });

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('forexinsight_theme', next);
      return next;
    });
  };

  // Core State
  const [selectedSymbol, setSelectedSymbol] = useState<string>('EURUSD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1H');
  const [chartData, setChartData] = useState<Record<string, Record<string, Candlestick[]>>>({});
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>(() => createWatchlistFromConfig());
  const [indicators, setIndicators] = useState<TechnicalIndicatorsState>(() => {
    const cached = localStorage.getItem('forexinsight_preferred_indicators');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          return {
            sma: parsed.sma ?? true,
            ema: parsed.ema ?? true,
            rsi: parsed.rsi ?? true,
            macd: parsed.macd ?? false,
            bollinger: parsed.bollinger ?? false,
            fibonacci: parsed.fibonacci ?? false,
          };
        }
      } catch (e) {
        console.error('Failed to parse cached indicators', e);
      }
    }
    return {
      sma: true,
      ema: true,
      rsi: true,
      macd: false,
      bollinger: false,
      fibonacci: false,
    };
  });

  // Highlighted Candlestick Pattern
  const [highlightedPattern, setHighlightedPattern] = useState<Pattern | null>(null);

  // AI Assistant Chart Snapshot state
  const [aiSnapshot, setAiSnapshot] = useState<string | null>(null);

  const handleChartSnapshot = React.useCallback((dataUrl: string) => {
    setAiSnapshot(dataUrl);
    // Auto switch tab to analysis on mobile
    setMobileTab('analysis');
    // Smooth scroll to the AI assistant component
    setTimeout(() => {
      const aiElem = document.getElementById('ai_assistant_component');
      if (aiElem) {
        aiElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
  }, []);

  const onClearAttachedImage = React.useCallback(() => {
    setAiSnapshot(null);
  }, []);

  // WebSocket connection state
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  // Paper Position Simulator (Read from LocalStorage or empty)
  const [positions, setPositions] = useState<TradePosition[]>(() => {
    const cached = localStorage.getItem('forexinsight_positions');
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  // Closed trades history (Read from LocalStorage or empty — no demo data)
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>(() => {
    const cached = localStorage.getItem('forexinsight_closed_trades');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        // Ignore corrupted cache
      }
    }
    return [];
  });

  // Watchlist Tick Visual Flashes state
  const [tickStates, setTickStates] = useState<Record<string, 'up' | 'down' | 'none'>>({});

  // Live mirror of watchlistItems for stable callbacks / intervals (WS, polling, sim ticks)
  const watchlistRef = useRef(watchlistItems);
  useEffect(() => {
    watchlistRef.current = watchlistItems;
  }, [watchlistItems]);

  // Clock
  const [utcTime, setUtcTime] = useState<string>('');

  // Live Twelve Data Quote
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);

  // Signal Refresh Animation State
  const [isRefreshingSignal, setIsRefreshingSignal] = useState<boolean>(false);

  // --- Clock updater ---
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(now.toUTCString().replace('GMT', 'UTC'));
    };
    updateTime();
    const sub = setInterval(updateTime, 1000);
    return () => clearInterval(sub);
  }, []);

  // --- Fetch Twelve Data Quote for Active Symbol ---
  useEffect(() => {
    const fetchQuote = async () => {
      try {
        const symbolFormat = selectedSymbol.slice(0, 3) + '/' + selectedSymbol.slice(3);
        const response = await fetch(`/api/market/quote?symbol=${symbolFormat}`);
        const data = await response.json();
        if (response.ok && data.price) {
          setLiveQuote(data);
        } else {
          setLiveQuote(null);
        }
      } catch (err) {
        setLiveQuote(null);
      }
    };
    fetchQuote();
    const sub = setInterval(fetchQuote, 60000); // refresh every minute
    return () => clearInterval(sub);
  }, [selectedSymbol]);

  // --- Fetch real exchange rates from Frankfurter/ForexRate API on mount ---
  useEffect(() => {
    const fetchRealRates = async () => {
      try {
        // First try the user-provided ForexRate API
        const frResponse = await fetch('/api/market/forexrate');
        const frData = await frResponse.json();
        let rates = null;
        
        if (frResponse.ok && frData.rates) {
          rates = frData.rates;
        } else {
          // Fallback to Frankfurter
          const response = await fetch('/api/forex');
          const data = await response.json();
          if (data.success && data.rates) rates = data.rates;
        }

        if (rates) {
          setWatchlistItems((prevItems) => {
            return prevItems.map((item) => {
              const realPrice = rates[item.symbol];
              if (realPrice) {
                return {
                  ...item,
                  price: realPrice,
                };
              }
              return item;
            });
          });
        }
      } catch (err) {
        console.warn('Live forex rates API unavailable; prices will come from the real-time feed once it connects.', err);
      }
    };
    fetchRealRates();
  }, []);

  // --- Real-time price updates via WebSocket streaming with Polling Fallback ---
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let pollingInterval: any = null;

    const handlePricesUpdate = (rates: Record<string, any>) => {
      const prevItems = watchlistRef.current;
      const nextTickStates: Record<string, 'up' | 'down' | 'none'> = {};
      const updated = prevItems.map((item) => {
        const update = rates[item.symbol];
        if (update) {
          const priceDiff = update.price - item.price;
          if (item.price === 0) {
            nextTickStates[item.symbol] = 'none';
          } else {
            nextTickStates[item.symbol] = priceDiff > 0 ? 'up' : (priceDiff < 0 ? 'down' : 'none');
          }
          return {
            ...item,
            price: update.price,
            high: update.high,
            low: update.low,
            change: update.change,
          };
        }
        return item;
      });

      setWatchlistItems(updated);
      setTickStates((prevFlashes) => {
        const nextFlashes = { ...prevFlashes };
        Object.keys(nextTickStates).forEach((sym) => {
          if (nextTickStates[sym] !== 'none') {
            nextFlashes[sym] = nextTickStates[sym];
          }
        });
        return nextFlashes;
      });
    };

    const startPolling = () => {
      if (pollingInterval) return;
      console.log('[Fallback Polling] Starting background HTTP polling for market rates...');
      pollingInterval = setInterval(async () => {
        try {
          const response = await fetch('/api/market/prices');
          const data = await response.json();
          if (response.ok && data.success && data.rates) {
            handlePricesUpdate(data.rates);
          }
        } catch (e) {
          // Silent catch to prevent console error spam
        }
      }, 2500);
    };

    const stopPolling = () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('[Fallback Polling] Stopped background HTTP polling (WebSocket active)');
      }
    };

    const connect = () => {
      if (cancelled) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setWsConnected(true);
          stopPolling();
          console.log('[WebSocket] Real-time rates stream connected');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'INITIAL_RATES' || data.type === 'PRICE_UPDATE') {
              handlePricesUpdate(data.rates);
            }
          } catch (e) {
            console.warn('[WebSocket] Message parsing error:', e);
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          startPolling();
          if (!cancelled) {
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };

        ws.onerror = (err) => {
          console.warn('[WebSocket] Connection failed. Fallback polling is keeping the prices live.', err);
          ws?.close();
        };
      } catch (err) {
        console.warn('[WebSocket] Setup failed:', err);
        startPolling();
        if (!cancelled) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    };

    let cancelled = false;

    connect();
    // Start polling immediately so that we have live prices even if WebSocket is blocked or connecting
    startPolling();

    return () => {
      cancelled = true;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, []);

  // --- Sync local storage for positions ledger ---
  useEffect(() => {
    localStorage.setItem('forexinsight_positions', JSON.stringify(positions));
  }, [positions]);

  // --- Sync local storage for closed trades ---
  useEffect(() => {
    localStorage.setItem('forexinsight_closed_trades', JSON.stringify(closedTrades));
  }, [closedTrades]);

  // --- Sync local storage for preferred chart indicators ---
  useEffect(() => {
    localStorage.setItem('forexinsight_preferred_indicators', JSON.stringify(indicators));
  }, [indicators]);

  // --- Lazy load historical data on Symbol / Timeframe switch ---
  const activeData = useMemo(() => {
    if (!chartData[selectedSymbol]?.[selectedTimeframe]) {
      return [];
    }
    return chartData[selectedSymbol][selectedTimeframe];
  }, [chartData, selectedSymbol, selectedTimeframe]);

  useEffect(() => {
    let active = true;
    async function fetchHistory() {
      try {
        const response = await fetch(`/api/market/history?symbol=${selectedSymbol}&timeframe=${selectedTimeframe}`);
        const result = await response.json();
        if (active) {
          if (result.success && Array.isArray(result.data) && result.data.length > 0) {
            setChartData((prev) => ({
              ...prev,
              [selectedSymbol]: {
                ...(prev[selectedSymbol] || {}),
                [selectedTimeframe]: result.data,
              }
            }));
          } else {
            console.warn('Real history failed or empty.');
            setChartData((prev) => ({
              ...prev,
              [selectedSymbol]: {
                ...(prev[selectedSymbol] || {}),
                [selectedTimeframe]: [],
              }
            }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch historical data:', err);
        if (active) {
          setChartData((prev) => ({
            ...prev,
            [selectedSymbol]: {
              ...(prev[selectedSymbol] || {}),
              [selectedTimeframe]: [],
            }
          }));
        }
      }
    }

    if (!chartData[selectedSymbol]?.[selectedTimeframe]) {
      fetchHistory();
    }
    // Clear pattern highlights when switched
    setHighlightedPattern(null);

    return () => {
      active = false;
    };
  }, [selectedSymbol, selectedTimeframe]);

  // --- Central Dynamic Price Ticking loop ---

  // Clear tick flashes shortly after they appear (driven by state, not updater side-effects)
  useEffect(() => {
    const hasActiveFlash = Object.values(tickStates).some((s) => s !== 'none');
    if (!hasActiveFlash) return;

    const timer = setTimeout(() => {
      setTickStates((s) => {
        const cleared = { ...s };
        Object.keys(cleared).forEach((k) => {
          if (cleared[k] !== 'none') cleared[k] = 'none';
        });
        return cleared;
      });
    }, 900);

    return () => clearTimeout(timer);
  }, [tickStates]);

  // --- Update chart candlesticks and paper positions on price change ---
  const activeWatchItem = useMemo(() => {
    return watchlistItems.find((item) => item.symbol === selectedSymbol);
  }, [watchlistItems, selectedSymbol]);

  const currentPrice = useMemo(() => {
    // Prefer the live quote; fall back to the latest real close from history.
    // Never fabricate a placeholder price.
    if (activeWatchItem && activeWatchItem.price > 0) {
      return activeWatchItem.price;
    }
    const series = chartData[selectedSymbol]?.[selectedTimeframe];
    if (series && series.length > 0) {
      return series[series.length - 1].close;
    }
    return 0;
  }, [activeWatchItem, selectedSymbol, chartData, selectedTimeframe]);

  useEffect(() => {
    if (activeData.length === 0) return;

    // A. Update active chart's very last candlestick to fluctuate with live watch list price
    setChartData((prev) => {
      const currentInstrument = prev[selectedSymbol];
      if (!currentInstrument) return prev;

      const currentTimeframeSeries = currentInstrument[selectedTimeframe];
      if (!currentTimeframeSeries || currentTimeframeSeries.length === 0) return prev;

      const updatedSeries = [...currentTimeframeSeries];
      const lastIndex = updatedSeries.length - 1;
      const lastCandle = updatedSeries[lastIndex];

      updatedSeries[lastIndex] = {
        ...lastCandle,
        close: currentPrice,
        high: Math.max(lastCandle.high, currentPrice),
        low: Math.min(lastCandle.low, currentPrice),
      };

      return {
        ...prev,
        [selectedSymbol]: {
          ...currentInstrument,
          [selectedTimeframe]: updatedSeries,
        }
      };
    });
  }, [currentPrice, selectedSymbol, selectedTimeframe, activeData.length]);

  // B. Calculate profits and losses for open ledger paper positions and SL/TP hits in real-time
  useEffect(() => {
    let nextDifferent = false;
    const closedToLog: ClosedTrade[] = [];

    const nextPositions = positions.map((pos) => {
      const priceItem = watchlistItems.find((item) => item.symbol === pos.symbol);
      if (!priceItem) return pos;

      const livePrice = priceItem.price;
      const contractSize = getContractSize(pos.symbol);

      // Calculate direct leverage gain / loss in USD units
      let pnl = parseFloat(((pos.type === 'BUY' ? (livePrice - pos.entryPrice) : (pos.entryPrice - livePrice)) * pos.amount * contractSize).toFixed(2));

      // Automatic SL / TP hits simulation trigger check
      const isSlHit = pos.sl !== undefined && (pos.type === 'BUY' ? livePrice <= pos.sl : livePrice >= pos.sl);
      const isTpHit = pos.tp !== undefined && (pos.type === 'BUY' ? livePrice >= pos.tp : livePrice <= pos.tp);

      if (isSlHit || isTpHit) {
        const exitPrice = isSlHit ? pos.sl! : pos.tp!;
        const reason = isSlHit ? 'SL Hit' : 'TP Hit';
        const exitPnl = parseFloat(((pos.type === 'BUY' ? (exitPrice - pos.entryPrice) : (pos.entryPrice - exitPrice)) * pos.amount * contractSize).toFixed(2));
        const nowMs = Date.now();
        const openTimeMs = pos.openedAt || (nowMs - 3600000);
        const duration = Math.max(1000, nowMs - openTimeMs);

        closedToLog.push({
          id: `closed_${nowMs}_${Math.random().toString(36).substr(2, 4)}`,
          symbol: pos.symbol,
          type: pos.type,
          entryPrice: pos.entryPrice,
          exitPrice,
          amount: pos.amount,
          pnl: exitPnl,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          closeReason: reason,
          openedAt: openTimeMs,
          closedAt: nowMs,
          durationMs: duration,
        });
        nextDifferent = true;
        return null;
      }

      if (pos.currentPrice !== livePrice || pos.pnl !== pnl) {
        nextDifferent = true;
        return {
          ...pos,
          currentPrice: livePrice,
          pnl,
        };
      }

      return pos;
    }).filter((p): p is TradePosition => p !== null);

    if (nextDifferent) {
      setPositions(nextPositions);
    }

    if (closedToLog.length > 0) {
      setClosedTrades((prev) => [...closedToLog, ...prev]);
    }
  }, [watchlistItems, positions]);

  // --- Open Paper Positions ---
  const handleOpenPosition = React.useCallback((type: 'BUY' | 'SELL', amount: number, sl?: number, tp?: number) => {
    const nowMs = Date.now();
    const newPos: TradePosition = {
      id: `pos_${nowMs}_${Math.random().toString(36).substr(2, 4)}`,
      symbol: selectedSymbol,
      type,
      entryPrice: currentPrice,
      currentPrice: currentPrice,
      amount,
      sl,
      tp,
      pnl: 0,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      openedAt: nowMs,
    };
    setPositions((prev) => [newPos, ...prev]);
  }, [selectedSymbol, currentPrice]);

  // --- Close paper positions manual trigger ---
  const handleClosePosition = React.useCallback((id: string) => {
    setPositions((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        // Resolve the exit price from the position's own instrument feed,
        // never from the currently selected symbol.
        const priceItem = watchlistItems.find((item) => item.symbol === target.symbol);
        const livePrice = priceItem?.price ?? target.currentPrice ?? currentPrice;
        const contractSize = getContractSize(target.symbol);
        let pnl = 0;
        if (target.type === 'BUY') {
          pnl = (livePrice - target.entryPrice) * target.amount * contractSize;
        } else {
          pnl = (target.entryPrice - livePrice) * target.amount * contractSize;
        }

        const nowMs = Date.now();
        const openTimeMs = target.openedAt || (nowMs - 1800000);
        const duration = Math.max(1000, nowMs - openTimeMs);

        setClosedTrades((prevClosed) => [
          {
            id: `closed_${nowMs}_${Math.random().toString(36).substr(2, 4)}`,
            symbol: target.symbol,
            type: target.type,
            entryPrice: target.entryPrice,
            exitPrice: livePrice,
            amount: target.amount,
            pnl: parseFloat(pnl.toFixed(2)),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            closeReason: 'Manual',
            openedAt: openTimeMs,
            closedAt: nowMs,
            durationMs: duration,
          },
          ...prevClosed,
        ]);
      }
      return prev.filter((p) => p.id !== id);
    });
  }, [watchlistItems, currentPrice]);

  const handleClearHistory = React.useCallback(() => {
    setClosedTrades([]);
  }, []);

  // --- Indicator toggles ---
  const handleToggleIndicator = React.useCallback((key: keyof TechnicalIndicatorsState) => {
    setIndicators((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // --- Calculate indicators and alerts on the fly ---
  const activePatterns = useMemo(() => {
    return detectPatterns(activeData);
  }, [activeData]);

  const activeSignal = useMemo(() => {
    return generateSignal(selectedSymbol, selectedTimeframe, activeData, indicators, activePatterns);
  }, [selectedSymbol, selectedTimeframe, activeData, indicators, activePatterns]);

  const volatility = useMemo(() => {
    return calculateVolatilityDetails(activeData, selectedSymbol);
  }, [activeData, selectedSymbol]);

  const priceRange = useMemo(() => {
    if (!activeData || activeData.length === 0) return null;
    let minPrice = activeData[0].low;
    let maxPrice = activeData[0].high;
    for (let i = 1; i < activeData.length; i++) {
      if (activeData[i].low < minPrice) minPrice = activeData[i].low;
      if (activeData[i].high > maxPrice) maxPrice = activeData[i].high;
    }
    const range = maxPrice - minPrice;
    const currentPercentage = range > 0 ? ((currentPrice - minPrice) / range) * 100 : 50;
    return {
      low: minPrice,
      high: maxPrice,
      percentage: Math.max(0, Math.min(100, currentPercentage)),
    };
  }, [activeData, currentPrice]);

  // Manual Recalculate signal animator visual cue
  const handleRefreshSignal = React.useCallback(() => {
    setIsRefreshingSignal(true);
    setTimeout(() => {
      setIsRefreshingSignal(false);
    }, 600);
  }, []);

  return (
    <TradingContext.Provider value={{
      mobileTab,
      setMobileTab,
      leftSidebarOpen,
      setLeftSidebarOpen,
      rightSidebarOpen,
      setRightSidebarOpen,
      isPending,
      startTransition,
      selectedSymbol,
      setSelectedSymbol,
      selectedTimeframe,
      setSelectedTimeframe,
      chartData,
      setChartData,
      watchlistItems,
      setWatchlistItems,
      indicators,
      handleToggleIndicator,
      highlightedPattern,
      setHighlightedPattern,
      aiSnapshot,
      handleChartSnapshot,
      onClearAttachedImage,
      wsConnected,
      positions,
      setPositions,
      closedTrades,
      setClosedTrades,
      handleClearHistory,
      tickStates,
      utcTime,
      liveQuote,
      isRefreshingSignal,
      handleRefreshSignal,
      activeData,
      currentPrice,
      activePatterns,
      activeSignal,
      volatility,
      priceRange,
      handleOpenPosition,
      handleClosePosition,
      theme,
      toggleTheme
    }}>
      {children}
    </TradingContext.Provider>
  );
};

export const useTrading = () => {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error('useTrading must be used within a TradingProvider');
  }
  return context;
};
