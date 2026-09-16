import React, { useEffect, useRef } from 'react';
import {
  IChartApi,
  ISeriesApi,
  IPriceLine,
  createSeriesMarkers,
  MouseEventParams,
  UTCTimestamp,
  BarData,
  LineData,
  CandlestickSeries,
} from 'lightweight-charts';
import type { Candlestick, Pattern, TechnicalIndicatorsState, Timeframe } from '../types';
import type { SessionBlock } from '../utils/forexSessions';
import type {
  AnimatedTrade,
  ChartPoint,
  ChartTheme,
  DrawingsState,
  DrawingTool,
  CursorType,
  HudData,
} from '../types/chart';
import {
  buildChartMarkers,
  createBollingerSeries,
  createEmaSeries,
  createFibonacciPriceLines,
  createMacdSubChart,
  createMainChart,
  createRsiSubChart,
  createSmaSeries,
  formatChartTime,
  syncTimeScales,
  toCandlestickData,
  toEpochSeconds,
} from '../utils/chart/indicatorOverlays';
import {
  createHorizontalPriceLines,
  createTrendlineSeries,
  newRiskRewardTool,
  findMagnetPrice,
  computeRulerStats,
} from '../utils/chart/drawingTools';
import { computeRSI, PAIRS_CONFIG } from '../utils/forexData';

export interface UseChartCoreParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rsiContainerRef: React.RefObject<HTMLDivElement | null>;
  macdContainerRef: React.RefObject<HTMLDivElement | null>;
  chartRef: React.RefObject<IChartApi | null>;
  rsiChartRef: React.RefObject<IChartApi | null>;
  macdChartRef: React.RefObject<IChartApi | null>;
  symbol: string;
  timeframe: Timeframe;
  data: Candlestick[];
  indicators: TechnicalIndicatorsState;
  theme: ChartTheme;
  chartHeight: number;
  subChartHeight?: number;
  isExpandedFullScreen: boolean;
  isRsiMinimized: boolean;
  isMacdMinimized: boolean;
  drawings: DrawingsState;
  setDrawings: React.Dispatch<React.SetStateAction<DrawingsState>>;
  activeTool: DrawingTool;
  setActiveTool: (tool: DrawingTool) => void;
  trendlineStart: ChartPoint | null;
  setTrendlineStart: (point: ChartPoint | null) => void;
  fibStart: ChartPoint | null;
  setFibStart: (point: ChartPoint | null) => void;
  selectedColor: string;
  setHudData: (hud: HudData | null) => void;
  patterns: Pattern[];
  visibleChartPatterns: Pattern[];
  highlightedPattern: Pattern | null;
  sessionBlocks: SessionBlock[];
  showSessionShading: boolean;
  symbolTradesToAnimate: AnimatedTrade[];
  showTradeAnimations: boolean;
  showPatternBeams: boolean;
  magnetMode?: boolean;
  lockDrawings?: boolean;
  cursorType?: CursorType;
}

type ChartRefs = {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  smaSeries: ISeriesApi<'Line'> | null;
  emaSeries: ISeriesApi<'Line'> | null;
  bbSeries: ReturnType<typeof createBollingerSeries>;
  fibLines: IPriceLine[];
  priceLines: IPriceLine[];
  trendlineSeries: ISeriesApi<'Line'>[];
  unsubscribeSync: (() => void) | null;
  resizeObserver: ResizeObserver | null;
};

