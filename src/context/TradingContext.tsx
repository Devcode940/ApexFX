import React, { createContext, useContext, useState, useEffect, useMemo, useTransition } from 'react';
import {
  WatchlistItem,
  Timeframe,
  TechnicalIndicatorsState,
  TradePosition,
  ClosedTrade,
  Pattern,
  TradingSignal,
  Candlestick,
  LiveQuote,
} from '../types';
import {
  detectPatterns,
  generateSignal,
  calculateVolatilityDetails,
  VolatilityDetails,
} from '../utils/forexData';

import { useTheme } from '../hooks/useTheme';
import { useClock } from '../hooks/useClock';
import { useWatchlistFeed } from '../hooks/useWatchlistFeed';
import { useChartHistory } from '../hooks/useChartHistory';
import { usePaperTrading } from '../hooks/usePaperTrading';

interface TradingContextType {
  mobileTab: 'chart' | 'watchlist' | 'signals' | 'trader' | 'performance' | 'analysis';
  setMobileTab: React.Dispatch<React.SetStateAction<'chart' | 'watchlist' | 'signals' | 'trader' | 'performance' | 'analysis'>>;
  leftSidebarOpen: boolean;
  setLeftSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;

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

  activeData: Candlestick[];
  currentPrice: number;
  activePatterns: Pattern[];
  activeSignal: TradingSignal | null;
  volatility: VolatilityDetails | null;
  priceRange: { low: number; high: number; percentage: number } | null;

  handleOpenPosition: (type: 'BUY' | 'SELL', amount: number, sl?: number, tp?: number) => void;
  handleClosePosition: (id: string) => void;

  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export const TradingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileTab, setMobileTab] = useState<'chart' | 'watchlist' | 'signals' | 'trader' | 'performance' | 'analysis'>('chart');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [isPending, startTransition] = useTransition();

  const { theme, toggleTheme } = useTheme();
  const utcTime = useClock();

  const [selectedSymbol, setSelectedSymbol] = useState<string>('EURUSD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1H');

  const [indicators, setIndicators] = useState<TechnicalIndicatorsState>(() => {
    try {
      const cached = localStorage.getItem('forexinsight_preferred_indicators');
      if (cached) {
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
      }
    } catch (e) {
      console.error('Failed to parse cached indicators', e);
    }
    return { sma: true, ema: true, rsi: true, macd: false, bollinger: false, fibonacci: false };
  });

  useEffect(() => {
    try {
      localStorage.setItem('forexinsight_preferred_indicators', JSON.stringify(indicators));
    } catch {}
  }, [indicators]);

  const [highlightedPattern, setHighlightedPattern] = useState<Pattern | null>(null);
  const [aiSnapshot, setAiSnapshot] = useState<string | null>(null);

  const handleChartSnapshot = React.useCallback((dataUrl: string) => {
    setAiSnapshot(dataUrl);
    setMobileTab('analysis');
    setTimeout(() => {
      const aiElem = document.getElementById('ai_assistant_component');
      if (aiElem) aiElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, []);

  const onClearAttachedImage = React.useCallback(() => setAiSnapshot(null), []);

  const { watchlistItems, setWatchlistItems, tickStates, wsConnected } = useWatchlistFeed();

  const { chartData, setChartData, activeData } = useChartHistory(selectedSymbol, selectedTimeframe);

  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [isRefreshingSignal, setIsRefreshingSignal] = useState<boolean>(false);

  // Clear highlighted pattern on symbol/timeframe change
  useEffect(() => {
    setHighlightedPattern(null);
  }, [selectedSymbol, selectedTimeframe]);

  // Live quote for active symbol (separate from watchlist feed, for HUD)
  useEffect(() => {
    const fetchQuote = async () => {
      try {
        const symbolFormat = selectedSymbol.slice(0, 3) + '/' + selectedSymbol.slice(3);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const response = await fetch(`/api/market/quote?symbol=${symbolFormat}`, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await response.json();
        if (response.ok && data.price) setLiveQuote(data);
        else setLiveQuote(null);
      } catch {
        setLiveQuote(null);
      }
    };
    fetchQuote();
    const sub = setInterval(fetchQuote, 60000);
    return () => clearInterval(sub);
  }, [selectedSymbol]);

  const activeWatchItem = useMemo(() => watchlistItems.find((item) => item.symbol === selectedSymbol), [watchlistItems, selectedSymbol]);

  const currentPrice = useMemo(() => {
    if (activeWatchItem && activeWatchItem.price > 0) return activeWatchItem.price;
    const series = chartData[selectedSymbol]?.[selectedTimeframe];
    if (series && series.length > 0) return series[series.length - 1].close;
    return 0;
  }, [activeWatchItem, selectedSymbol, chartData, selectedTimeframe]);

  // Update last candle with live price — but avoid replacing entire array if unchanged
  useEffect(() => {
    if (activeData.length === 0 || currentPrice === 0) return;
    setChartData((prev) => {
      const currentInstrument = prev[selectedSymbol];
      if (!currentInstrument) return prev;
      const currentTimeframeSeries = currentInstrument[selectedTimeframe];
      if (!currentTimeframeSeries || currentTimeframeSeries.length === 0) return prev;
      const last = currentTimeframeSeries[currentTimeframeSeries.length - 1];
      // If close already matches, skip update to prevent chart teardown
      if (Math.abs(last.close - currentPrice) < 1e-9) return prev;

      const updatedSeries = [...currentTimeframeSeries];
      const lastIndex = updatedSeries.length - 1;
      updatedSeries[lastIndex] = {
        ...last,
        close: currentPrice,
        high: Math.max(last.high, currentPrice),
        low: Math.min(last.low, currentPrice),
      };
      return {
        ...prev,
        [selectedSymbol]: {
          ...currentInstrument,
          [selectedTimeframe]: updatedSeries,
        },
      };
    });
  }, [currentPrice, selectedSymbol, selectedTimeframe, activeData.length, setChartData]);

  const { positions, setPositions, closedTrades, setClosedTrades, handleOpenPosition, handleClosePosition, handleClearHistory } =
    usePaperTrading(watchlistItems, selectedSymbol, currentPrice);

  const handleToggleIndicator = React.useCallback((key: keyof TechnicalIndicatorsState) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const activePatterns = useMemo(() => detectPatterns(activeData), [activeData]);

  const activeSignal = useMemo(
    () => generateSignal(selectedSymbol, selectedTimeframe, activeData, indicators, activePatterns),
    [selectedSymbol, selectedTimeframe, activeData, indicators, activePatterns]
  );

  const volatility = useMemo(() => calculateVolatilityDetails(activeData, selectedSymbol), [activeData, selectedSymbol]);

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
    return { low: minPrice, high: maxPrice, percentage: Math.max(0, Math.min(100, currentPercentage)) };
  }, [activeData, currentPrice]);

  const handleRefreshSignal = React.useCallback(() => {
    setIsRefreshingSignal(true);
    setTimeout(() => setIsRefreshingSignal(false), 600);
  }, []);

  return (
    <TradingContext.Provider
      value={{
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
        toggleTheme,
      }}
    >
      {children}
    </TradingContext.Provider>
  );
};

export const useTrading = () => {
  const context = useContext(TradingContext);
  if (!context) throw new Error('useTrading must be used within a TradingProvider');
  return context;
};
