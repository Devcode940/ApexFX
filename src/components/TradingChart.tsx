import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  createChart, 
  IChartApi, 
  ISeriesApi, 
  CandlestickSeries, 
  LineSeries, 
  HistogramSeries, 
  ColorType,
  createSeriesMarkers,
  UTCTimestamp
} from 'lightweight-charts';
import { Candlestick, TechnicalIndicatorsState, Pattern, Timeframe } from '../types';
import {
  computeSMA,
  computeEMA,
  computeBollingerBands,
  computeMACD,
  computeRSI,
  computeFibonacci,
  PAIRS_CONFIG
} from '../utils/forexData';
import { 
  MousePointer, 
  TrendingUp, 
  Minus, 
  Type, 
  Trash2, 
  Maximize2, 
  Minimize2, 
  Plus, 
  AlertCircle,
  Expand,
  RefreshCw,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  AlignJustify,
  Camera,
  Sparkles,
  Eye,
  Globe,
  Clock,
  Zap,
  Play,
  CheckCircle,
  XCircle,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
  BarChart2,
  Activity,
  Sliders,
  Settings2
} from 'lucide-react';

import { useTrading } from '../context/TradingContext';
import { 
  FOREX_SESSIONS, 
  ForexSessionKey, 
  generateSessionBlocks, 
  getSessionLocalHoursString, 
  getLocalTimezoneName, 
  formatFullTime, 
  isSessionActiveAtTime,
  SessionBlock 
} from '../utils/forexSessions';

interface TradingChartProps {}

