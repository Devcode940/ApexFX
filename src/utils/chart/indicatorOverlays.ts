import {
  createChart,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  UTCTimestamp,
  Time,
  LogicalRange,
  SeriesMarkerBar,
  LineData,
  BarData,
  HistogramData,
} from 'lightweight-charts';
import type { Candlestick, Pattern } from '../../types';
import type { AnnotationDrawing, ChartTheme, ChartPoint, DrawingsState } from '../../types/chart';
import {
  computeSMA,
  computeEMA,
  computeBollingerBands,
  computeMACD,
  computeRSI,
  computeFibonacci,
  PAIRS_CONFIG,
} from '../forexData';

export interface ChartThemeColors {
  background: string;
  text: string;
  grid: string;
  border: string;
  crosshairLabelBackground: string;
}

export function getChartThemeColors(theme: ChartTheme): ChartThemeColors {
  return theme === 'dark'
    ? { background: '#09090b', text: '#a1a1aa', grid: '#18181b', border: '#27272a', crosshairLabelBackground: '#27272a' }
    : { background: '#ffffff', text: '#52525b', grid: '#f4f4f5', border: '#e4e4e7', crosshairLabelBackground: '#18181b' };
}

/** Main OHLC chart with visible time scale. */
export function createMainChart(container: HTMLDivElement, height: number, theme: ChartTheme): IChartApi {
  const colors = getChartThemeColors(theme);
  return createChart(container, {
    width: container.clientWidth,
    height,
    layout: {
      background: { type: ColorType.Solid, color: colors.background },
      textColor: colors.text,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
    rightPriceScale: {
      borderColor: colors.border,
      autoScale: true,
    },
    timeScale: {
      borderColor: colors.border,
      timeVisible: true,
      secondsVisible: false,
    },
    crosshair: {
      horzLine: { labelBackgroundColor: colors.crosshairLabelBackground },
      vertLine: { labelBackgroundColor: colors.crosshairLabelBackground },
    },
  });
}

/** Linked sub-chart (RSI / MACD) with hidden time scale. */
export function createSubChart(container: HTMLDivElement, height: number, theme: ChartTheme, autoScale = false): IChartApi {
  const colors = getChartThemeColors(theme);
  return createChart(container, {
    width: container.clientWidth,
    height,
    layout: {
      background: { type: ColorType.Solid, color: colors.background },
      textColor: colors.text,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
    rightPriceScale: {
      borderColor: colors.border,
      autoScale,
      ...(autoScale ? {} : { scaleMargins: { top: 0.1, bottom: 0.1 } }),
    },
    timeScale: {
      visible: false, // hidden since linked to main
    },
    crosshair: {
      horzLine: { labelBackgroundColor: colors.crosshairLabelBackground },
      vertLine: { labelBackgroundColor: colors.crosshairLabelBackground },
    },
  });
}

export interface CandlestickPoint {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function toCandlestickData(data: Candlestick[]): CandlestickPoint[] {
  return data.map((item) => ({
    time: item.time as UTCTimestamp,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
  }));
}

export function toLineValues(data: Candlestick[], values: (number | null)[]): LineData[] {
  const out: LineData[] = [];
  for (let i = 0; i < data.length; i++) {
    const value = values[i];
    if (value !== null && value !== undefined) {
      out.push({ time: data[i].time as UTCTimestamp, value });
    }
  }
  return out;
}

export function createSmaSeries(chart: IChartApi, data: Candlestick[]): ISeriesApi<'Line'> | null {
  const sma = computeSMA(data, 20);
  const series = chart.addSeries(LineSeries, {
    color: '#3b82f6',
    lineWidth: 2,
    title: 'SMA (20)',
    priceLineVisible: false,
  });
  const values = toLineValues(data, sma);
  if (values.length > 0) series.setData(values);
  return series;
}

export function createEmaSeries(chart: IChartApi, data: Candlestick[]): ISeriesApi<'Line'> | null {
  const ema = computeEMA(data, 50);
  const series = chart.addSeries(LineSeries, {
    color: '#eab308',
    lineWidth: 2,
    title: 'EMA (50)',
    priceLineVisible: false,
  });
  const values = toLineValues(data, ema);
  if (values.length > 0) series.setData(values);
  return series;
}

export interface BollingerSeries {
  upper: ISeriesApi<'Line'>;
  lower: ISeriesApi<'Line'>;
  basis: ISeriesApi<'Line'>;
}

export function createBollingerSeries(chart: IChartApi, data: Candlestick[]): BollingerSeries | null {
  const bb = computeBollingerBands(data, 20, 2);

  const upper = chart.addSeries(LineSeries, {
    color: 'rgba(168, 85, 247, 0.65)',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    title: 'BB Upper',
    priceLineVisible: false,
  });
  upper.setData(toLineValues(data, bb.upper));

  const lower = chart.addSeries(LineSeries, {
    color: 'rgba(168, 85, 247, 0.65)',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    title: 'BB Lower',
    priceLineVisible: false,
  });
  lower.setData(toLineValues(data, bb.lower));

  const basis = chart.addSeries(LineSeries, {
    color: 'rgba(168, 85, 247, 0.3)',
    lineWidth: 1,
    title: 'BB Basis',
    priceLineVisible: false,
  });
  basis.setData(toLineValues(data, bb.basis));

  return { upper, lower, basis };
}

/** Auto Fibonacci retracement levels drawn as price lines on the candle series. */
export function createFibonacciPriceLines(
  candleSeries: ISeriesApi<'Candlestick'>,
  data: Candlestick[],
  symbol: string
): IPriceLine[] {
  const fib = computeFibonacci(data);
  if (!fib) return [];

  const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
  const precision = config.pipDecimal + 1;
  const colors = {
    anchor: '#f43f5e', // rose-500
    r236: '#fda4af',
    r382: '#f0abfc',
    r500: '#c084fc',
    r618: '#818cf8',
  };

  const lines: IPriceLine[] = [];
  const drawFibLine = (price: number, label: string, color: string) => {
    lines.push(
      candleSeries.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: label,
      })
    );
  };

  drawFibLine(fib.high, `Fib 0% / 100% (High: ${fib.high.toFixed(precision)})`, colors.anchor);
  drawFibLine(fib.r236, `Fib 23.6% (${fib.r236.toFixed(precision)})`, colors.r236);
  drawFibLine(fib.r382, `Fib 38.2% (${fib.r382.toFixed(precision)})`, colors.r382);
  drawFibLine(fib.r500, `Fib 50.0% (${fib.r500.toFixed(precision)})`, colors.r500);
  drawFibLine(fib.r618, `Fib 61.8% (${fib.r618.toFixed(precision)})`, colors.r618);
  drawFibLine(fib.low, `Fib 100% / 0% (Low: ${fib.low.toFixed(precision)})`, colors.anchor);

  return lines;
}

/** RSI sub-chart with overbought/oversold guide lines. Returns null when the container is missing. */
export function createRsiSubChart(
  container: HTMLDivElement | null,
  data: Candlestick[],
  theme: ChartTheme,
  height: number
): IChartApi | null {
  if (!container) return null;
  const chart = createSubChart(container, height, theme);
  const series = chart.addSeries(LineSeries, {
    color: '#f43f5e',
    lineWidth: 2,
    title: 'RSI (14)',
    priceLineVisible: false,
  });

  series.createPriceLine({
    price: 70,
    color: 'rgba(239, 68, 68, 0.4)',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    title: 'Overbought (70)',
    axisLabelVisible: true,
  });
  series.createPriceLine({
    price: 30,
    color: 'rgba(34, 197, 94, 0.4)',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    title: 'Oversold (30)',
    axisLabelVisible: true,
  });

  series.setData(toLineValues(data, computeRSI(data, 14)));
  return chart;
}

export interface MacdSeriesResult {
  chart: IChartApi;
  macd: ISeriesApi<'Line'>;
  signal: ISeriesApi<'Line'>;
  histogram: ISeriesApi<'Histogram'>;
}

/** MACD sub-chart (line + signal + histogram). Returns null when the container is missing. */
export function createMacdSubChart(
  container: HTMLDivElement | null,
  data: Candlestick[],
  theme: ChartTheme,
  height: number
): MacdSeriesResult | null {
  if (!container) return null;
  const chart = createSubChart(container, height, theme);
  const macdData = computeMACD(data);

  const macd = chart.addSeries(LineSeries, {
    color: '#3b82f6',
    lineWidth: 2,
    title: 'MACD',
    priceLineVisible: false,
  });
  macd.setData(toLineValues(data, macdData.macd));

  const signal = chart.addSeries(LineSeries, {
    color: '#eab308',
    lineWidth: 2,
    title: 'Signal',
    priceLineVisible: false,
  });
  signal.setData(toLineValues(data, macdData.signal));

  const histogram = chart.addSeries(HistogramSeries, {
    priceLineVisible: false,
    title: 'Histogram',
  });
  const histData: (HistogramData & { time: UTCTimestamp })[] = [];
  for (let i = 0; i < data.length; i++) {
    const value = macdData.histogram[i];
    if (value !== null && value !== undefined) {
      histData.push({
        time: data[i].time as UTCTimestamp,
        value,
        color: value >= 0 ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)',
      });
    }
  }
  histogram.setData(histData);

  return { chart, macd, signal, histogram };
}