export function useChartCore(params: UseChartCoreParams): void {
  const {
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
    subChartHeight,
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
    magnetMode = false,
    lockDrawings = false,
    cursorType = 'crosshair',
  } = params;

  // Refs for stable callbacks
  const activeToolRef = useRef<DrawingTool>(activeTool);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  const trendlineStartRef = useRef<ChartPoint | null>(trendlineStart);
  useEffect(() => { trendlineStartRef.current = trendlineStart; }, [trendlineStart]);

  const fibStartRef = useRef<ChartPoint | null>(fibStart);
  useEffect(() => { fibStartRef.current = fibStart; }, [fibStart]);

  const selectedColorRef = useRef<string>(selectedColor);
  useEffect(() => { selectedColorRef.current = selectedColor; }, [selectedColor]);

  const drawingsRef = useRef<DrawingsState>(drawings);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);

  const sessionBlocksRef = useRef<SessionBlock[]>(sessionBlocks);
  useEffect(() => { sessionBlocksRef.current = sessionBlocks; }, [sessionBlocks]);

  const magnetModeRef = useRef<boolean>(magnetMode);
  useEffect(() => { magnetModeRef.current = magnetMode; }, [magnetMode]);

  const lockDrawingsRef = useRef<boolean>(lockDrawings);
  useEffect(() => { lockDrawingsRef.current = lockDrawings; }, [lockDrawings]);

  const cursorTypeRef = useRef<CursorType>(cursorType);
  useEffect(() => { cursorTypeRef.current = cursorType; }, [cursorType]);

  const effectiveSubHeight = subChartHeight ?? (isExpandedFullScreen ? 110 : 100);
  const chartHeightRef = useRef<number>(chartHeight);
  useEffect(() => { chartHeightRef.current = chartHeight; }, [chartHeight]);
  const subHeightRef = useRef<number>(effectiveSubHeight);
  useEffect(() => { subHeightRef.current = effectiveSubHeight; }, [effectiveSubHeight]);

  const multiPointsRef = useRef<ChartPoint[]>([]);

  const showSessionShadingRef = useRef(showSessionShading);
  useEffect(() => { showSessionShadingRef.current = showSessionShading; }, [showSessionShading]);

  const tradesRef = useRef<AnimatedTrade[]>(symbolTradesToAnimate);
  useEffect(() => { tradesRef.current = symbolTradesToAnimate; }, [symbolTradesToAnimate]);

  const showTradeAnimationsRef = useRef(showTradeAnimations);
  useEffect(() => { showTradeAnimationsRef.current = showTradeAnimations; }, [showTradeAnimations]);

  const showPatternBeamsRef = useRef(showPatternBeams);
  useEffect(() => { showPatternBeamsRef.current = showPatternBeams; }, [showPatternBeams]);

  const patternsRef = useRef<Pattern[]>(patterns);
  useEffect(() => { patternsRef.current = patterns; }, [patterns]);

  const chartRefs = useRef<ChartRefs>({
    candleSeries: null,
    smaSeries: null,
    emaSeries: null,
    bbSeries: null,
    fibLines: [],
    priceLines: [],
    trendlineSeries: [],
    unsubscribeSync: null,
    resizeObserver: null,
  });

  // Main chart lifecycle — only recreate on symbol/timeframe/theme/height/indicators/minimized changes, NOT on drawings
  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };

    // Cleanup previous
    const prev = chartRefs.current;
    if (prev.unsubscribeSync) prev.unsubscribeSync();
    if (prev.resizeObserver) prev.resizeObserver.disconnect();
    if (prev.candleSeries) {
      try { prev.priceLines.forEach((l) => prev.candleSeries?.removePriceLine(l)); } catch {}
      try { prev.fibLines.forEach((l) => prev.candleSeries?.removePriceLine(l)); } catch {}
    }
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch {}
      chartRef.current = null;
    }
    if (rsiChartRef.current) {
      try { rsiChartRef.current.remove(); } catch {}
      rsiChartRef.current = null;
    }
    if (macdChartRef.current) {
      try { macdChartRef.current.remove(); } catch {}
      macdChartRef.current = null;
    }

    const chart = createMainChart(container, chartHeight, theme, symbol, timeframe, magnetMode);
    chartRef.current = chart;

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
      },
    });
    candleSeries.setData(toCandlestickData(data));
    chartRefs.current.candleSeries = candleSeries;

    const smaSeries = indicators.sma ? createSmaSeries(chart, data) : null;
    const emaSeries = indicators.ema ? createEmaSeries(chart, data) : null;
    const bbSeries = indicators.bollinger ? createBollingerSeries(chart, data) : null;
    const fibLines = indicators.fibonacci ? createFibonacciPriceLines(candleSeries, data, symbol) : [];

    chartRefs.current.smaSeries = smaSeries;
    chartRefs.current.emaSeries = emaSeries;
    chartRefs.current.bbSeries = bbSeries;
    chartRefs.current.fibLines = fibLines;

    // Initial drawings (will be updated via separate effect)
    const activePriceLines = createHorizontalPriceLines(candleSeries, drawingsRef.current.horizontalLines);
    const activeTrendlineSeries = createTrendlineSeries(chart, drawingsRef.current.trendlines);
    chartRefs.current.priceLines = activePriceLines;
    chartRefs.current.trendlineSeries = activeTrendlineSeries;

    createSeriesMarkers(
      candleSeries,
      buildChartMarkers({
        patterns: visibleChartPatterns,
        highlightedPatternId: highlightedPattern ? highlightedPattern.id : null,
        annotations: drawingsRef.current.annotations,
        trendlineStart: trendlineStartRef.current,
        trendlineStartColor: selectedColorRef.current,
      })
    );

    const effectiveSubHeight = subChartHeight ?? (isExpandedFullScreen ? 110 : 100);

    let rsiChart: IChartApi | null = null;
    if (indicators.rsi && !isRsiMinimized) {
      rsiChart = createRsiSubChart(rsiContainerRef.current, data, theme, effectiveSubHeight);
      rsiChartRef.current = rsiChart;
    }

    let macdChart: IChartApi | null = null;
    if (indicators.macd && !isMacdMinimized) {
      const macdResult = createMacdSubChart(macdContainerRef.current, data, theme, effectiveSubHeight);
      if (macdResult) {
        macdChart = macdResult.chart;
        macdChartRef.current = macdChart;
      }
    }

    const subCharts: IChartApi[] = [];
    if (rsiChart) subCharts.push(rsiChart);
    if (macdChart) subCharts.push(macdChart);
    const unsubscribeSync = syncTimeScales(chart, subCharts);
    chartRefs.current.unsubscribeSync = unsubscribeSync;

    const rsiValues = indicators.rsi ? computeRSI(data, 14) : null;

    chart.timeScale().setVisibleRange({
      from: data[Math.max(0, data.length - 60)].time as UTCTimestamp,
      to: data[data.length - 1].time as UTCTimestamp,
    });

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !containerRef.current || !chartRef.current) return;
      const { width } = entries[0].contentRect;
      chartRef.current.resize(width, chartHeightRef.current);
      if (rsiChartRef.current && rsiContainerRef.current) {
        rsiChartRef.current.resize(width, subHeightRef.current);
      }
      if (macdChartRef.current && macdContainerRef.current) {
        macdChartRef.current.resize(width, subHeightRef.current);
      }
    });
    resizeObserver.observe(container);
    chartRefs.current.resizeObserver = resizeObserver;

    const handleDblClick = () => chart.timeScale().fitContent();
    container.addEventListener('dblclick', handleDblClick);

    const handleChartClick = (param: MouseEventParams) => {
      if (!param.point || !param.time) return;
      if (lockDrawingsRef.current) return; // Prevent edits when locked

      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null) return;
      const clickedTime = toEpochSeconds(param.time);
      if (clickedTime === undefined) return;

      const effectivePrice = magnetModeRef.current ? findMagnetPrice(price, clickedTime, data) : price;
      const pt: ChartPoint = { time: clickedTime, price: effectivePrice };
      const currentTool = activeToolRef.current;

      // Eraser
      if (cursorTypeRef.current === 'eraser' || currentTool === 'cursor_eraser') {
        const pip = Math.pow(10, -(config.pipDecimal || 4));
        setDrawings((prev) => {
          const hl = prev.horizontalLines.filter((l) => {
            const p = typeof l === 'number' ? l : l.price;
            return Math.abs(p - effectivePrice) > pip * 15;
          });
          if (hl.length !== prev.horizontalLines.length) return { ...prev, horizontalLines: hl };

          const tl = prev.trendlines.filter((t) => {
            const mid = (t.start.price + t.end.price) / 2;
            return Math.abs(mid - effectivePrice) > pip * 15;
          });
          if (tl.length !== prev.trendlines.length) return { ...prev, trendlines: tl };

          if ((prev.rectangles || []).length > 0) return { ...prev, rectangles: prev.rectangles!.slice(0, -1) };
          if ((prev.rulers || []).length > 0) return { ...prev, rulers: prev.rulers!.slice(0, -1) };
          if ((prev.fibonacci || []).length > 0) return { ...prev, fibonacci: prev.fibonacci!.slice(0, -1) };
          if ((prev.horizontalLines || []).length > 0) return { ...prev, horizontalLines: prev.horizontalLines!.slice(0, -1) };
          return prev;
        });
        return;
      }

      // Trend tools
      if (currentTool === 'horizontal') {
        setDrawings((prev) => ({
          ...prev,
          horizontalLines: [...prev.horizontalLines, { price: parseFloat(effectivePrice.toFixed(config.pipDecimal + 1)), color: selectedColorRef.current }],
        }));
        setActiveTool('none');
      } else if (currentTool === 'horizontal_ray') {
        setDrawings((prev) => ({
          ...prev,
          horizontalRays: [...(prev.horizontalRays || []), { id: Date.now().toString(), start: pt, color: selectedColorRef.current }],
        }));
        setActiveTool('none');
      } else if (currentTool === 'vertical_line') {
        setDrawings((prev) => ({
          ...prev,
          verticalLines: [...(prev.verticalLines || []), { id: Date.now().toString(), time: clickedTime, color: selectedColorRef.current, label: 'TIME MARK' }],
        }));
        setActiveTool('none');
      } else if (currentTool === 'trendline_start') {
        setTrendlineStart(pt);
        setActiveTool('trendline_end');
      } else if (currentTool === 'trendline_end' && trendlineStartRef.current) {
        const start = trendlineStartRef.current;
        setDrawings((prev) => ({
          ...prev,
          trendlines: [...prev.trendlines, { start, end: pt, color: selectedColorRef.current }],
        }));
        setTrendlineStart(null);
        setActiveTool('none');
      } else if (currentTool === 'channel_p1') {
        multiPointsRef.current = [pt];
        setActiveTool('channel_p2');
      } else if (currentTool === 'channel_p2') {
        multiPointsRef.current.push(pt);
        setActiveTool('channel_p3');
      } else if (currentTool === 'channel_p3' && multiPointsRef.current.length >= 2) {
        const [p1, p2] = multiPointsRef.current;
        setDrawings((prev) => ({
          ...prev,
          parallelChannels: [...(prev.parallelChannels || []), { id: Date.now().toString(), p1, p2, p3: pt, color: selectedColorRef.current }],
        }));
        multiPointsRef.current = [];
        setActiveTool('none');
      }
      // Fibonacci & Gann tools
      else if (currentTool === 'fib_start') {
        setFibStart(pt);
        setActiveTool('fib_end');
      } else if (currentTool === 'fib_end' && fibStartRef.current) {
        const start = fibStartRef.current;
        setDrawings((prev) => ({
          ...prev,
          fibonacci: [...(prev.fibonacci || []), { id: Date.now().toString(), start, end: pt, color: selectedColorRef.current }],
        }));
        setFibStart(null);
        setActiveTool('none');
      } else if (currentTool === 'fib_ext_p1') {
        multiPointsRef.current = [pt];
        setActiveTool('fib_ext_p2');
      } else if (currentTool === 'fib_ext_p2') {
        multiPointsRef.current.push(pt);
        setActiveTool('fib_ext_p3');
      } else if (currentTool === 'fib_ext_p3' && multiPointsRef.current.length >= 2) {
        const [p1, p2] = multiPointsRef.current;
        setDrawings((prev) => ({
          ...prev,
          fibExtensions: [...(prev.fibExtensions || []), { id: Date.now().toString(), p1, p2, p3: pt, color: selectedColorRef.current }],
        }));
        multiPointsRef.current = [];
        setActiveTool('none');
      } else if (currentTool === 'gann_box_p1') {
        multiPointsRef.current = [pt];
        setActiveTool('gann_box_p2');
      } else if (currentTool === 'gann_box_p2' && multiPointsRef.current.length >= 1) {
        const [start] = multiPointsRef.current;
        setDrawings((prev) => ({
          ...prev,
          gannBoxes: [...(prev.gannBoxes || []), { id: Date.now().toString(), start, end: pt, color: selectedColorRef.current }],
        }));
        multiPointsRef.current = [];
        setActiveTool('none');
      }
      // Geometric shapes
      else if (currentTool === 'rect_start') {
        multiPointsRef.current = [pt];
        setActiveTool('rect_end');
      } else if (currentTool === 'rect_end' && multiPointsRef.current.length >= 1) {
        const [start] = multiPointsRef.current;
        setDrawings((prev) => ({
          ...prev,
          rectangles: [...(prev.rectangles || []), { id: Date.now().toString(), start, end: pt, color: selectedColorRef.current, label: 'ORDER BLOCK' }],
        }));
        multiPointsRef.current = [];
        setActiveTool('none');
      } else if (currentTool === 'circle_start') {
        multiPointsRef.current = [pt];
        setActiveTool('circle_end');
      } else if (currentTool === 'circle_end' && multiPointsRef.current.length >= 1) {
        const [center] = multiPointsRef.current;
        setDrawings((prev) => ({
          ...prev,
          circles: [...(prev.circles || []), { id: Date.now().toString(), center, edge: pt, color: selectedColorRef.current }],
        }));
        multiPointsRef.current = [];
        setActiveTool('none');
      } else if (currentTool === 'brush') {
        setDrawings((prev) => ({
          ...prev,
          circles: [...(prev.circles || []), { id: Date.now().toString(), center: pt, edge: { time: pt.time + 3600, price: pt.price + 0.0004 }, color: selectedColorRef.current }],
        }));
        setActiveTool('none');
      }
      // Forecasting & Measurement
      else if (currentTool === 'rr_long' || currentTool === 'rr_short') {
        const rrType = currentTool === 'rr_long' ? 'long' : 'short';
        const tool = newRiskRewardTool(rrType, pt, symbol);
        setDrawings((prev) => ({ ...prev, riskRewards: [...(prev.riskRewards || []), tool] }));
        setActiveTool('none');
      } else if (currentTool === 'ruler_start') {
        multiPointsRef.current = [pt];
        setActiveTool('ruler_end');
      } else if (currentTool === 'ruler_end' && multiPointsRef.current.length >= 1) {
        const [start] = multiPointsRef.current;
        const ruler = computeRulerStats(start, pt, data, symbol);
        setDrawings((prev) => ({
          ...prev,
          rulers: [...(prev.rulers || []), ruler],
        }));
        multiPointsRef.current = [];
        setActiveTool('none');
      }
      // Annotation tools
      else if (currentTool === 'annotation') {
        const text = window.prompt('Enter text for label annotation:');
        if (text && text.trim()) {
          setDrawings((prev) => ({
            ...prev,
            annotations: [...prev.annotations, { time: clickedTime, price: effectivePrice, text: text.trim(), color: selectedColorRef.current }],
          }));
        }
        setActiveTool('none');
      } else if (currentTool === 'callout') {
        const text = window.prompt('Enter callout comment:') || 'Key Pivot';
        if (text.trim()) {
          setDrawings((prev) => ({
            ...prev,
            callouts: [...(prev.callouts || []), { id: Date.now().toString(), target: pt, text: text.trim(), color: selectedColorRef.current }],
          }));
        }
        setActiveTool('none');
      } else if (currentTool === 'price_label') {
        setDrawings((prev) => ({
          ...prev,
          priceLabels: [...(prev.priceLabels || []), { id: Date.now().toString(), point: pt, color: selectedColorRef.current }],
        }));
        setActiveTool('none');
      } else if (currentTool === 'arrow_up') {
        setDrawings((prev) => ({
          ...prev,
          arrows: [...(prev.arrows || []), { id: Date.now().toString(), point: pt, direction: 'up', color: selectedColorRef.current }],
        }));
        setActiveTool('none');
      } else if (currentTool === 'arrow_down') {
        setDrawings((prev) => ({
          ...prev,
          arrows: [...(prev.arrows || []), { id: Date.now().toString(), point: pt, direction: 'down', color: selectedColorRef.current }],
        }));
        setActiveTool('none');
      }
      // Pattern tools
      else if (currentTool.startsWith('pattern_hs_')) {
        multiPointsRef.current.push(pt);
        if (currentTool === 'pattern_hs_p1') setActiveTool('pattern_hs_p2');
        else if (currentTool === 'pattern_hs_p2') setActiveTool('pattern_hs_p3');
        else if (currentTool === 'pattern_hs_p3') setActiveTool('pattern_hs_p4');
        else if (currentTool === 'pattern_hs_p4') {
          setDrawings((prev) => ({
            ...prev,
            chartPatterns: [
              ...(prev.chartPatterns || []),
              {
                id: Date.now().toString(),
                type: 'head_shoulders',
                points: [...multiPointsRef.current],
                labels: ['LS', 'Head', 'RS', 'Neckline'],
                color: selectedColorRef.current,
              },
            ],
          }));
          multiPointsRef.current = [];
          setActiveTool('none');
        }
      } else if (currentTool.startsWith('pattern_xabcd_')) {
        multiPointsRef.current.push(pt);
        if (currentTool === 'pattern_xabcd_p1') setActiveTool('pattern_xabcd_p2');
        else if (currentTool === 'pattern_xabcd_p2') setActiveTool('pattern_xabcd_p3');
        else if (currentTool === 'pattern_xabcd_p3') setActiveTool('pattern_xabcd_p4');
        else if (currentTool === 'pattern_xabcd_p4') setActiveTool('pattern_xabcd_p5');
        else if (currentTool === 'pattern_xabcd_p5') {
          setDrawings((prev) => ({
            ...prev,
            chartPatterns: [
              ...(prev.chartPatterns || []),
              {
                id: Date.now().toString(),
                type: 'xabcd',
                points: [...multiPointsRef.current],
                labels: ['X', 'A', 'B', 'C', 'D'],
                color: selectedColorRef.current,
              },
            ],
          }));
          multiPointsRef.current = [];
          setActiveTool('none');
        }
      } else if (currentTool.startsWith('pattern_elliott_')) {
        multiPointsRef.current.push(pt);
        if (currentTool === 'pattern_elliott_p1') setActiveTool('pattern_elliott_p2');
        else if (currentTool === 'pattern_elliott_p2') setActiveTool('pattern_elliott_p3');
        else if (currentTool === 'pattern_elliott_p3') setActiveTool('pattern_elliott_p4');
        else if (currentTool === 'pattern_elliott_p4') setActiveTool('pattern_elliott_p5');
        else if (currentTool === 'pattern_elliott_p5') {
          setDrawings((prev) => ({
            ...prev,
            chartPatterns: [
              ...(prev.chartPatterns || []),
              {
                id: Date.now().toString(),
                type: 'elliott_wave',
                points: [...multiPointsRef.current],
                labels: ['(1)', '(2)', '(3)', '(4)', '(5)'],
                color: selectedColorRef.current,
              },
            ],
          }));
          multiPointsRef.current = [];
          setActiveTool('none');
        }
      }
    };
    chart.subscribeClick(handleChartClick);

    const updateCustomOverlays = () => {
      const cs = chartRefs.current.candleSeries;
      if (!cs || !chart) return;

      (drawingsRef.current.riskRewards || []).forEach((tool) => {
        const el = document.getElementById(`rr-tool-${tool.id}`);
        if (!el) return;
        const startX = chart.timeScale().timeToCoordinate(tool.entry.time as UTCTimestamp);
        if (startX === null) { el.style.display = 'none'; return; }
        const entryY = cs.priceToCoordinate(tool.entry.price);
        const tpY = cs.priceToCoordinate(tool.tp);
        const slY = cs.priceToCoordinate(tool.sl);
        if (entryY === null || tpY === null || slY === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${startX}px`;
        el.style.setProperty('--profit-top', `${Math.min(entryY, tpY)}px`);
        el.style.setProperty('--profit-height', `${Math.abs(entryY - tpY)}px`);
        el.style.setProperty('--loss-top', `${Math.min(entryY, slY)}px`);
        el.style.setProperty('--loss-height', `${Math.abs(entryY - slY)}px`);
        el.style.setProperty('--entry-y', `${entryY}px`);
      });

      (drawingsRef.current.fibonacci || []).forEach((tool) => {
        const el = document.getElementById(`fib-tool-${tool.id}`);
        if (!el) return;
        const times = [tool.start.time, tool.end.time].sort((a, b) => a - b);
        const startX = chart.timeScale().timeToCoordinate(times[0] as UTCTimestamp);
        const endX = chart.timeScale().timeToCoordinate(times[1] as UTCTimestamp);
        if (startX === null) { el.style.display = 'none'; return; }
        const width = endX !== null ? Math.max(endX - startX, 100) : 100;
        el.style.display = 'block';
        el.style.left = `${startX}px`;
        el.style.width = `${width}px`;
        const p1 = tool.start.price;
        const p2 = tool.end.price;
        const range = p2 - p1;
        const y1 = cs.priceToCoordinate(p1);
        const y2 = cs.priceToCoordinate(p2);
        if (y1 !== null && y2 !== null) {
          el.style.setProperty('--fib-top', `${Math.min(y1, y2)}px`);
          el.style.setProperty('--fib-height', `${Math.abs(y1 - y2)}px`);
        }
        [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((ratio) => {
          const levelPrice = p1 + range * ratio;
          const y = cs.priceToCoordinate(levelPrice);
          if (y !== null) el.style.setProperty(`--fib-y-${ratio.toString().replace('.', '_')}`, `${y}px`);
        });
      });

      // Horizontal Rays
      (drawingsRef.current.horizontalRays || []).forEach((tool) => {
        const el = document.getElementById(`hray-${tool.id}`);
        if (!el) return;
        const startX = chart.timeScale().timeToCoordinate(tool.start.time as UTCTimestamp);
        const y = cs.priceToCoordinate(tool.start.price);
        if (startX === null || y === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${startX}px`;
        el.style.top = `${y}px`;
        el.style.width = `${Math.max(10, (container.clientWidth || 800) - startX)}px`;
      });

      // Vertical Lines
      (drawingsRef.current.verticalLines || []).forEach((tool) => {
        const el = document.getElementById(`vline-${tool.id}`);
        if (!el) return;
        const x = chart.timeScale().timeToCoordinate(tool.time as UTCTimestamp);
        if (x === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${x}px`;
      });

      // Rectangles (Supply/Demand Zones)
      (drawingsRef.current.rectangles || []).forEach((tool) => {
        const el = document.getElementById(`rect-${tool.id}`);
        if (!el) return;
        const x1 = chart.timeScale().timeToCoordinate(tool.start.time as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(tool.end.time as UTCTimestamp);
        const y1 = cs.priceToCoordinate(tool.start.price);
        const y2 = cs.priceToCoordinate(tool.end.price);
        if (x1 === null || x2 === null || y1 === null || y2 === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${Math.min(x1, x2)}px`;
        el.style.top = `${Math.min(y1, y2)}px`;
        el.style.width = `${Math.max(Math.abs(x2 - x1), 4)}px`;
        el.style.height = `${Math.max(Math.abs(y2 - y1), 4)}px`;
      });

      // Circles
      (drawingsRef.current.circles || []).forEach((tool) => {
        const el = document.getElementById(`circle-${tool.id}`);
        if (!el) return;
        const cx = chart.timeScale().timeToCoordinate(tool.center.time as UTCTimestamp);
        const cy = cs.priceToCoordinate(tool.center.price);
        const ex = chart.timeScale().timeToCoordinate(tool.edge.time as UTCTimestamp);
        const ey = cs.priceToCoordinate(tool.edge.price);
        if (cx === null || cy === null || ex === null || ey === null) { el.style.display = 'none'; return; }
        const rx = Math.max(Math.abs(ex - cx), 8);
        const ry = Math.max(Math.abs(ey - cy), 8);
        el.style.display = 'block';
        el.style.left = `${cx - rx}px`;
        el.style.top = `${cy - ry}px`;
        el.style.width = `${rx * 2}px`;
        el.style.height = `${ry * 2}px`;
      });

      // Gann Boxes
      (drawingsRef.current.gannBoxes || []).forEach((tool) => {
        const el = document.getElementById(`gann-${tool.id}`);
        if (!el) return;
        const x1 = chart.timeScale().timeToCoordinate(tool.start.time as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(tool.end.time as UTCTimestamp);
        const y1 = cs.priceToCoordinate(tool.start.price);
        const y2 = cs.priceToCoordinate(tool.end.price);
        if (x1 === null || x2 === null || y1 === null || y2 === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${Math.min(x1, x2)}px`;
        el.style.top = `${Math.min(y1, y2)}px`;
        el.style.width = `${Math.max(Math.abs(x2 - x1), 10)}px`;
        el.style.height = `${Math.max(Math.abs(y2 - y1), 10)}px`;
      });

      // Fib Extensions
      (drawingsRef.current.fibExtensions || []).forEach((tool) => {
        const el = document.getElementById(`fibext-${tool.id}`);
        if (!el) return;
        const x1 = chart.timeScale().timeToCoordinate(tool.p1.time as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(tool.p2.time as UTCTimestamp);
        const x3 = chart.timeScale().timeToCoordinate(tool.p3.time as UTCTimestamp);
        if (x1 === null || x2 === null || x3 === null) { el.style.display = 'none'; return; }
        const minX = Math.min(x1, x2, x3);
        const maxX = Math.max(x1, x2, x3);
        el.style.display = 'block';
        el.style.left = `${minX}px`;
        el.style.width = `${Math.max(maxX - minX + 80, 100)}px`;
        const waveRange = tool.p2.price - tool.p1.price;
        [0.618, 1.0, 1.272, 1.618].forEach((r) => {
          const extPrice = tool.p3.price + waveRange * r;
          const ey = cs.priceToCoordinate(extPrice);
          if (ey !== null) el.style.setProperty(`--ext-y-${r.toString().replace('.', '_')}`, `${ey}px`);
        });
      });

      // Measurement Rulers
      (drawingsRef.current.rulers || []).forEach((tool) => {
        const el = document.getElementById(`ruler-${tool.id}`);
        if (!el) return;
        const x1 = chart.timeScale().timeToCoordinate(tool.start.time as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(tool.end.time as UTCTimestamp);
        const y1 = cs.priceToCoordinate(tool.start.price);
        const y2 = cs.priceToCoordinate(tool.end.price);
        if (x1 === null || x2 === null || y1 === null || y2 === null) { el.style.display = 'none'; return; }
        el.style.display = 'flex';
        el.style.left = `${Math.min(x1, x2)}px`;
        el.style.top = `${Math.min(y1, y2)}px`;
        el.style.width = `${Math.max(Math.abs(x2 - x1), 10)}px`;
        el.style.height = `${Math.max(Math.abs(y2 - y1), 10)}px`;
      });

      // Callouts
      (drawingsRef.current.callouts || []).forEach((tool) => {
        const el = document.getElementById(`callout-${tool.id}`);
        if (!el) return;
        const x = chart.timeScale().timeToCoordinate(tool.target.time as UTCTimestamp);
        const y = cs.priceToCoordinate(tool.target.price);
        if (x === null || y === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      });

      // Price Labels
      (drawingsRef.current.priceLabels || []).forEach((tool) => {
        const el = document.getElementById(`plabel-${tool.id}`);
        if (!el) return;
        const x = chart.timeScale().timeToCoordinate(tool.point.time as UTCTimestamp);
        const y = cs.priceToCoordinate(tool.point.price);
        if (x === null || y === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      });

      // Arrows
      (drawingsRef.current.arrows || []).forEach((tool) => {
        const el = document.getElementById(`arrow-${tool.id}`);
        if (!el) return;
        const x = chart.timeScale().timeToCoordinate(tool.point.time as UTCTimestamp);
        const y = cs.priceToCoordinate(tool.point.price);
        if (x === null || y === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      });

      // Chart Patterns
      (drawingsRef.current.chartPatterns || []).forEach((tool) => {
        const el = document.getElementById(`pat-draw-${tool.id}`);
        if (!el) return;
        const coords = tool.points.map((p) => ({
          x: chart.timeScale().timeToCoordinate(p.time as UTCTimestamp),
          y: cs.priceToCoordinate(p.price),
        }));
        if (coords.some((c) => c.x === null || c.y === null)) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        coords.forEach((c, idx) => {
          el.style.setProperty(`--px-${idx}`, `${c.x}px`);
          el.style.setProperty(`--py-${idx}`, `${c.y}px`);
        });
      });

      if (showSessionShadingRef.current && sessionBlocksRef.current.length > 0) {
        sessionBlocksRef.current.forEach((block) => {
          const el = document.getElementById(`session-band-${block.id}`);
          if (!el) return;
          const startX = chart.timeScale().timeToCoordinate(block.startTime as UTCTimestamp);
          const endX = chart.timeScale().timeToCoordinate(block.endTime as UTCTimestamp);
          if (startX === null || endX === null) { el.style.display = 'none'; return; }
          const chartWidth = container.clientWidth || 1000;
          const left = Math.max(0, Math.min(startX, endX));
          const right = Math.min(chartWidth, Math.max(startX, endX));
          const width = right - left;
          if (width > 0 && left < chartWidth && right > 0) {
            el.style.display = 'block';
            el.style.left = `${left}px`;
            el.style.width = `${width}px`;
          } else el.style.display = 'none';
        });
      }

      if (showTradeAnimationsRef.current && tradesRef.current.length > 0) {
        const latestCandle = data.length > 0 ? data[data.length - 1] : null;
        tradesRef.current.forEach((trade) => {
          const el = document.getElementById(`trade-anim-overlay-${trade.id}`);
          if (!el || !latestCandle) return;
          let entryCandle = latestCandle;
          if (data.length > 0) {
            const match = data.slice().reverse().find((c) => {
              const cDateStr = new Date(c.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return trade.time?.includes(cDateStr) || Math.abs(c.time * 1000 - new Date(trade.time).getTime()) < 3600000;
            });
            if (match) entryCandle = match;
          }
          const entryX = chart.timeScale().timeToCoordinate(entryCandle.time as UTCTimestamp);
          const entryY = cs.priceToCoordinate(trade.entryPrice);
          if (entryX === null || entryY === null) { el.style.display = 'none'; return; }
          el.style.display = 'block';
          el.style.left = `${entryX}px`;
          el.style.top = `${entryY}px`;
          const pattern = patternsRef.current?.find((p) => p.time <= entryCandle.time);
          if (pattern && showPatternBeamsRef.current) {
            const patX = chart.timeScale().timeToCoordinate(pattern.time as UTCTimestamp);
            const patY = cs.priceToCoordinate(entryCandle.close);
            if (patX !== null && patY !== null) {
              el.style.setProperty('--pat-dx', `${patX - entryX}px`);
              el.style.setProperty('--pat-dy', `${patY - entryY}px`);
            }
          }
          if (trade.isClosed) {
            const exitPrice = trade.exitPrice || trade.entryPrice;
            const exitX = chart.timeScale().timeToCoordinate(latestCandle.time as UTCTimestamp);
            const exitY = cs.priceToCoordinate(exitPrice);
            if (exitX !== null && exitY !== null) {
              el.style.setProperty('--exit-dx', `${exitX - entryX}px`);
              el.style.setProperty('--exit-dy', `${exitY - entryY}px`);
            }
          }
        });
      }
    };

    const handleCrosshairMove = (param: MouseEventParams) => {
      updateCustomOverlays();
      if (!param.point || param.time === undefined || param.point.x < 0 || param.point.x > (container.clientWidth || 0) || param.point.y < 0 || param.point.y > (container.clientHeight || 0)) {
        setHudData(null);
        return;
      }
      const dataPoint = param.seriesData.get(candleSeries) as BarData | undefined;
      if (!dataPoint) { setHudData(null); return; }

      let rsiVal: number | undefined;
      if (rsiValues) {
        const idx = data.findIndex((d) => d.time === toEpochSeconds(param.time));
        const raw = idx >= 0 ? rsiValues[idx] : null;
        if (raw !== null && raw !== undefined) rsiVal = raw;
      }

      const smaPoint = smaSeries ? (param.seriesData.get(smaSeries) as LineData | undefined) : undefined;
      const emaPoint = emaSeries ? (param.seriesData.get(emaSeries) as LineData | undefined) : undefined;
      const bbUpperPoint = bbSeries ? (param.seriesData.get(bbSeries.upper) as LineData | undefined) : undefined;
      const bbLowerPoint = bbSeries ? (param.seriesData.get(bbSeries.lower) as LineData | undefined) : undefined;

      setHudData({
        open: dataPoint.open,
        high: dataPoint.high,
        low: dataPoint.low,
        close: dataPoint.close,
        date: formatChartTime(param.time),
        sma: smaPoint?.value,
        ema: emaPoint?.value,
        bbUpper: bbUpperPoint?.value,
        bbLower: bbLowerPoint?.value,
        rsi: rsiVal,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateCustomOverlays);
    chart.timeScale().subscribeSizeChange(updateCustomOverlays);
    const initialOverlayTimer = setTimeout(updateCustomOverlays, 50);

    return () => {
      clearTimeout(initialOverlayTimer);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateCustomOverlays); } catch {}
      try { chart.timeScale().unsubscribeSizeChange(updateCustomOverlays); } catch {}
      resizeObserver.disconnect();
      container.removeEventListener('dblclick', handleDblClick);
      if (chartRefs.current.unsubscribeSync) chartRefs.current.unsubscribeSync();
      try { chart.unsubscribeClick(handleChartClick); } catch {}
      try { chart.unsubscribeCrosshairMove(handleCrosshairMove); } catch {}
      try { chartRefs.current.priceLines.forEach((line) => candleSeries.removePriceLine(line)); } catch {}
      try { if (indicators.fibonacci) chartRefs.current.fibLines.forEach((line) => candleSeries.removePriceLine(line)); } catch {}
      try { chartRefs.current.trendlineSeries.forEach((s) => chart.removeSeries(s)); } catch {}
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch {}
        chartRef.current = null;
      }
      if (rsiChartRef.current) {
        try { rsiChartRef.current.remove(); } catch {}
        rsiChartRef.current = null;
      }
      if (macdChartRef.current) {
        try { macdChartRef.current.remove(); } catch {}
        macdChartRef.current = null;
      }
      chartRefs.current.candleSeries = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, theme, isRsiMinimized, isMacdMinimized, indicators.sma, indicators.ema, indicators.bollinger, indicators.fibonacci, indicators.rsi, indicators.macd, data.length]);

  // Dedicated chart resizing effect — avoids tearing down canvas series when chart height changes
  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    if (!container || !chart) return;
    const width = container.clientWidth || 800;
    chart.resize(width, chartHeight);
    if (rsiChartRef.current && rsiContainerRef.current) {
      rsiChartRef.current.resize(width, effectiveSubHeight);
    }
    if (macdChartRef.current && macdContainerRef.current) {
      macdChartRef.current.resize(width, effectiveSubHeight);
    }
  }, [chartHeight, effectiveSubHeight]);

  // Incremental update: use update() for same-length (live-tick) changes and setData() only
  // when a new bar has appeared. This avoids a full dataset repaint on every tick.
  const prevDataLenRef = useRef<number>(0);
  useEffect(() => {
    const cs = chartRefs.current.candleSeries;
    if (!cs || data.length === 0) return;
    try {
      if (prevDataLenRef.current === data.length) {
        // Same bar: update in place
        const last = data[data.length - 1];
        cs.update({
          time: last.time as UTCTimestamp,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
        });
      } else {
        cs.setData(toCandlestickData(data));
        prevDataLenRef.current = data.length;
      }
    } catch {
      // If update/setData fails (e.g., series removed), ignore
    }
  }, [data]);

  // Update markers when patterns or highlighted changes
  useEffect(() => {
    const cs = chartRefs.current.candleSeries;
    if (!cs) return;
    try {
      createSeriesMarkers(
        cs,
        buildChartMarkers({
          patterns: visibleChartPatterns,
          highlightedPatternId: highlightedPattern ? highlightedPattern.id : null,
          annotations: drawingsRef.current.annotations,
          trendlineStart: trendlineStartRef.current,
          trendlineStartColor: selectedColorRef.current,
        })
      );
    } catch {}
  }, [visibleChartPatterns, highlightedPattern, drawings]);

  // Sync drawings price lines without full teardown
  useEffect(() => {
    const cs = chartRefs.current.candleSeries;
    const chart = chartRef.current;
    if (!cs || !chart) return;

    // Remove old price lines
    try {
      chartRefs.current.priceLines.forEach((l) => cs.removePriceLine(l));
    } catch {}
    try {
      chartRefs.current.trendlineSeries.forEach((s) => chart.removeSeries(s));
    } catch {}

    const newPriceLines = createHorizontalPriceLines(cs, drawings.horizontalLines);
    const newTrendlines = createTrendlineSeries(chart, drawings.trendlines);
    chartRefs.current.priceLines = newPriceLines;
    chartRefs.current.trendlineSeries = newTrendlines;
  }, [drawings.horizontalLines, drawings.trendlines, chartRef]);

  // Keep drawings ref up to date
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);
}