export const TradingChart: React.FC<TradingChartProps> = () => {
  const {
    selectedSymbol: symbol,
    selectedTimeframe: timeframe,
    setSelectedTimeframe,
    activeData: data,
    indicators,
    handleToggleIndicator,
    activePatterns: patterns,
    highlightedPattern,
    setHighlightedPattern,
    handleChartSnapshot: onSnapshot,
    theme,
    positions,
    closedTrades,
  } = useTrading();

  // Compute consecutive candlestick price streak
  const priceStreak = React.useMemo(() => {
    if (!data || data.length === 0) return { count: 0, type: 'neutral' as const };
    let count = 0;
    let type: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    for (let i = data.length - 1; i >= 0; i--) {
      const candle = data[i];
      const isBullish = candle.close > candle.open;
      const isBearish = candle.close < candle.open;
      if (i === data.length - 1) {
        if (isBullish) {
          type = 'bullish';
          count = 1;
        } else if (isBearish) {
          type = 'bearish';
          count = 1;
        } else {
          break;
        }
      } else {
        if (type === 'bullish' && isBullish) {
          count++;
        } else if (type === 'bearish' && isBearish) {
          count++;
        } else {
          break;
        }
      }
    }
    return { count, type };
  }, [data]);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Sub-indicator refs
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);

  const macdContainerRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  // Expanded View State
  const [isExpandedFullScreen, setIsExpandedFullScreen] = useState<boolean>(false);

  // Custom drawing tools state
  const [drawings, setDrawings] = useState<{
    horizontalLines: (number | { price: number; color?: string })[];
    trendlines: { start: { time: number; price: number }; end: { time: number; price: number }; color?: string }[];
    annotations: { time: number; price: number; text: string; color?: string }[];
    riskRewards: { id: string; type: 'long' | 'short'; entry: { time: number; price: number }; tp: number; sl: number }[];
    fibonacci: { id: string; start: { time: number; price: number }; end: { time: number; price: number }; color?: string }[];
  }>(() => {
    try {
      const cached = localStorage.getItem(`forexinsight_drawings_${symbol}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          horizontalLines: parsed.horizontalLines || [],
          trendlines: parsed.trendlines || [],
          annotations: parsed.annotations || [],
          riskRewards: parsed.riskRewards || [],
          fibonacci: parsed.fibonacci || [],
        };
      }
    } catch { }
    return { horizontalLines: [], trendlines: [], annotations: [], riskRewards: [], fibonacci: [] };
  });

  const [activeTool, setActiveTool] = useState<'none' | 'horizontal' | 'trendline_start' | 'trendline_end' | 'annotation' | 'rr_long' | 'rr_short' | 'fib_start' | 'fib_end'>('none');
  const [fibStart, setFibStart] = useState<{ time: number; price: number } | null>(null);
  const [trendlineStart, setTrendlineStart] = useState<{ time: number; price: number } | null>(null);
  
  // Custom Color Selection & Drawings Manager Toggle
  const [selectedColor, setSelectedColor] = useState<string>('#eab308'); // default Gold/Yellow
  const [showDrawingsManager, setShowDrawingsManager] = useState<boolean>(false);

  // Historical Pattern Marker Layer state
  const [showPatternMarkers, setShowPatternMarkers] = useState<boolean>(true);
  const [patternMarkerFilter, setPatternMarkerFilter] = useState<'all' | 'bullish' | 'bearish' | 'high_winrate'>('all');
  const [showPatternMenu, setShowPatternMenu] = useState<boolean>(false);

  // Forex Sessions Visual Shading Layer state
  const [showSessionShading, setShowSessionShading] = useState<boolean>(true);
  const [enabledSessions, setEnabledSessions] = useState<Record<ForexSessionKey, boolean>>({
    tokyo: true,
    london: true,
    newyork: true,
    sydney: true,
  });
  const [showSessionMenu, setShowSessionMenu] = useState<boolean>(false);

  // Trade Entry/Exit Animations & Pattern Beam Layer state
  const [showTradeAnimations, setShowTradeAnimations] = useState<boolean>(true);
  const [showPatternBeams, setShowPatternBeams] = useState<boolean>(true);
  const [animTradeFilter, setAnimTradeFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [showTradeAnimMenu, setShowTradeAnimMenu] = useState<boolean>(false);

  // Chart Tools Sidebar panel state
  const [showChartSidebar, setShowChartSidebar] = useState<boolean>(true);
  const [sidebarTab, setSidebarTab] = useState<'indicators' | 'patterns_sessions' | 'drawings' | 'view_anims'>('indicators');

  // Count active tools / layers for the sidebar badge indicator
  const activeFeaturesCount = React.useMemo(() => {
    let count = 0;
    if (indicators.sma) count++;
    if (indicators.ema) count++;
    if (indicators.rsi) count++;
    if (indicators.macd) count++;
    if (indicators.bollinger) count++;
    if (indicators.fibonacci) count++;
    if (showPatternMarkers) count++;
    if (showSessionShading) count++;
    if (showTradeAnimations) count++;
    if ((drawings.horizontalLines.length + drawings.trendlines.length + drawings.annotations.length) > 0) count++;
    return count;
  }, [indicators, showPatternMarkers, showSessionShading, showTradeAnimations, drawings]);

  // Filter relevant trades for current symbol
  const symbolTradesToAnimate = React.useMemo(() => {
    const activePositions = (positions || []).filter(p => p.symbol === symbol).map(p => ({ ...p, isClosed: false }));
    const closedList = (closedTrades || []).filter(t => t.symbol === symbol).map(t => ({ ...t, isClosed: true }));
    
    let list: Array<any> = [];
    if (animTradeFilter === 'all' || animTradeFilter === 'open') {
      list = [...list, ...activePositions];
    }
    if (animTradeFilter === 'all' || animTradeFilter === 'closed') {
      list = [...list, ...closedList];
    }
    return list;
  }, [positions, closedTrades, symbol, animTradeFilter]);

  // Filter patterns for historical markers display
  const visibleChartPatterns = React.useMemo(() => {
    if (!showPatternMarkers || !patterns) return [];
    return patterns.filter((p) => {
      if (patternMarkerFilter === 'bullish') return p.type === 'bullish';
      if (patternMarkerFilter === 'bearish') return p.type === 'bearish';
      if (patternMarkerFilter === 'high_winrate') return (p.winRate || 0) >= 70;
      return true;
    });
  }, [patterns, showPatternMarkers, patternMarkerFilter]);

  // Compute Forex session shading blocks for current chart data
  const sessionBlocks = React.useMemo(() => {
    if (!showSessionShading) return [];
    return generateSessionBlocks(data, timeframe, enabledSessions);
  }, [data, timeframe, enabledSessions, showSessionShading]);

  const handleTakeSnapshot = () => {
    if (!chartRef.current) return;
    try {
      const canvas = chartRef.current.takeScreenshot();
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        if (onSnapshot) {
          onSnapshot(dataUrl);
        }
      }
    } catch (err) {
      console.warn('Error taking chart screenshot:', err);
    }
  };

  // HUD crosshair state
  const [hudData, setHudData] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    date: string;
    sma?: number;
    ema?: number;
    rsi?: number;
    bbUpper?: number;
    bbLower?: number;
  } | null>(null);

  // Minimize states for sub-chart indicator panels
  const [isRsiMinimized, setIsRsiMinimized] = useState<boolean>(false);
  const [isMacdMinimized, setIsMacdMinimized] = useState<boolean>(false);

  // Customizable Chart Height (Defaults to 620px for a large, clear view)
  const [preferredHeight, setPreferredHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('forexinsight_chart_height');
      return saved ? Number(saved) : 620;
    } catch {
      return 620;
    }
  });

  const handleSetChartHeight = (h: number) => {
    setPreferredHeight(h);
    try {
      localStorage.setItem('forexinsight_chart_height', String(h));
    } catch {}
  };

  // Determine responsive height based on viewport and indicators
  const chartHeight = isExpandedFullScreen 
    ? Math.max(480, window.innerHeight - (indicators.rsi && !isRsiMinimized ? 120 : 0) - (indicators.macd && !isMacdMinimized ? 120 : 0) - 160) 
    : preferredHeight;

  // Refs for tracking drawing states inside persistent lightweight-charts click subscriptions
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const trendlineStartRef = useRef(trendlineStart);
  useEffect(() => {
    trendlineStartRef.current = trendlineStart;
  }, [trendlineStart]);

  const fibStartRef = useRef(fibStart);
  useEffect(() => {
    fibStartRef.current = fibStart;
  }, [fibStart]);

  const selectedColorRef = useRef(selectedColor);
  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  // Load drawings when symbol shifts
  useEffect(() => {
    try {
      const cached = localStorage.getItem(`forexinsight_drawings_${symbol}`);
      setDrawings(cached ? JSON.parse(cached) : { horizontalLines: [], trendlines: [], annotations: [], riskRewards: [], fibonacci: [] });
    } catch {
      setDrawings({ horizontalLines: [], trendlines: [], annotations: [], riskRewards: [], fibonacci: [] });
    }
    setActiveTool('none');
    setTrendlineStart(null);
  }, [symbol]);

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem(`forexinsight_drawings_${symbol}`, JSON.stringify(drawings));
  }, [drawings, symbol]);

  const handleClearDrawings = () => {
    if (confirm("Clear all custom drawings from this chart?")) {
      setDrawings({ horizontalLines: [], trendlines: [], annotations: [], riskRewards: [], fibonacci: [] });
    }
  };

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Reset previous chart instances
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    if (rsiChartRef.current) {
      rsiChartRef.current.remove();
      rsiChartRef.current = null;
    }
    if (macdChartRef.current) {
      macdChartRef.current.remove();
      macdChartRef.current = null;
    }

    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };

    // --- Main Chart ---
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: chartHeight,
      layout: {
        background: { type: ColorType.Solid, color: theme === 'dark' ? '#09090b' : '#ffffff' },
        textColor: theme === 'dark' ? '#a1a1aa' : '#52525b',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
        horzLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
      },
      rightPriceScale: {
        borderColor: theme === 'dark' ? '#27272a' : '#e4e4e7',
        autoScale: true,
      },
      timeScale: {
        borderColor: theme === 'dark' ? '#27272a' : '#e4e4e7',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: {
          labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b',
        },
        vertLine: {
          labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b',
        }
      }
    });
    chartRef.current = chart;

    // Candlesticks (using v5 generic addSeries method)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: config.pipDecimal + 1,
        minMove: 1 / Math.pow(10, config.pipDecimal + 1),
      }
    });

    const chartData = data.map(item => ({
      time: item.time as any,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }));
    candleSeries.setData(chartData);

    // --- SMA Indicator ---
    let smaSeries: ISeriesApi<'Line'> | null = null;
    if (indicators.sma) {
      smaSeries = chart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 2,
        title: 'SMA (20)',
        priceLineVisible: false,
      });
      const smaData = computeSMA(data, 20);
      const values = data.map((item, idx) => ({
        time: item.time as any,
        value: smaData[idx] as number,
      })).filter(item => item.value !== null);
      if (values.length > 0) smaSeries.setData(values);
    }

    // --- EMA Indicator ---
    let emaSeries: ISeriesApi<'Line'> | null = null;
    if (indicators.ema) {
      emaSeries = chart.addSeries(LineSeries, {
        color: '#eab308',
        lineWidth: 2,
        title: 'EMA (50)',
        priceLineVisible: false,
      });
      const emaData = computeEMA(data, 50);
      const values = data.map((item, idx) => ({
        time: item.time as any,
        value: emaData[idx] as number,
      })).filter(item => item.value !== null);
      if (values.length > 0) emaSeries.setData(values);
    }

    // --- Bollinger Bands ---
    let bbUpperSeries: ISeriesApi<'Line'> | null = null;
    let bbLowerSeries: ISeriesApi<'Line'> | null = null;
    let bbBasisSeries: ISeriesApi<'Line'> | null = null;

    if (indicators.bollinger) {
      const bbData = computeBollingerBands(data, 20, 2);

      bbUpperSeries = chart.addSeries(LineSeries, {
        color: 'rgba(168, 85, 247, 0.65)',
        lineWidth: 1,
        lineStyle: 2, // dashed
        title: 'BB Upper',
        priceLineVisible: false,
      });
      const upperVals = data.map((item, idx) => ({
        time: item.time as any,
        value: bbData.upper[idx] as number,
      })).filter(item => item.value !== null);
      bbUpperSeries.setData(upperVals);

      bbLowerSeries = chart.addSeries(LineSeries, {
        color: 'rgba(168, 85, 247, 0.65)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Lower',
        priceLineVisible: false,
      });
      const lowerVals = data.map((item, idx) => ({
        time: item.time as any,
        value: bbData.lower[idx] as number,
      })).filter(item => item.value !== null);
      bbLowerSeries.setData(lowerVals);

      bbBasisSeries = chart.addSeries(LineSeries, {
        color: 'rgba(168, 85, 247, 0.3)',
        lineWidth: 1,
        title: 'BB Basis',
        priceLineVisible: false,
      });
      const basisVals = data.map((item, idx) => ({
        time: item.time as any,
        value: bbData.basis[idx] as number,
      })).filter(item => item.value !== null);
      bbBasisSeries.setData(basisVals);
    }

    // --- Fibonacci Retracement ---
    const fibLines: any[] = [];
    if (indicators.fibonacci) {
      const fib = computeFibonacci(data);
      if (fib) {
        const colors = {
          anchor: '#f43f5e', // rose-500
          r236: '#fda4af',
          r382: '#f0abfc',
          r500: '#c084fc',
          r618: '#818cf8',
        };

        const drawFibLine = (price: number, label: string, color: string) => {
          const priceLine = candleSeries.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: 1, // dotted
            axisLabelVisible: true,
            title: label,
          });
          fibLines.push(priceLine);
        };

        drawFibLine(fib.high, `Fib 0% / 100% (High: ${fib.high.toFixed(config.pipDecimal + 1)})`, colors.anchor);
        drawFibLine(fib.r236, `Fib 23.6% (${fib.r236.toFixed(config.pipDecimal + 1)})`, colors.r236);
        drawFibLine(fib.r382, `Fib 38.2% (${fib.r382.toFixed(config.pipDecimal + 1)})`, colors.r382);
        drawFibLine(fib.r500, `Fib 50.0% (${fib.r500.toFixed(config.pipDecimal + 1)})`, colors.r500);
        drawFibLine(fib.r618, `Fib 61.8% (${fib.r618.toFixed(config.pipDecimal + 1)})`, colors.r618);
        drawFibLine(fib.low, `Fib 100% / 0% (Low: ${fib.low.toFixed(config.pipDecimal + 1)})`, colors.anchor);
      }
    }

    // --- Draw Active Custom Drawings ---
    const activePriceLines: any[] = [];
    drawings.horizontalLines.forEach((item) => {
      const price = typeof item === 'number' ? item : item.price;
      const color = typeof item === 'object' && item.color ? item.color : '#22c55e';
      const line = candleSeries.createPriceLine({
        price,
        color,
        lineWidth: 2,
        lineStyle: 1, // dotted
        title: 'SUPPORT/RESISTANCE',
        axisLabelVisible: true,
      });
      activePriceLines.push(line);
    });

    const activeTrendlineSeries: ISeriesApi<'Line'>[] = [];
    drawings.trendlines.forEach((tl, index) => {
      const color = tl.color || '#eab308';
      // Sort start/end chronologically as lightweight-charts requires strictly ascending time values
      const sortedPoints = [tl.start, tl.end].sort((a, b) => a.time - b.time);
      const tlSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        title: `Trendline ${index + 1}`,
      });
      tlSeries.setData([
        { time: sortedPoints[0].time as any, value: sortedPoints[0].price },
        { time: sortedPoints[1].time as any, value: sortedPoints[1].price },
      ]);
      activeTrendlineSeries.push(tlSeries);
    });

    // --- Markers for Pattern Highlighting + Annotations + Active Trendline Start feedback ---
    const markers = [
      ...visibleChartPatterns.map(p => {
        const isHighlighted = highlightedPattern && highlightedPattern.id === p.id;
        const iconPrefix = p.type === 'bullish' ? '🟢' : p.type === 'bearish' ? '🔴' : '⚪';
        const winRateText = p.winRate ? ` (${p.winRate}%)` : '';
        const labelText = `${isHighlighted ? '⭐ ' : ''}${iconPrefix} ${p.name}${winRateText}`;

        return {
          time: p.time as any,
          position: (p.type === 'bullish' ? 'belowBar' : p.type === 'bearish' ? 'aboveBar' : 'inBar') as any,
          color: p.type === 'bullish' ? '#10b981' : p.type === 'bearish' ? '#f43f5e' : '#a1a1aa',
          shape: (p.type === 'bullish' ? 'arrowUp' : p.type === 'bearish' ? 'arrowDown' : 'circle') as any,
          text: labelText,
          size: isHighlighted ? 2.8 : 1.5,
        };
      }),
      ...drawings.annotations.map(ann => ({
        time: ann.time as any,
        position: 'aboveBar' as any,
        color: ann.color || '#a855f7', // purple-500
        shape: 'pin' as any,
        text: ann.text,
        size: 1.5,
      })),
      ...(trendlineStart ? [{
        time: trendlineStart.time as any,
        position: 'inBar' as any,
        color: selectedColorRef.current,
        shape: 'circle' as any,
        text: 'TL START 🔍',
        size: 1.2,
      }] : [])
    ];

    // Write all combined markers to chart series
    createSeriesMarkers(candleSeries, markers);

    // --- RSI Sub-chart ---
    let rsiChart: IChartApi | null = null;
    if (indicators.rsi && !isRsiMinimized && rsiContainerRef.current) {
      rsiChart = createChart(rsiContainerRef.current, {
        width: rsiContainerRef.current.clientWidth,
        height: isExpandedFullScreen ? 110 : 100,
        layout: {
          background: { type: ColorType.Solid, color: theme === 'dark' ? '#09090b' : '#ffffff' },
          textColor: theme === 'dark' ? '#a1a1aa' : '#52525b',
        },
        grid: {
          vertLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
          horzLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
        },
        rightPriceScale: {
          borderColor: theme === 'dark' ? '#27272a' : '#e4e4e7',
          autoScale: false,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          visible: false, // hidden since linked to main
        },
        crosshair: {
          horzLine: { labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b' },
          vertLine: { labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b' }
        }
      });
      rsiChartRef.current = rsiChart;

      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: '#f43f5e',
        lineWidth: 2,
        title: 'RSI (14)',
        priceLineVisible: false,
      });

      // Horizontal oversold (30) / overbought (70) lines
      rsiSeries.createPriceLine({
        price: 70,
        color: 'rgba(239, 68, 68, 0.4)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'Overbought (70)',
        axisLabelVisible: true,
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: 'rgba(34, 197, 94, 0.4)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'Oversold (30)',
        axisLabelVisible: true,
      });

      const rsiData = computeRSI(data, 14);
      const rsiVals = data.map((item, idx) => ({
        time: item.time as any,
        value: rsiData[idx] as number,
      })).filter(item => item.value !== null);
      rsiSeries.setData(rsiVals);
    }

    // --- MACD Sub-chart ---
    let macdChart: IChartApi | null = null;
    if (indicators.macd && !isMacdMinimized && macdContainerRef.current) {
      macdChart = createChart(macdContainerRef.current, {
        width: macdContainerRef.current.clientWidth,
        height: isExpandedFullScreen ? 110 : 100,
        layout: {
          background: { type: ColorType.Solid, color: theme === 'dark' ? '#09090b' : '#ffffff' },
          textColor: theme === 'dark' ? '#a1a1aa' : '#52525b',
        },
        grid: {
          vertLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
          horzLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
        },
        rightPriceScale: {
          borderColor: theme === 'dark' ? '#27272a' : '#e4e4e7',
        },
        timeScale: {
          visible: false, // hidden since linked
        },
        crosshair: {
          horzLine: { labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b' },
          vertLine: { labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b' }
        }
      });
      macdChartRef.current = macdChart;

      const macdData = computeMACD(data);

      const mLineSeries = macdChart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 2,
        title: 'MACD',
        priceLineVisible: false,
      });
      const mVals = data.map((item, idx) => ({
        time: item.time as any,
        value: macdData.macd[idx] as number,
      })).filter(item => item.value !== null);
      mLineSeries.setData(mVals);

      const sLineSeries = macdChart.addSeries(LineSeries, {
        color: '#eab308',
        lineWidth: 2,
        title: 'Signal',
        priceLineVisible: false,
      });
      const sVals = data.map((item, idx) => ({
        time: item.time as any,
        value: macdData.signal[idx] as number,
      })).filter(item => item.value !== null);
      sLineSeries.setData(sVals);

      const histSeries = macdChart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        title: 'Histogram',
      });
      const histVals = data.map((item, idx) => {
        const val = macdData.histogram[idx];
        return {
          time: item.time as any,
          value: val as number,
          color: val !== null && val >= 0 ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)',
        };
      }).filter(item => item.value !== null);
      histSeries.setData(histVals);
    }

    // --- Synchronize Tooltips and Time Scales ---
    const primaryTimeScale = chart.timeScale();
    const handlers: (() => void)[] = [];

    const syncTimeScale = (targetChart: IChartApi) => {
      const targetTimeScale = targetChart.timeScale();
      
      const handler1 = (range: any) => {
        if (range) targetTimeScale.setVisibleLogicalRange(range);
      };
      const handler2 = (range: any) => {
        if (range) primaryTimeScale.setVisibleLogicalRange(range);
      };

      primaryTimeScale.subscribeVisibleLogicalRangeChange(handler1);
      targetTimeScale.subscribeVisibleLogicalRangeChange(handler2);
      
      handlers.push(() => {
        primaryTimeScale.unsubscribeVisibleLogicalRangeChange(handler1);
        targetTimeScale.unsubscribeVisibleLogicalRangeChange(handler2);
      });
    };

    if (rsiChart) syncTimeScale(rsiChart);
    if (macdChart) syncTimeScale(macdChart);

    // Zoom to last 55 candles initially for tight focal layout
    primaryTimeScale.setVisibleRange({
      from: data[Math.max(0, data.length - 60)].time as any,
      to: data[data.length - 1].time as any
    });

    // Resize Handler Ref
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !containerRef.current) return;
      const { width } = entries[0].contentRect;
      chart.resize(width, chartHeight);
      if (rsiChartRef.current && rsiContainerRef.current) {
        rsiChartRef.current.resize(width, isExpandedFullScreen ? 110 : 100);
      }
      if (macdChartRef.current && macdContainerRef.current) {
        macdChartRef.current.resize(width, isExpandedFullScreen ? 110 : 100);
      }
    });

    resizeObserver.observe(containerRef.current);

    // Double-click to auto fit chart timescale
    const handleDblClick = () => {
      chart.timeScale().fitContent();
    };
    const chartContainerEl = containerRef.current;
    if (chartContainerEl) {
      chartContainerEl.addEventListener('dblclick', handleDblClick);
    }

    // Chart click listener to place drawings
    const handleChartClick = (param: any) => {
      if (!param.point || !param.time) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null) return;
      const clickedTime = param.time as number;

      if (activeToolRef.current === 'horizontal') {
        setDrawings(prev => ({
          ...prev,
          horizontalLines: [...prev.horizontalLines, { price: parseFloat(price.toFixed(config.pipDecimal + 1)), color: selectedColorRef.current }]
        }));
        setActiveTool('none');
      } else if (activeToolRef.current === 'trendline_start') {
        setTrendlineStart({ time: clickedTime, price });
        setActiveTool('trendline_end');
      } else if (activeToolRef.current === 'trendline_end' && trendlineStartRef.current) {
        const start = trendlineStartRef.current;
        setDrawings(prev => ({
          ...prev,
          trendlines: [...prev.trendlines, { start, end: { time: clickedTime, price }, color: selectedColorRef.current }]
        }));
        setTrendlineStart(null);
        setActiveTool('none');
      } else if (activeToolRef.current === 'rr_long' || activeToolRef.current === 'rr_short') {
        const isLong = activeToolRef.current === 'rr_long';
        const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
        const pip = Math.pow(10, -config.pipDecimal);
        const slPips = 20;
        const tpPips = 40;
        
        const sl = isLong ? price - (slPips * pip) : price + (slPips * pip);
        const tp = isLong ? price + (tpPips * pip) : price - (tpPips * pip);
        
        setDrawings(prev => ({
          ...prev,
          riskRewards: [
            ...(prev.riskRewards || []),
            {
              id: Date.now().toString(),
              type: isLong ? 'long' : 'short',
              entry: { time: clickedTime, price },
              tp,
              sl
            }
          ]
        }));
        setActiveTool('none');
      } else if (activeToolRef.current === 'fib_start') {
        setFibStart({ time: clickedTime, price });
        setActiveTool('fib_end');
      } else if (activeToolRef.current === 'fib_end' && fibStartRef.current) {
        const start = fibStartRef.current;
        setDrawings(prev => ({
          ...prev,
          fibonacci: [
            ...(prev.fibonacci || []),
            { id: Date.now().toString(), start, end: { time: clickedTime, price }, color: selectedColorRef.current }
          ]
        }));
        setFibStart(null);
        setActiveTool('none');
      } else if (activeToolRef.current === 'annotation') {
        const text = prompt("Enter text for label annotation:");
        if (text && text.trim()) {
          setDrawings(prev => ({
            ...prev,
            annotations: [...prev.annotations, { time: clickedTime, price, text: text.trim(), color: selectedColorRef.current }]
          }));
        }
        setActiveTool('none');
      }
    };

    chart.subscribeClick(handleChartClick);

    // Crosshair move listener for HUD
    const handleCrosshairMove = (param: any) => {
      // update rr overlays on crosshair move as a hacky way to sync on price update too
      updateCustomOverlays();
      
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > (chartContainerEl?.clientWidth || 0) ||
        param.point.y < 0 ||
        param.point.y > (chartContainerEl?.clientHeight || 0)
      ) {
        setHudData(null);
      } else {
        const dataPoint = param.seriesData.get(candleSeries);
        if (dataPoint) {
          // Convert lightweight-charts time to string format
          let dateStr = '';
          if (typeof param.time === 'number') {
            const dateObj = new Date(param.time * 1000);
            dateStr = dateObj.toISOString().replace('T', ' ').substring(0, 16);
          } else if (typeof param.time === 'string') {
            dateStr = param.time;
          } else if (param.time.year) {
            dateStr = `${param.time.year}-${String(param.time.month).padStart(2, '0')}-${String(param.time.day).padStart(2, '0')}`;
          }

          // Extract indicator data if available
          const smaPoint = smaSeries ? param.seriesData.get(smaSeries) : undefined;
          const emaPoint = emaSeries ? param.seriesData.get(emaSeries) : undefined;
          const bbUpperPoint = bbUpperSeries ? param.seriesData.get(bbUpperSeries) : undefined;
          const bbLowerPoint = bbLowerSeries ? param.seriesData.get(bbLowerSeries) : undefined;

          // RSI requires matching by time since it's on a different chart
          // But to be precise, lightweight-charts crosshair sync handles crosshair move on the same chart.
          // For RSI, we can find the exact data point by matching `param.time` against `data`.
          let rsiVal: number | undefined;
          if (indicators.rsi) {
            const rsiData = computeRSI(data, 14);
            const idx = data.findIndex(d => d.time === param.time);
            if (idx >= 0 && rsiData[idx] !== null) rsiVal = rsiData[idx] as number;
          }

          setHudData({
            open: dataPoint.open,
            high: dataPoint.high,
            low: dataPoint.low,
            close: dataPoint.close,
            date: dateStr,
            sma: smaPoint?.value,
            ema: emaPoint?.value,
            bbUpper: bbUpperPoint?.value,
            bbLower: bbLowerPoint?.value,
            rsi: rsiVal
          });
        } else {
          setHudData(null);
        }
      }
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    // Sync Custom Overlays
    const updateCustomOverlays = () => {
      if (!candleSeries || !chart) return;
      
      // Risk/Reward
      (drawings.riskRewards || []).forEach(tool => {
        const el = document.getElementById(`rr-tool-${tool.id}`);
        if (!el) return;

        const startX = chart.timeScale().timeToCoordinate(tool.entry.time as UTCTimestamp);
        if (startX === null) {
          el.style.display = 'none';
          return;
        }

        const entryY = candleSeries.priceToCoordinate(tool.entry.price);
        const tpY = candleSeries.priceToCoordinate(tool.tp);
        const slY = candleSeries.priceToCoordinate(tool.sl);

        if (entryY === null || tpY === null || slY === null) {
          el.style.display = 'none';
          return;
        }

        el.style.display = 'block';
        el.style.left = `${startX}px`;
        
        const profitTop = Math.min(entryY, tpY);
        const profitHeight = Math.abs(entryY - tpY);
        const lossTop = Math.min(entryY, slY);
        const lossHeight = Math.abs(entryY - slY);

        el.style.setProperty('--profit-top', `${profitTop}px`);
        el.style.setProperty('--profit-height', `${profitHeight}px`);
        el.style.setProperty('--loss-top', `${lossTop}px`);
        el.style.setProperty('--loss-height', `${lossHeight}px`);
        el.style.setProperty('--entry-y', `${entryY}px`);
      });

      // Fibonacci Retracement
      (drawings.fibonacci || []).forEach(tool => {
        const el = document.getElementById(`fib-tool-${tool.id}`);
        if (!el) return;

        // Sort times so x1 is earlier than x2
        const times = [tool.start.time, tool.end.time].sort((a, b) => a - b);
        const startX = chart.timeScale().timeToCoordinate(times[0] as UTCTimestamp);
        const endX = chart.timeScale().timeToCoordinate(times[1] as UTCTimestamp);
        
        if (startX === null) {
          el.style.display = 'none';
          return;
        }

        const width = endX !== null ? Math.max(endX - startX, 100) : 100;
        
        el.style.display = 'block';
        el.style.left = `${startX}px`;
        el.style.width = `${width}px`;

        const p1 = tool.start.price;
        const p2 = tool.end.price;
        const range = p2 - p1;
        
        const y1 = candleSeries.priceToCoordinate(p1);
        const y2 = candleSeries.priceToCoordinate(p2);
        if (y1 !== null && y2 !== null) {
           el.style.setProperty('--fib-top', `${Math.min(y1, y2)}px`);
           el.style.setProperty('--fib-height', `${Math.abs(y1 - y2)}px`);
        }

        [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach(ratio => {
          const levelPrice = p1 + (range * ratio);
          const y = candleSeries.priceToCoordinate(levelPrice);
          if (y !== null) {
            el.style.setProperty(`--fib-y-${ratio.toString().replace('.', '_')}`, `${y}px`);
          }
        });
      });

      // Forex Session Shading Overlay Bands Position Sync
      if (showSessionShading && sessionBlocks.length > 0) {
        sessionBlocks.forEach(block => {
          const el = document.getElementById(`session-band-${block.id}`);
          if (!el) return;

          const startX = chart.timeScale().timeToCoordinate(block.startTime as any);
          const endX = chart.timeScale().timeToCoordinate(block.endTime as any);

          if (startX === null || endX === null) {
            el.style.display = 'none';
            return;
          }

          const chartWidth = containerRef.current?.clientWidth || 1000;
          const left = Math.max(0, Math.min(startX, endX));
          const right = Math.min(chartWidth, Math.max(startX, endX));
          const width = right - left;

          if (width > 0 && left < chartWidth && right > 0) {
            el.style.display = 'block';
            el.style.left = `${left}px`;
            el.style.width = `${width}px`;
          } else {
            el.style.display = 'none';
          }
        });
      }

      // Trade Entry/Exit Animated Overlays Position Sync
      if (showTradeAnimations && symbolTradesToAnimate.length > 0) {
        const latestCandle = data && data.length > 0 ? data[data.length - 1] : null;

        symbolTradesToAnimate.forEach(trade => {
          const el = document.getElementById(`trade-anim-overlay-${trade.id}`);
          if (!el || !latestCandle) return;

          let entryCandle = latestCandle;
          if (data && data.length > 0) {
            const match = data.slice().reverse().find(c => {
              const cDateStr = new Date(c.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return trade.time?.includes(cDateStr) || Math.abs(c.time * 1000 - new Date(trade.time).getTime()) < 3600000;
            });
            if (match) entryCandle = match;
          }

          const entryX = chart.timeScale().timeToCoordinate(entryCandle.time as any);
          const entryY = candleSeries.priceToCoordinate(trade.entryPrice);

          if (entryX === null || entryY === null) {
            el.style.display = 'none';
            return;
          }

          el.style.display = 'block';
          el.style.left = `${entryX}px`;
          el.style.top = `${entryY}px`;

          // Match closest candlestick pattern prior to entry
          const pattern = patterns?.find(p => p.time <= entryCandle.time);
          if (pattern && showPatternBeams) {
            const patX = chart.timeScale().timeToCoordinate(pattern.time as any);
            const patY = candleSeries.priceToCoordinate(entryCandle.close);
            if (patX !== null && patY !== null) {
              el.style.setProperty('--pat-dx', `${patX - entryX}px`);
              el.style.setProperty('--pat-dy', `${patY - entryY}px`);
            }
          }

          if (trade.isClosed) {
            const exitPrice = trade.exitPrice || trade.entryPrice;
            const exitX = chart.timeScale().timeToCoordinate(latestCandle.time as any);
            const exitY = candleSeries.priceToCoordinate(exitPrice);

            if (exitX !== null && exitY !== null) {
              el.style.setProperty('--exit-dx', `${exitX - entryX}px`);
              el.style.setProperty('--exit-dy', `${exitY - entryY}px`);
            }
          }
        });
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(updateCustomOverlays);
    chart.timeScale().subscribeSizeChange(updateCustomOverlays);
    setTimeout(updateCustomOverlays, 50);

    // Cleanup
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateCustomOverlays);
      chart.timeScale().unsubscribeSizeChange(updateCustomOverlays);
      resizeObserver.disconnect();
      if (chartContainerEl) {
        chartContainerEl.removeEventListener('dblclick', handleDblClick);
      }
      handlers.forEach(h => h());
      chart.unsubscribeClick(handleChartClick);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      if (candleSeries) {
        activePriceLines.forEach(line => candleSeries.removePriceLine(line));
        if (indicators.fibonacci) {
          fibLines.forEach(line => candleSeries.removePriceLine(line));
        }
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
      }
      if (macdChartRef.current) {
        macdChartRef.current.remove();
        macdChartRef.current = null;
      }
    };
  }, [symbol, timeframe, data, indicators, patterns, visibleChartPatterns, highlightedPattern, drawings, isExpandedFullScreen, preferredHeight, chartHeight, sessionBlocks, showSessionShading, symbolTradesToAnimate, showTradeAnimations, showPatternBeams, isRsiMinimized, isMacdMinimized]);

  return (
    <div 
      className={`flex flex-col gap-2 w-full select-none ${
        isExpandedFullScreen 
          ? 'fixed inset-0 z-50 ' + (theme === 'dark' ? 'bg-zinc-950' : 'bg-zinc-100') + ' p-6 flex flex-col overflow-y-auto' 
          : 'relative'
      }`} 
      id="trading_canvas_wrapper"
    >
      {/* Header element (shown in full-screen or regular format) */}
      <div className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'} border rounded-lg py-2 px-3.5 shadow-md`}>
        <div className="flex items-center gap-3">
          <span className={`font-display font-black text-sm ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'} flex items-center gap-1.5 leading-none`}>
            {symbol.slice(0, 3)}/{symbol.slice(3)}
            <span className="text-emerald-400 text-[10px] px-1 py-0.5 rounded bg-emerald-950/40 border border-emerald-900/30 uppercase font-mono">{timeframe}</span>
          </span>
          <div className={`text-[10px] ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'} font-mono hidden sm:flex items-center gap-2`}>
            <span>O: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{data[data.length - 1]?.open}</strong></span>
            <span>H: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{data[data.length - 1]?.high}</strong></span>
            <span>L: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{data[data.length - 1]?.low}</strong></span>
            <span>C: <strong className={data[data.length - 1]?.close >= data[data.length - 1]?.open ? 'text-green-500' : 'text-rose-500'}>{data[data.length - 1]?.close}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTool !== 'none' && (
            <div className="text-[10px] font-mono text-amber-400 flex items-center gap-1 animate-pulse bg-amber-950/20 px-2 py-0.5 rounded border border-amber-900/30">
              <AlertCircle className="w-3 h-3" />
              <span>
                {activeTool === 'horizontal' && 'Click chart to place Support/Resistance'}
                {activeTool === 'trendline_start' && 'Click chart for Trendline START point'}
                {activeTool === 'trendline_end' && 'Click chart for Trendline END point'}
                {activeTool === 'annotation' && 'Click chart to add Custom Text label'}
                {activeTool === 'rr_long' && 'Click chart to place Long Position entry'}
                {activeTool === 'rr_short' && 'Click chart to place Short Position entry'}
                {activeTool === 'fib_start' && 'Click chart for Fibonacci START point'}
                {activeTool === 'fib_end' && 'Click chart for Fibonacci END point'}
              </span>
            </div>
          )}

          {/* Quick Timeframe Bar */}
          <div className="hidden lg:flex items-center gap-1 bg-zinc-950/60 p-1 rounded border border-zinc-800/60 text-[10px] font-mono font-bold">
            {(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setSelectedTimeframe(tf)}
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
            {[
              { label: 'Medium', val: 460 },
              { label: 'Large', val: 620 },
              { label: 'XL', val: 780 }
            ].map((size) => (
              <button
                key={size.val}
                type="button"
                onClick={() => handleSetChartHeight(size.val)}
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
            onClick={() => setShowChartSidebar(!showChartSidebar)}
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
            onClick={handleTakeSnapshot}
            className={`p-1.5 ${theme === 'dark' ? 'bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-400 hover:text-emerald-200 border-emerald-900/60 hover:border-emerald-700' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-750 border-emerald-200 hover:border-emerald-300'} rounded border transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-mono font-bold`}
            title="Take a snapshot of this chart and analyze with Co-Pilot"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Snapshot for AI</span>
          </button>

          <button
            onClick={() => setIsExpandedFullScreen(!isExpandedFullScreen)}
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

      <div className="flex items-stretch gap-3 w-full h-full min-h-0">
        
        {/* Drawing Toolbar (vertical layout on the left side) */}
        <div className={`flex flex-col gap-2 p-1.5 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/80 text-zinc-100 shadow-xl' : 'bg-white border-zinc-200 text-zinc-900 shadow-lg'} border rounded-lg w-11 shrink-0 items-center justify-start py-4`}>
          <button
            onClick={() => { setActiveTool('none'); setTrendlineStart(null); }}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              activeTool === 'none' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
            }`}
            title="Normal Selection / Cursor"
          >
            <MousePointer className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              if (chartRef.current) {
                chartRef.current.timeScale().fitContent();
              }
            }}
            className={`p-2 rounded-lg text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'} transition-all cursor-pointer flex items-center justify-center relative group`}
            title="Auto Fit Chart (Fit all candles on screen)"
          >
            <Expand className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </button>

          <button
            onClick={() => setActiveTool('horizontal')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'horizontal' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
            }`}
            title="Horizontal Line (Support & Resistance Level)"
          >
            <Minus className="w-4 h-4" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />
          </button>

          <button
            onClick={() => setActiveTool('trendline_start')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'trendline_start' || activeTool === 'trendline_end' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
            }`}
            title="Trendline Tool (Click Start & End points)"
          >
            <TrendingUp className="w-4 h-4" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </button>

          <button
            onClick={() => setActiveTool('annotation')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'annotation' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
            }`}
            title="Text Label / Custom Note"
          >
            <Type className="w-4 h-4" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
          </button>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

          {/* Long / Short Risk/Reward Tool */}
          <button
            onClick={() => setActiveTool('rr_long')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'rr_long' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
            }`}
            title="Long Position (Risk/Reward)"
          >
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
          </button>
          <button
            onClick={() => setActiveTool('rr_short')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'rr_short' ? 'bg-red-600 text-white shadow-md shadow-red-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
            }`}
            title="Short Position (Risk/Reward)"
          >
            <ArrowDownRight className="w-4 h-4 text-red-400" />
          </button>

          <button
            onClick={() => setActiveTool('fib_start')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'fib_start' || activeTool === 'fib_end' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
            }`}
            title="Fibonacci Retracement"
          >
            <AlignJustify className="w-4 h-4" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-400" />
          </button>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />
          <div className="flex flex-col gap-1.5 py-1 items-center">
            {[
              { name: 'gold', value: '#eab308' },
              { name: 'emerald', value: '#22c55e' },
              { name: 'rose', value: '#f43f5e' },
              { name: 'blue', value: '#3b82f6' },
              { name: 'purple', value: '#a855f7' },
            ].map((col) => (
              <button
                key={col.value}
                onClick={() => setSelectedColor(col.value)}
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
            onClick={() => setShowDrawingsManager(!showDrawingsManager)}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              showDrawingsManager ? (theme === 'dark' ? 'bg-zinc-800 text-emerald-400 border border-zinc-700' : 'bg-zinc-100 text-emerald-600 border border-zinc-300') : `text-zinc-400 hover:text-white ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800'}`
            }`}
            title="Manage Active Drawing Layers"
          >
            <Layers className="w-4 h-4" />
          </button>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

          <button
            onClick={handleClearDrawings}
            className={`p-2 rounded-lg text-rose-400 hover:text-rose-200 ${theme === 'dark' ? 'hover:bg-rose-950/40' : 'hover:bg-rose-50'} transition-all cursor-pointer flex items-center justify-center`}
            title="Delete All Custom Drawings"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Dynamic Drawings List Side Drawer */}
        {showDrawingsManager && (
          <div className={`w-60 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/80 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'} border rounded-lg p-3 flex flex-col gap-3 shrink-0 h-full overflow-y-auto shadow-2xl animate-fade-in`}>
            <div className={`flex items-center justify-between border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'} pb-2`}>
              <span className={`text-[11px] font-mono font-bold ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} uppercase tracking-wider flex items-center gap-1.5`}>
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Drawing Layers
              </span>
              <button 
                onClick={() => setShowDrawingsManager(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
            
            {/* Horizontal Lines List */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Support &amp; Resistance ({drawings.horizontalLines.length})
              </div>
              {drawings.horizontalLines.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No horizontal lines</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.horizontalLines.map((item, idx) => {
                    const price = typeof item === 'number' ? item : item.price;
                    const color = typeof item === 'object' && item.color ? item.color : '#22c55e';
                    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
                    return (
                      <div key={idx} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          <span className={theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}>{price.toFixed(config.pipDecimal + 1)}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              horizontalLines: prev.horizontalLines.filter((_, i) => i !== idx)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete line"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Trendlines List */}
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Trendlines ({drawings.trendlines.length})
              </div>
              {drawings.trendlines.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No trendlines</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.trendlines.map((tl, idx) => {
                    const color = tl.color || '#eab308';
                    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
                    return (
                      <div key={idx} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          <span className={theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}>TL #{idx + 1} ({Math.abs(tl.end.price - tl.start.price).toFixed(config.pipDecimal + 1)})</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              trendlines: prev.trendlines.filter((_, i) => i !== idx)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete trendline"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Annotations List */}
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Labels &amp; Notes ({drawings.annotations.length})
              </div>
              {drawings.annotations.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No custom notes</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.annotations.map((ann, idx) => {
                    const color = ann.color || '#a855f7';
                    return (
                      <div key={idx} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5 min-w-0 max-w-[80%]">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} truncate`} title={ann.text}>{ann.text}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              annotations: prev.annotations.filter((_, i) => i !== idx)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete label"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Risk/Reward Tools List */}
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Long/Short Tools ({(drawings.riskRewards || []).length})
              </div>
              {(drawings.riskRewards || []).length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No setups</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.riskRewards.map((tool) => {
                    return (
                      <div key={tool.id} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5">
                          {tool.type === 'long' ? <ArrowUpRight className="w-3 h-3 text-emerald-400" /> : <ArrowDownRight className="w-3 h-3 text-red-400" />}
                          <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} capitalize`}>{tool.type} @ {tool.entry.price.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              riskRewards: prev.riskRewards.filter(t => t.id !== tool.id)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete tool"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Fibonacci List */}
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Fibonacci ({(drawings.fibonacci || []).length})
              </div>
              {(drawings.fibonacci || []).length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No fibs</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.fibonacci.map((tool) => {
                    return (
                      <div key={tool.id} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5">
                          <AlignJustify className="w-3 h-3 text-blue-400" />
                          <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} capitalize`}>Fib @ {tool.start.price.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              fibonacci: prev.fibonacci.filter(t => t.id !== tool.id)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete tool"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pattern Markers Layer Section */}
            <div className={`space-y-2 mt-3 pt-2.5 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase text-zinc-400 font-bold tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  Pattern Layer ({visibleChartPatterns.length})
                </div>
                <button
                  type="button"
                  onClick={() => setShowPatternMarkers(!showPatternMarkers)}
                  className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded cursor-pointer ${
                    showPatternMarkers 
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-900/50' 
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {showPatternMarkers ? 'VISIBLE' : 'HIDDEN'}
                </button>
              </div>

              {showPatternMarkers && (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {patterns.length === 0 ? (
                    <div className="text-[10px] text-zinc-600 italic px-1">No historical patterns detected</div>
                  ) : (
                    patterns.map((pat) => {
                      const isHighlighted = highlightedPattern && highlightedPattern.id === pat.id;
                      const isBullish = pat.type === 'bullish';
                      return (
                        <div
                          key={pat.id}
                          className={`flex items-center justify-between border rounded px-2 py-1 text-[10px] font-mono transition-all ${
                            isHighlighted
                              ? 'bg-emerald-950/50 border-emerald-500 text-emerald-300 shadow-sm'
                              : (theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:border-zinc-300')
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate pr-1">
                            <span className={isBullish ? 'text-emerald-400' : 'text-rose-400'}>
                              {isBullish ? '▲' : '▼'}
                            </span>
                            <span className="truncate">{pat.name}</span>
                            {pat.winRate && (
                              <span className="text-[9px] text-zinc-500 font-bold">
                                {pat.winRate}%
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setHighlightedPattern(isHighlighted ? null : pat)}
                            className={`p-1 rounded cursor-pointer ${
                              isHighlighted ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-200'
                            }`}
                            title="Highlight and focus pattern on chart"
                          >
                            <Eye className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Primary Chart Canvas and sub-charts wrapper */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <div 
            className={`w-full rounded-lg border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'} overflow-hidden relative`}
            style={{ height: `${chartHeight}px` }}
          >
            <div 
              ref={containerRef} 
              className="absolute inset-0 z-10"
              id="tv_main_price_chart"
            />

            {/* Forex Session Shading Bands Layer */}
            {showSessionShading && (
              <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
                {sessionBlocks.map((block) => {
                  const isDark = theme === 'dark';
                  return (
                    <div
                      key={block.id}
                      id={`session-band-${block.id}`}
                      className="absolute top-0 bottom-0 pointer-events-none border-x transition-opacity duration-200"
                      style={{
                        display: 'none',
                        backgroundColor: isDark ? block.session.bgDark : block.session.bgLight,
                        borderColor: isDark ? block.session.borderDark : block.session.borderLight,
                      }}
                    >
                      {/* Session Header Badge Tag */}
                      <div
                        className="absolute left-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider backdrop-blur-md shadow-sm border flex items-center gap-1 z-10 select-none"
                        style={{
                          top: `${block.session.badgePosTop}px`,
                          backgroundColor: isDark ? 'rgba(9, 9, 11, 0.88)' : 'rgba(255, 255, 255, 0.95)',
                          color: isDark ? block.session.textDark : block.session.textLight,
                          borderColor: isDark ? block.session.borderDark : block.session.borderLight,
                        }}
                      >
                        <span>{block.session.flag}</span>
                        <span>{block.session.city} SESSION</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Live Active Sessions Badge Strip */}
            <div className="absolute top-3 left-3 z-20 pointer-events-none flex items-center gap-1.5 flex-wrap max-w-md">
              {FOREX_SESSIONS.filter(s => enabledSessions[s.key] && isSessionActiveAtTime(s, Math.floor(Date.now() / 1000))).map(activeSess => (
                <div
                  key={activeSess.key}
                  className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold border backdrop-blur-md shadow-sm flex items-center gap-1 transition-all ${
                    theme === 'dark' 
                      ? 'bg-zinc-950/80 border-amber-500/40 text-amber-300' 
                      : 'bg-white/90 border-amber-300 text-amber-800'
                  }`}
                  title={`${activeSess.name} is currently OPEN (${getSessionLocalHoursString(activeSess)} ${getLocalTimezoneName()})`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>{activeSess.flag} {activeSess.city} OPEN</span>
                </div>
              ))}
            </div>

            {/* Price Streak Indicator Overlay */}
            {priceStreak.count > 0 && (
              <div 
                className={`absolute top-3 right-3 z-20 backdrop-blur-sm border px-3 py-1.5 rounded-md flex items-center gap-1.5 text-xs font-mono select-none pointer-events-auto shadow-lg transition-all ${
                  priceStreak.type === 'bullish'
                    ? (theme === 'dark' ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400' : 'bg-emerald-50/90 border-emerald-300 text-emerald-700')
                    : (theme === 'dark' ? 'bg-rose-950/80 border-rose-500/50 text-rose-400' : 'bg-rose-50/90 border-rose-300 text-rose-700')
                }`}
                title={`Market has formed ${priceStreak.count} consecutive ${priceStreak.type} candles in the current ${timeframe} timeframe.`}
              >
                <span className="flex h-2 w-2 relative">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    priceStreak.type === 'bullish' ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    priceStreak.type === 'bullish' ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}></span>
                </span>
                <span className="font-bold tracking-tight">
                  STREAK: {priceStreak.count} {priceStreak.type.toUpperCase()}
                </span>
              </div>
            )}
            {/* Risk/Reward Custom Overlays */}
            <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
              {(drawings.riskRewards || []).map(tool => (
                <div
                  key={tool.id}
                  id={`rr-tool-${tool.id}`}
                  className="absolute pointer-events-none"
                  style={{ width: '120px', display: 'none' }}
                >
                  {/* Profit Zone */}
                  <div 
                     className={`absolute w-full ${tool.type === 'long' ? 'bg-emerald-500/20' : 'bg-emerald-500/20'}`}
                     style={{
                        top: 'var(--profit-top)',
                        height: 'var(--profit-height)',
                        borderTop: tool.type === 'long' ? '1px solid rgba(16, 185, 129, 0.6)' : 'none',
                        borderBottom: tool.type === 'short' ? '1px solid rgba(16, 185, 129, 0.6)' : 'none',
                     }}
                  >
                    <div className={`text-[10px] text-emerald-400 px-1 font-mono font-medium leading-none absolute ${tool.type === 'long' ? 'top-0.5' : 'bottom-0.5'}`}>
                      TP {tool.tp.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}
                    </div>
                  </div>
                  
                  {/* Loss Zone */}
                  <div 
                     className={`absolute w-full ${tool.type === 'long' ? 'bg-red-500/20' : 'bg-red-500/20'}`}
                     style={{
                        top: 'var(--loss-top)',
                        height: 'var(--loss-height)',
                        borderBottom: tool.type === 'long' ? '1px solid rgba(239, 68, 68, 0.6)' : 'none',
                        borderTop: tool.type === 'short' ? '1px solid rgba(239, 68, 68, 0.6)' : 'none',
                     }}
                  >
                    <div className={`text-[10px] text-red-400 px-1 font-mono font-medium leading-none absolute ${tool.type === 'long' ? 'bottom-0.5' : 'top-0.5'}`}>
                      SL {tool.sl.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}
                    </div>
                  </div>
                  
                  {/* Entry Line */}
                  <div className="absolute w-full border-t border-zinc-400/80 z-20" style={{ top: 'var(--entry-y)' }}>
                    <div className="text-[10px] text-zinc-300 font-mono pl-1 -mt-3 drop-shadow-md">Entry</div>
                  </div>
                </div>
              ))}

              {(drawings.fibonacci || []).map(tool => {
                const color = tool.color || '#3b82f6'; // default blue
                return (
                  <div
                    key={tool.id}
                    id={`fib-tool-${tool.id}`}
                    className="absolute pointer-events-none"
                    style={{ display: 'none' }}
                  >
                    {/* Background shaded area */}
                    <div className="absolute w-full bg-blue-500/5" style={{ top: 'var(--fib-top)', height: 'var(--fib-height)' }} />
                    
                    {[0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(ratio => {
                      const ratioStr = ratio.toString().replace('.', '_');
                      // use standard fib colors if no specific color is set
                      let levelColor = color;
                      if (!tool.color) {
                         if (ratio === 0.618 || ratio === 0.382) levelColor = '#eab308';
                         else if (ratio === 0.5) levelColor = '#10b981';
                         else if (ratio === 1 || ratio === 0) levelColor = '#94a3b8';
                      }
                      return (
                        <div 
                          key={ratio}
                          className="absolute w-full border-t border-dashed z-20 flex items-center justify-end"
                          style={{ 
                            top: `var(--fib-y-${ratioStr})`, 
                            borderColor: levelColor,
                            opacity: 0.8
                          }}
                        >
                          <div 
                            className="text-[9px] font-mono font-medium px-1 mt-0.5 rounded-bl shadow-sm"
                            style={{ color: levelColor, backgroundColor: 'rgba(0,0,0,0.4)' }}
                          >
                            {ratio}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Trade Entry/Exit Animated Overlays Layer */}
              {showTradeAnimations && symbolTradesToAnimate.length > 0 && (
                <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
                  {symbolTradesToAnimate.map((trade) => {
                    const isBuy = trade.type === 'BUY';
                    const isClosed = trade.isClosed;
                    const pnl = trade.pnl || 0;

                    return (
                      <div
                        key={trade.id}
                        id={`trade-anim-overlay-${trade.id}`}
                        className="absolute pointer-events-none"
                        style={{ display: 'none', width: 0, height: 0 }}
                      >
                        {/* Pattern-to-Trade Vector Execution Beam */}
                        {showPatternBeams && (
                          <svg className="absolute overflow-visible pointer-events-none z-10" style={{ left: 0, top: 0 }}>
                            <defs>
                              <linearGradient id={`beam-grad-${trade.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
                                <stop offset="100%" stopColor={isBuy ? '#10b981' : '#f43f5e'} stopOpacity="0.95" />
                              </linearGradient>
                            </defs>
                            <line
                              x1="var(--pat-dx, 0px)"
                              y1="var(--pat-dy, 0px)"
                              x2="0"
                              y2="0"
                              stroke={`url(#beam-grad-${trade.id})`}
                              strokeWidth="2"
                              strokeDasharray="4 4"
                              className="animate-pulse"
                            />
                            <circle
                              cx="var(--pat-dx, 0px)"
                              cy="var(--pat-dy, 0px)"
                              r="3.5"
                              fill="#38bdf8"
                              className="animate-ping"
                            />
                          </svg>
                        )}

                        {/* Entry Point Animated Pulse Marker */}
                        <motion.div
                          initial={{ scale: 0.3, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                          className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                        >
                          {/* Subtle Expanding Ripple Ring */}
                          <motion.div
                            animate={{
                              scale: [1, 2.2, 1],
                              opacity: [0.85, 0.1, 0.85],
                            }}
                            transition={{
                              duration: 2.2,
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }}
                            className={`absolute inset-0 -m-2.5 rounded-full border-2 ${
                              isBuy
                                ? 'border-emerald-400 bg-emerald-500/20'
                                : 'border-rose-400 bg-rose-500/20'
                            }`}
                          />

                          {/* Entry Badge */}
                          <div
                            className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-extrabold border shadow-xl backdrop-blur-md flex items-center gap-1.5 whitespace-nowrap cursor-pointer hover:scale-105 transition-transform ${
                              isBuy
                                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/80 shadow-emerald-950/60'
                                : 'bg-rose-950/90 text-rose-300 border-rose-500/80 shadow-rose-950/60'
                            }`}
                            title={`Trade ${trade.id} placed at ${trade.time} (@ ${trade.entryPrice})`}
                          >
                            <Zap className="w-3 h-3 text-amber-400 animate-bounce" />
                            <span>{isBuy ? 'BUY ENTRY' : 'SELL ENTRY'}</span>
                            <span className="opacity-75">{trade.amount}L</span>
                            <span className="font-bold">
                              @{trade.entryPrice.toFixed((PAIRS_CONFIG[symbol] || { pipDecimal: 4 }).pipDecimal)}
                            </span>
                          </div>
                        </motion.div>

                        {/* Closed Trade Vector Line & Exit Marker + Floating PnL Badge */}
                        {isClosed && (
                          <>
                            {/* Connector line between entry and exit */}
                            <svg className="absolute overflow-visible pointer-events-none z-10" style={{ left: 0, top: 0 }}>
                              <line
                                x1="0"
                                y1="0"
                                x2="var(--exit-dx, 0px)"
                                y2="var(--exit-dy, 0px)"
                                stroke={pnl >= 0 ? '#10b981' : '#f43f5e'}
                                strokeWidth="2"
                                strokeDasharray="5 3"
                                opacity="0.85"
                              />
                            </svg>

                            {/* Exit Pulse Target Node */}
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 350, damping: 18 }}
                              className="absolute pointer-events-auto z-20"
                              style={{
                                left: 'var(--exit-dx, 0px)',
                                top: 'var(--exit-dy, 0px)',
                                transform: 'translate(-50%, -50%)',
                              }}
                            >
                              <div
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shadow-xl ${
                                  pnl >= 0
                                    ? 'bg-emerald-950 border-emerald-400 text-emerald-300'
                                    : 'bg-rose-950 border-rose-400 text-rose-300'
                                }`}
                                title={`Trade Exit @ ${(trade.exitPrice || trade.entryPrice).toFixed((PAIRS_CONFIG[symbol] || { pipDecimal: 4 }).pipDecimal)}`}
                              >
                                🎯
                              </div>

                              {/* Floating Realized PnL Badge */}
                              <motion.div
                                initial={{ opacity: 0, y: 12, scale: 0.8 }}
                                animate={{ opacity: 1, y: -22, scale: 1 }}
                                transition={{
                                  type: 'spring',
                                  damping: 14,
                                  stiffness: 220,
                                  delay: 0.1,
                                }}
                                className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 pointer-events-auto"
                              >
                                <div
                                  className={`px-2 py-0.5 rounded-md border text-[9px] font-mono font-extrabold shadow-2xl backdrop-blur-md flex items-center gap-1 whitespace-nowrap ${
                                    pnl >= 0
                                      ? 'bg-emerald-950/95 border-emerald-500/80 text-emerald-300 shadow-emerald-950/80'
                                      : 'bg-rose-950/95 border-rose-500/80 text-rose-300 shadow-rose-950/80'
                                  }`}
                                >
                                  <Sparkles className="w-2.5 h-2.5 text-amber-400 animate-spin" />
                                  <span>
                                    {pnl >= 0
                                      ? `+$${pnl.toFixed(2)}`
                                      : `-$${Math.abs(pnl).toFixed(2)}`}
                                  </span>
                                  <span className="text-[7.5px] opacity-80 uppercase px-1 py-0.2 rounded bg-black/40">
                                    {trade.closeReason || 'Closed'}
                                  </span>
                                </div>
                              </motion.div>
                            </motion.div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* HUD Overlay */}
            {hudData && (
              <div className={`absolute top-3 left-3 z-20 ${theme === 'dark' ? 'bg-zinc-950/80 border-zinc-800/80 text-zinc-100' : 'bg-white/90 border-zinc-200 text-zinc-800'} backdrop-blur-sm border rounded-md py-2 px-3 flex flex-col gap-1 text-[11px] font-mono select-none pointer-events-none shadow-lg animate-in fade-in duration-200`}>
                <div className={`text-zinc-400 font-bold mb-1 border-b ${theme === 'dark' ? 'border-zinc-800/50' : 'border-zinc-200'} pb-1 flex justify-between items-center gap-4`}>
                  <span>{hudData.date}</span>
                  <span className="text-[9px] text-zinc-500 font-normal">HUD</span>
                </div>
                <div className="flex gap-3 mb-0.5">
                  <span className="flex gap-1.5"><span className="text-zinc-500">O</span><span className={`font-semibold ${hudData.open > hudData.close ? 'text-red-500' : 'text-emerald-500'}`}>{hudData.open.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span></span>
                  <span className="flex gap-1.5"><span className="text-zinc-500">H</span><span className={`font-semibold ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>{hudData.high.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span></span>
                  <span className="flex gap-1.5"><span className="text-zinc-500">L</span><span className={`font-semibold ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>{hudData.low.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span></span>
                  <span className="flex gap-1.5"><span className="text-zinc-500">C</span><span className={`font-semibold ${hudData.close >= hudData.open ? 'text-emerald-500' : 'text-red-500'}`}>{hudData.close.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span></span>
                </div>
                
                {/* Indicator Values */}
                {(hudData.sma !== undefined || hudData.ema !== undefined || hudData.bbUpper !== undefined || hudData.rsi !== undefined) && (
                  <div className={`flex flex-col gap-0.5 mt-1 pt-1 border-t ${theme === 'dark' ? 'border-zinc-800/50' : 'border-zinc-200'}`}>
                    {hudData.sma !== undefined && (
                      <div className="flex justify-between gap-4">
                        <span className="text-zinc-500">SMA(20)</span>
                        <span className="text-blue-400 font-semibold">{hudData.sma.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                      </div>
                    )}
                    {hudData.ema !== undefined && (
                      <div className="flex justify-between gap-4">
                        <span className="text-zinc-500">EMA(50)</span>
                        <span className="text-yellow-400 font-semibold">{hudData.ema.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                      </div>
                    )}
                    {hudData.bbUpper !== undefined && hudData.bbLower !== undefined && (
                      <div className="flex justify-between gap-4">
                        <span className="text-zinc-500">BB(20,2)</span>
                        <span className="text-purple-400 font-semibold">{hudData.bbUpper.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)} / {hudData.bbLower.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                      </div>
                    )}
                    {hudData.rsi !== undefined && (
                      <div className="flex justify-between gap-4">
                        <span className="text-zinc-500">RSI(14)</span>
                        <span className={`font-semibold ${hudData.rsi > 70 ? 'text-red-400' : hudData.rsi < 30 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {hudData.rsi.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RSI Panel */}
          {indicators.rsi && (
            <div className="flex flex-col w-full gap-1 animate-fade-in" id="rsi_panel_wrapper">
              <div className={`flex items-center justify-between text-[11px] font-mono px-3 py-1.5 ${theme === 'dark' ? 'text-zinc-300 bg-zinc-900 border-zinc-800' : 'text-zinc-700 bg-zinc-50 border-zinc-200'} rounded-lg border shadow-sm`}>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsRsiMinimized(!isRsiMinimized)}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title={isRsiMinimized ? "Expand RSI Sub-chart" : "Minimize RSI Sub-chart"}
                  >
                    {isRsiMinimized ? <ChevronDown className="w-3.5 h-3.5 text-emerald-400" /> : <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />}
                  </button>
                  <span className="font-bold flex items-center gap-1.5 text-zinc-200">
                    <Activity className="w-3.5 h-3.5 text-rose-400" />
                    Relative Strength Index (RSI 14)
                  </span>
                  {hudData?.rsi !== undefined && (
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                      hudData.rsi > 70 ? 'bg-rose-950/80 text-rose-400 border-rose-800/80' :
                      hudData.rsi < 30 ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80' :
                      'bg-zinc-800 text-zinc-300 border-zinc-700'
                    }`}>
                      RSI: {hudData.rsi.toFixed(2)} {hudData.rsi > 70 ? '(Overbought)' : hudData.rsi < 30 ? '(Oversold)' : '(Neutral)'}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-400 hidden sm:inline">Oversold: &lt;30 | Overbought: &gt;70</span>
                  <button
                    onClick={() => setIsRsiMinimized(!isRsiMinimized)}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer transition-colors flex items-center gap-1 border border-zinc-700/60"
                  >
                    {isRsiMinimized ? (
                      <>
                        <ChevronDown className="w-3 h-3 text-emerald-400" />
                        <span>Expand</span>
                      </>
                    ) : (
                      <>
                        <ChevronUp className="w-3 h-3 text-zinc-400" />
                        <span>Minimize</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleToggleIndicator('rsi')}
                    className="p-1 rounded hover:bg-rose-950 hover:text-rose-400 text-zinc-500 cursor-pointer transition-colors"
                    title="Close RSI Panel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {!isRsiMinimized && (
                <div 
                  ref={rsiContainerRef} 
                  className={`w-full rounded-lg border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'} overflow-hidden ${
                    isExpandedFullScreen ? 'h-[110px]' : 'h-[100px]'
                  }`}
                  id="tv_rsi_indicator_chart"
                />
              )}
            </div>
          )}

          {/* MACD Panel */}
          {indicators.macd && (
            <div className="flex flex-col w-full gap-1 animate-fade-in" id="macd_panel_wrapper">
              <div className={`flex items-center justify-between text-[11px] font-mono px-3 py-1.5 ${theme === 'dark' ? 'text-zinc-300 bg-zinc-900 border-zinc-800' : 'text-zinc-700 bg-zinc-50 border-zinc-200'} rounded-lg border shadow-sm`}>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsMacdMinimized(!isMacdMinimized)}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title={isMacdMinimized ? "Expand MACD Sub-chart" : "Minimize MACD Sub-chart"}
                  >
                    {isMacdMinimized ? <ChevronDown className="w-3.5 h-3.5 text-cyan-400" /> : <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />}
                  </button>
                  <span className="font-bold flex items-center gap-1.5 text-zinc-200">
                    <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
                    MACD (12, 26, 9)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-blue-400 hidden sm:inline">Momentum &amp; Convergence</span>
                  <button
                    onClick={() => setIsMacdMinimized(!isMacdMinimized)}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer transition-colors flex items-center gap-1 border border-zinc-700/60"
                  >
                    {isMacdMinimized ? (
                      <>
                        <ChevronDown className="w-3 h-3 text-cyan-400" />
                        <span>Expand</span>
                      </>
                    ) : (
                      <>
                        <ChevronUp className="w-3 h-3 text-zinc-400" />
                        <span>Minimize</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleToggleIndicator('macd')}
                    className="p-1 rounded hover:bg-rose-950 hover:text-rose-400 text-zinc-500 cursor-pointer transition-colors"
                    title="Close MACD Panel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {!isMacdMinimized && (
                <div 
                  ref={macdContainerRef} 
                  className={`w-full rounded-lg border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'} overflow-hidden ${
                    isExpandedFullScreen ? 'h-[110px]' : 'h-[100px]'
                  }`}
                  id="tv_macd_indicator_chart"
                />
              )}
            </div>
          )}
        </div>

        {/* Consolidated Chart Tools & Indicators Sidebar */}
        <AnimatePresence>
          {showChartSidebar && (
            <motion.aside
              initial={{ opacity: 0, x: 20, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 330 }}
              exit={{ opacity: 0, x: 20, width: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 240 }}
              className={`shrink-0 border rounded-lg flex flex-col h-full min-h-[500px] overflow-hidden shadow-2xl z-20 ${
                theme === 'dark' ? 'bg-zinc-900 border-zinc-800/90 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
              }`}
              id="chart_tools_sidebar_panel"
            >
              {/* Sidebar Header */}
              <div className={`p-3 border-b flex items-center justify-between shrink-0 ${
                theme === 'dark' ? 'border-zinc-800/80 bg-zinc-950/60' : 'border-zinc-100 bg-zinc-50'
              }`}>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-xs uppercase tracking-wider text-emerald-400 leading-none">
                      Chart Tools &amp; Indicators
                    </h3>
                    <p className="text-[9px] text-zinc-400 font-mono mt-0.5">
                      Overlay Controls &amp; Signal Layers
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowChartSidebar(false)}
                  className={`p-1 rounded-md text-zinc-400 hover:text-zinc-200 ${
                    theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-200'
                  } cursor-pointer transition-colors`}
                  title="Close Chart Sidebar"
                  id="close_chart_sidebar_btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Navigation Tabs Bar */}
              <div className={`grid grid-cols-4 gap-1 p-1.5 border-b text-[10px] font-mono shrink-0 ${
                theme === 'dark' ? 'border-zinc-800/80 bg-zinc-950/30' : 'border-zinc-100 bg-zinc-100/50'
              }`}>
                {[
                  { id: 'indicators', label: 'Indicators', icon: BarChart2 },
                  { id: 'patterns_sessions', label: 'Overlays', icon: Sparkles },
                  { id: 'drawings', label: 'Drawings', icon: Layers },
                  { id: 'view_anims', label: 'Anims/View', icon: Zap },
                ].map((tab) => {
                  const IconComp = tab.icon;
                  const isActive = sidebarTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSidebarTab(tab.id as any)}
                      className={`py-1.5 px-1 rounded flex flex-col items-center justify-center gap-1 transition-all cursor-pointer font-bold ${
                        isActive
                          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                          : (theme === 'dark' ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200' : 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900')
                      }`}
                      id={`sidebar_tab_${tab.id}`}
                    >
                      <IconComp className="w-3.5 h-3.5" />
                      <span className="text-[9px] truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Sidebar Content Area */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs">
                {/* TAB 1: Technical Indicators */}
                {sidebarTab === 'indicators' && (
                  <div className="space-y-2.5 animate-fade-in">
                    <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                      <span>Technical Indicators</span>
                      <span className="text-emerald-400 font-extrabold">
                        {Object.values(indicators).filter(Boolean).length} Active
                      </span>
                    </div>

                    {[
                      {
                        key: 'sma' as const,
                        title: 'SMA 50 (Simple Moving Average)',
                        desc: '50-period moving average line for primary trend direction.',
                        badge: 'MA',
                        color: 'text-amber-400',
                      },
                      {
                        key: 'ema' as const,
                        title: 'EMA 20 (Exponential Moving Average)',
                        desc: '20-period dynamic momentum average line.',
                        badge: 'MA',
                        color: 'text-cyan-400',
                      },
                      {
                        key: 'rsi' as const,
                        title: 'RSI 14 (Relative Strength Index)',
                        desc: 'Sub-chart oscillator for oversold (<30) and overbought (>70).',
                        badge: 'Oscillator',
                        color: 'text-rose-400',
                      },
                      {
                        key: 'macd' as const,
                        title: 'MACD (12, 26, 9)',
                        desc: 'Sub-chart histogram for momentum convergence & divergence.',
                        badge: 'Histogram',
                        color: 'text-blue-400',
                      },
                      {
                        key: 'bollinger' as const,
                        title: 'Bollinger Bands (20, 2)',
                        desc: 'Volatility channel with upper & lower standard deviation bands.',
                        badge: 'Volatility',
                        color: 'text-purple-400',
                      },
                      {
                        key: 'fibonacci' as const,
                        title: 'Fibonacci Retracement Levels',
                        desc: 'Auto golden ratio price levels (0.236, 0.382, 0.500, 0.618).',
                        badge: 'Ratio',
                        color: 'text-emerald-400',
                      },
                    ].map((ind) => {
                      const active = indicators[ind.key];
                      return (
                        <div
                          key={ind.key}
                          onClick={() => handleToggleIndicator(ind.key)}
                          className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-start justify-between gap-2 ${
                            active
                              ? (theme === 'dark' ? 'bg-zinc-950 border-emerald-500/40 text-zinc-100 shadow-lg shadow-emerald-950/20' : 'bg-emerald-50/70 border-emerald-300 text-zinc-900')
                              : (theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/60 text-zinc-500 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-300')
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[9px] font-extrabold px-1 py-0.2 rounded uppercase ${
                                active ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-zinc-800 text-zinc-400'
                              }`}>
                                {ind.badge}
                              </span>
                              <span className={`font-bold text-[11px] ${active ? ind.color : ''}`}>
                                {ind.title}
                              </span>
                            </div>
                            <p className="text-[9.5px] text-zinc-400 leading-normal">
                              {ind.desc}
                            </p>
                          </div>

                          <div className={`w-8 h-4 rounded-full p-0.5 transition-colors shrink-0 ${
                            active ? 'bg-emerald-500' : 'bg-zinc-700'
                          }`}>
                            <div className={`w-3 h-3 rounded-full bg-white transition-transform ${
                              active ? 'translate-x-4' : 'translate-x-0'
                            }`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* TAB 2: Pattern Markers & Forex Sessions Overlays */}
                {sidebarTab === 'patterns_sessions' && (
                  <div className="space-y-3.5 animate-fade-in">
                    {/* Pattern Markers Layer Block */}
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                    }`}>
                      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                        <span className="text-[10px] font-bold uppercase text-emerald-400 flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                          Pattern Markers Overlay
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowPatternMarkers(!showPatternMarkers)}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded cursor-pointer ${
                            showPatternMarkers
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {showPatternMarkers ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[9px] uppercase text-zinc-400">Filter Pattern Markers</div>
                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                          {[
                            { id: 'all', label: 'All Patterns' },
                            { id: 'bullish', label: '🟢 Bullish Only' },
                            { id: 'bearish', label: '🔴 Bearish Only' },
                            { id: 'high_winrate', label: '⭐ Win > 70%' },
                          ].map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => {
                                setPatternMarkerFilter(f.id as any);
                                setShowPatternMarkers(true);
                              }}
                              className={`p-1.5 rounded text-left border cursor-pointer font-bold ${
                                patternMarkerFilter === f.id && showPatternMarkers
                                  ? 'bg-emerald-600 text-white border-emerald-500'
                                  : (theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-400' : 'bg-white border-zinc-200 text-zinc-700')
                              }`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="text-[9.5px] text-zinc-400 bg-zinc-900/60 p-2 rounded border border-zinc-800/40">
                        Showing <strong className="text-emerald-400">{visibleChartPatterns.length}</strong> matching candlestick pattern labels directly on chart candles.
                      </div>
                    </div>

                    {/* Forex Sessions Shading Block */}
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                    }`}>
                      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                        <span className="text-[10px] font-bold uppercase text-amber-400 flex items-center gap-1">
                          <Globe className="w-3.5 h-3.5 text-amber-400" />
                          Forex Trading Sessions
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowSessionShading(!showSessionShading)}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded cursor-pointer ${
                            showSessionShading
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {showSessionShading ? 'SHADING ON' : 'OFF'}
                        </button>
                      </div>

                      <div className="text-[9px] text-zinc-400 flex items-center gap-1 bg-zinc-900/60 p-1.5 rounded border border-zinc-800/50">
                        <Clock className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>Hours in <strong>{getLocalTimezoneName()} Local Time</strong></span>
                      </div>

                      <div className="space-y-1.5 text-[10px]">
                        {FOREX_SESSIONS.map((sess) => {
                          const isActive = enabledSessions[sess.key];
                          const localHoursStr = getSessionLocalHoursString(sess);
                          const isCurrentlyOpen = isSessionActiveAtTime(sess, Math.floor(Date.now() / 1000));

                          return (
                            <button
                              key={sess.key}
                              type="button"
                              onClick={() => {
                                setEnabledSessions(prev => ({ ...prev, [sess.key]: !prev[sess.key] }));
                                setShowSessionShading(true);
                              }}
                              className={`w-full p-2 rounded text-left border flex items-center justify-between cursor-pointer transition-colors ${
                                isActive && showSessionShading
                                  ? (theme === 'dark' ? 'bg-zinc-900 border-amber-900/60 text-zinc-100' : 'bg-white border-amber-300 text-zinc-900')
                                  : (theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-500 opacity-60' : 'bg-zinc-100 border-zinc-200 text-zinc-400')
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{sess.flag}</span>
                                <div>
                                  <div className="font-bold flex items-center gap-1.5">
                                    <span>{sess.name}</span>
                                    {isCurrentlyOpen && (
                                      <span className="text-[8px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1 rounded uppercase font-bold animate-pulse">
                                        OPEN NOW
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[9px] text-zinc-400">
                                    {localHoursStr} ({sess.utcStart.toString().padStart(2, '0')}:00–{sess.utcEnd.toString().padStart(2, '0')}:00 UTC)
                                  </div>
                                </div>
                              </div>
                              <span className={`font-bold ${isActive ? 'text-amber-400' : 'text-zinc-600'}`}>
                                {isActive ? '✓' : '✕'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 3: Drawing Tools & Layers */}
                {sidebarTab === 'drawings' && (
                  <div className="space-y-3 animate-fade-in">
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                    }`}>
                      <div className="text-[10px] font-bold uppercase text-emerald-400">
                        Active Drawing Tool
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        {[
                          { id: 'none', label: '🖱️ Pointer', tool: 'none' },
                          { id: 'horizontal', label: '➖ Support/Resist', tool: 'horizontal' },
                          { id: 'trendline', label: '📈 Trendline', tool: 'trendline_start' },
                          { id: 'annotation', label: '🔤 Text Note', tool: 'annotation' },
                          { id: 'rr_long', label: '🟢 Long Position', tool: 'rr_long' },
                          { id: 'rr_short', label: '🔴 Short Position', tool: 'rr_short' },
                          { id: 'fib', label: '📐 Fibonacci', tool: 'fib_start' },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setActiveTool(item.tool as any)}
                            className={`p-2 rounded text-left border cursor-pointer font-bold transition-all ${
                              activeTool === item.tool || (item.id === 'trendline' && activeTool === 'trendline_end') || (item.id === 'fib' && activeTool === 'fib_end')
                                ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                                : (theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100')
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>

                      {/* Color Palette */}
                      <div className="pt-2 border-t border-zinc-800/60 space-y-1">
                        <div className="text-[9px] uppercase text-zinc-400">Stroke Color</div>
                        <div className="flex items-center gap-2">
                          {[
                            { name: 'gold', value: '#eab308' },
                            { name: 'emerald', value: '#22c55e' },
                            { name: 'rose', value: '#f43f5e' },
                            { name: 'blue', value: '#3b82f6' },
                            { name: 'purple', value: '#a855f7' },
                          ].map((col) => (
                            <button
                              key={col.value}
                              onClick={() => setSelectedColor(col.value)}
                              className={`w-5 h-5 rounded-full border-2 transition-all cursor-pointer ${
                                selectedColor === col.value
                                  ? 'border-white scale-125 shadow-lg'
                                  : 'border-transparent hover:scale-110'
                              }`}
                              style={{ backgroundColor: col.value }}
                              title={`Use ${col.name} drawing color`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Drawing Layers List & Actions */}
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-zinc-300 flex items-center gap-1">
                          <Layers className="w-3.5 h-3.5 text-emerald-400" />
                          Layers ({drawings.horizontalLines.length + drawings.trendlines.length + drawings.annotations.length})
                        </span>
                        <button
                          type="button"
                          onClick={handleClearDrawings}
                          className="text-[9px] font-bold text-rose-400 hover:text-rose-200 bg-rose-950/40 border border-rose-900 px-2 py-0.5 rounded cursor-pointer"
                        >
                          Clear All
                        </button>
                      </div>

                      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {drawings.horizontalLines.map((item, idx) => {
                          const price = typeof item === 'number' ? item : item.price;
                          const color = typeof item === 'object' && item.color ? item.color : '#22c55e';
                          const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
                          return (
                            <div key={`h-${idx}`} className={`flex items-center justify-between p-1.5 rounded border text-[10px] ${
                              theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-700'
                            }`}>
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                <span>S/R: {price.toFixed(config.pipDecimal + 1)}</span>
                              </div>
                              <button
                                onClick={() => {
                                  setDrawings(prev => ({
                                    ...prev,
                                    horizontalLines: prev.horizontalLines.filter((_, i) => i !== idx)
                                  }));
                                }}
                                className="text-zinc-500 hover:text-rose-400"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}

                        {drawings.trendlines.map((tl, idx) => (
                          <div key={`t-${idx}`} className={`flex items-center justify-between p-1.5 rounded border text-[10px] ${
                            theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-700'
                          }`}>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tl.color || '#eab308' }} />
                              <span>Trendline #{idx + 1}</span>
                            </div>
                            <button
                              onClick={() => {
                                setDrawings(prev => ({
                                  ...prev,
                                  trendlines: prev.trendlines.filter((_, i) => i !== idx)
                                }));
                              }}
                              className="text-zinc-500 hover:text-rose-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 4: Animations & Chart View Settings */}
                {sidebarTab === 'view_anims' && (
                  <div className="space-y-3 animate-fade-in">
                    {/* Trade Entry/Exit Animations */}
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                    }`}>
                      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                        <span className="text-[10px] font-bold uppercase text-cyan-400 flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5 text-cyan-400" />
                          Trade Execution Animations
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowTradeAnimations(!showTradeAnimations)}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded cursor-pointer ${
                            showTradeAnimations
                              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {showTradeAnimations ? 'ANIMATIONS ON' : 'OFF'}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowPatternBeams(!showPatternBeams)}
                        className={`w-full p-2 rounded text-left border flex items-center justify-between cursor-pointer ${
                          showPatternBeams && showTradeAnimations
                            ? (theme === 'dark' ? 'bg-zinc-900 border-cyan-900/60 text-cyan-200' : 'bg-white border-cyan-300 text-zinc-900')
                            : (theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-500 opacity-60' : 'bg-zinc-100 border-zinc-200 text-zinc-400')
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                          <div>
                            <div className="font-bold">Pattern Execution Beams</div>
                            <div className="text-[9px] text-zinc-400">Connects detected pattern to entry moment</div>
                          </div>
                        </div>
                        <span className={`font-bold ${showPatternBeams ? 'text-cyan-400' : 'text-zinc-600'}`}>
                          {showPatternBeams ? '✓' : '✕'}
                        </span>
                      </button>

                      <div className="space-y-1">
                        <div className="text-[9px] uppercase text-zinc-400">Trade Overlay Filter</div>
                        <div className="grid grid-cols-3 gap-1 text-[9px]">
                          {[
                            { id: 'all', label: 'All Trades' },
                            { id: 'open', label: 'Open Only' },
                            { id: 'closed', label: 'Closed Only' },
                          ].map(f => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => setAnimTradeFilter(f.id as any)}
                              className={`py-1 px-1 rounded text-center border cursor-pointer font-bold ${
                                animTradeFilter === f.id
                                  ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                                  : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                              }`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Quick Timeframe & View Actions */}
                    <div className={`p-3 rounded-lg border space-y-2 ${
                      theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                    }`}>
                      <div className="text-[10px] font-bold uppercase text-zinc-300">
                        Timeframe Selector
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[10px]">
                        {(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => setSelectedTimeframe(tf)}
                            className={`py-1.5 rounded text-center border font-bold cursor-pointer transition-colors ${
                              timeframe === tf
                                ? 'bg-emerald-600 text-white border-emerald-500'
                                : (theme === 'dark' ? 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200' : 'bg-white text-zinc-600 border-zinc-200 hover:text-zinc-900')
                            }`}
                          >
                            {tf.toUpperCase()}
                          </button>
                        ))}
                      </div>

                      <div className="pt-2 border-t border-zinc-800/60 space-y-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (chartRef.current) chartRef.current.timeScale().fitContent();
                          }}
                          className={`w-full p-2 rounded text-left border flex items-center gap-2 cursor-pointer ${
                            theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800' : 'bg-white border-zinc-200 text-zinc-800 hover:bg-zinc-100'
                          }`}
                        >
                          <Expand className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="font-bold">Auto Fit Chart View</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleTakeSnapshot}
                          className={`w-full p-2 rounded text-left border flex items-center gap-2 cursor-pointer ${
                            theme === 'dark' ? 'bg-emerald-950/40 border-emerald-900 text-emerald-300 hover:bg-emerald-900/40' : 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                          }`}
                        >
                          <Camera className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="font-bold">Take AI Co-Pilot Snapshot</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setIsExpandedFullScreen(!isExpandedFullScreen)}
                          className={`w-full p-2 rounded text-left border flex items-center gap-2 cursor-pointer ${
                            theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800' : 'bg-white border-zinc-200 text-zinc-800 hover:bg-zinc-100'
                          }`}
                        >
                          {isExpandedFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                          <span className="font-bold">{isExpandedFullScreen ? 'Exit Fullscreen' : 'Fullscreen Chart Mode'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};