export interface ChartMarkerInput {
  patterns: Pattern[];
  highlightedPatternId: string | null;
  annotations: AnnotationDrawing[];
  trendlineStart: ChartPoint | null;
  trendlineStartColor: string;
}

export type ChartMarker = SeriesMarkerBar<UTCTimestamp>;

/** Combine pattern, annotation and in-progress trendline markers into one typed list. */
export function buildChartMarkers(input: ChartMarkerInput): ChartMarker[] {
  const markers: ChartMarker[] = [];

  for (const p of input.patterns) {
    const isHighlighted = input.highlightedPatternId !== null && input.highlightedPatternId === p.id;
    const iconPrefix = p.type === 'bullish' ? '🟢' : p.type === 'bearish' ? '🔴' : '⚪';
    const winRateText = p.winRate ? ` (${p.winRate}%)` : '';
    markers.push({
      time: p.time as UTCTimestamp,
      position: p.type === 'bullish' ? 'belowBar' : p.type === 'bearish' ? 'aboveBar' : 'inBar',
      color: p.type === 'bullish' ? '#10b981' : p.type === 'bearish' ? '#f43f5e' : '#a1a1aa',
      shape: p.type === 'bullish' ? 'arrowUp' : p.type === 'bearish' ? 'arrowDown' : 'circle',
      text: `${isHighlighted ? '⭐ ' : ''}${iconPrefix} ${p.name}${winRateText}`,
      size: isHighlighted ? 2.8 : 1.5,
    });
  }

  for (const ann of input.annotations) {
    markers.push({
      time: ann.time as UTCTimestamp,
      position: 'aboveBar',
      color: ann.color || '#a855f7',
      shape: 'square',
      text: ann.text,
      size: 1.5,
    });
  }

  if (input.trendlineStart) {
    markers.push({
      time: input.trendlineStart.time as UTCTimestamp,
      position: 'inBar',
      color: input.trendlineStartColor,
      shape: 'circle',
      text: 'TL START 🔍',
      size: 1.2,
    });
  }

  return markers;
}

/**
 * Bidirectionally syncs the visible logical range between the main chart and
 * its sub-charts. Returns an unsubscribe function.
 */
export function syncTimeScales(mainChart: IChartApi, subCharts: IChartApi[]): () => void {
  const mainTimeScale = mainChart.timeScale();
  const cleanup: (() => void)[] = [];

  for (const subChart of subCharts) {
    const subTimeScale = subChart.timeScale();

    const fromMain = (range: LogicalRange | null) => {
      if (range) subTimeScale.setVisibleLogicalRange(range);
    };
    const fromSub = (range: LogicalRange | null) => {
      if (range) mainTimeScale.setVisibleLogicalRange(range);
    };

    mainTimeScale.subscribeVisibleLogicalRangeChange(fromMain);
    subTimeScale.subscribeVisibleLogicalRangeChange(fromSub);
    cleanup.push(() => {
      mainTimeScale.unsubscribeVisibleLogicalRangeChange(fromMain);
      subTimeScale.unsubscribeVisibleLogicalRangeChange(fromSub);
    });
  }

  return () => cleanup.forEach((fn) => fn());
}

/** Format a lightweight-charts Time value into a displayable date string. */
export function formatChartTime(time: Time | undefined): string {
  if (time === undefined) return '';
  if (typeof time === 'number') {
    const dateObj = new Date(time * 1000);
    return dateObj.toISOString().replace('T', ' ').substring(0, 16);
  }
  if (typeof time === 'string') return time;
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

/** Extract epoch seconds from a lightweight-charts Time value, when possible. */
export function toEpochSeconds(time: Time | undefined): number | undefined {
  if (time === undefined) return undefined;
  if (typeof time === 'number') return time;
  if (typeof time === 'string') {
    const t = Date.parse(time);
    return isNaN(t) ? undefined : Math.floor(t / 1000);
  }
  return undefined;
}

export type { BarData, DrawingsState };
