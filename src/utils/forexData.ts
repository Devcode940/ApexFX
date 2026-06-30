import { Candlestick, Timeframe, WatchlistItem, TechnicalIndicatorsState, Pattern, TradingSignal, NewsItem } from '../types';
import { PAIRS_CONFIG, TIME_CONFIG as TIME_CONFIG_FULL } from '../constants/config';

// Re-export PAIRS_CONFIG for backward compatibility
export { PAIRS_CONFIG };

// Pseudo-random generator for stable data
export function createRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h = Math.imul(h ^ 123456789, 214013) + 2531011 | 0;
    return (h >>> 16 & 0x7fff) / 32768; // returns [0, 1)
  };
}

export function getDecimalCount(symbol: string): number {
  const config = PAIRS_CONFIG[symbol];
  if (config) return config.pipDecimal + 1;
  return symbol.includes('JPY') ? 3 : 5;
}

export function formatPrice(price: number, symbol: string): string {
  if (price === undefined || price === null) return '0.00';
  const decimals = getDecimalCount(symbol);
  return price.toFixed(decimals);
}

// Re-export TIME_CONFIG for backward compatibility
export const TIME_CONFIG: Record<Timeframe, { label: string; offsetSec: number }> = TIME_CONFIG_FULL;

// Generates starting dataset for pairs
export function generateHistoricalData(symbol: string, timeframe: Timeframe, count = 180): Candlestick[] {
  const config = PAIRS_CONFIG[symbol] || { name: symbol, basePrice: 1.000, pipDecimal: 4, spreadPips: 1.5 };
  const rand = createRandom(symbol + '_' + timeframe);
  const timeOffset = TIME_CONFIG[timeframe].offsetSec;

  let price = config.basePrice;
  const list: Candlestick[] = [];

  // Anchor ending time near current timestamp (e.g. now minus a small lag)
  let currentTime = Math.floor(Date.now() / 1000) - (count * timeOffset);

  // Volatility scale depending on timeframe
  let volScale = 0.0006;
  if (timeframe === '1m') volScale = 0.00015;
  else if (timeframe === '5m') volScale = 0.00025;
  else if (timeframe === '15m') volScale = 0.00035;
  else if (timeframe === '1H') volScale = 0.0008;
  else if (timeframe === '4H') volScale = 0.0015;
  else if (timeframe === 'D') volScale = 0.0045;

  if (symbol.includes('JPY')) {
    volScale *= 100; // Japanese Yen pip scale adjustments
  }

  for (let i = 0; i < count; i++) {
    const trendFactor = Math.sin(i / 15) * 0.4 + (rand() - 0.5) * 2; // subtle waves
    const delta = price * volScale * trendFactor;
    const open = price;
    const close = price + delta;

    const high = Math.max(open, close) + (rand() * volScale * price * 0.4);
    const low = Math.min(open, close) - (rand() * volScale * price * 0.4);

    list.push({
      time: currentTime,
      open: parseFloat(open.toFixed(config.pipDecimal + 1)),
      high: parseFloat(high.toFixed(config.pipDecimal + 1)),
      low: parseFloat(low.toFixed(config.pipDecimal + 1)),
      close: parseFloat(close.toFixed(config.pipDecimal + 1)),
      volume: Math.floor(rand() * 10000 + 1500)
    });

    price = close;
    currentTime += timeOffset;
  }

  return list;
}

// Indicator computations
export function computeSMA(data: Candlestick[], period = 20): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      sma.push(sum / period);
    }
  }
  return sma;
}

export function computeEMA(data: Candlestick[], period = 50): (number | null)[] {
  if (data.length === 0) return [];

  const k = 2 / (period + 1);
  const ema: (number | null)[] = [];

  if (data.length <= period) {
    return Array(data.length).fill(null);
  }

  // Use SMA for the first period, then switch to EMA
  const initialSma = data.slice(0, period).reduce((sum, d) => sum + d.close, 0) / period;
  let prevEma = initialSma;

  for (let i = 0; i < period; i++) {
    ema.push(null);
  }

  ema.push(prevEma);

  for (let i = period + 1; i < data.length; i++) {
    prevEma = data[i].close * k + prevEma * (1 - k);
    ema.push(prevEma);
  }

  return ema;
}

export function computeRSI(data: Candlestick[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = [];
  if (data.length <= period) {
    return Array(data.length).fill(null);
  }

  let avgGain = 0;
  let avgLoss = 0;

  // First RSI value calculations
  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) {
    rsi.push(null);
  }

  const initialRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + initialRs));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}

export function computeBollingerBands(data: Candlestick[], period = 20, multiplier = 2) {
  const sma = computeSMA(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    const smaVal = sma[i];
    if (smaVal === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let sumSqDiff = 0;
      for (let j = 0; j < period; j++) {
        sumSqDiff += Math.pow(data[i - j].close - smaVal, 2);
      }
      const dev = Math.sqrt(sumSqDiff / period);
      upper.push(smaVal + multiplier * dev);
      lower.push(smaVal - multiplier * dev);
    }
  }

  return { basis: sma, upper, lower };
}

export function computeMACD(data: Candlestick[], fast = 12, slow = 26, signal = 9) {
  const emaFast = computeEMA(data, fast);
  const emaSlow = computeEMA(data, slow);
  
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (f === null || s === null) {
      macdLine.push(null);
    } else {
      macdLine.push(f - s);
    }
  }

  // MACD signal line is the EMA of MACD Line. We'll approximate using EMA algorithm
  const macdSignal: (number | null)[] = [];
  const k = 2 / (signal + 1);
  let firstValidIdx = -1;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      firstValidIdx = i;
      break;
    }
  }

  if (firstValidIdx === -1) {
    return { macd: macdLine, signal: Array(data.length).fill(null), histogram: Array(data.length).fill(null) };
  }

  for (let i = 0; i < macdLine.length; i++) {
    if (i < firstValidIdx) {
      macdSignal.push(null);
    } else if (i === firstValidIdx) {
      macdSignal.push(macdLine[i]);
    } else {
      const prevSig = macdSignal[i - 1];
      const curMacd = macdLine[i];
      if (prevSig === null || curMacd === null) {
        macdSignal.push(null);
      } else {
        macdSignal.push(curMacd * k + prevSig * (1 - k));
      }
    }
  }

  const histogram: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    const m = macdLine[i];
    const s = macdSignal[i];
    if (m === null || s === null) {
      histogram.push(null);
    } else {
      histogram.push(m - s);
    }
  }

  return { macd: macdLine, signal: macdSignal, histogram };
}

export function computeFibonacci(data: Candlestick[]) {
  if (data.length === 0) return null;
  // Use last 100 periods or entire period to extract high/low anchor points
  const window = data.slice(-100);
  let highest = -Infinity;
  let lowest = Infinity;
  let highestIdx = 0;
  let lowestIdx = 0;

  window.forEach((candle, idx) => {
    if (candle.high > highest) {
      highest = candle.high;
      highestIdx = idx;
    }
    if (candle.low < lowest) {
      lowest = candle.low;
      lowestIdx = idx;
    }
  });

  const isDowntrend = highestIdx < lowestIdx; // highest occurred before lowest
  const range = highest - lowest;

  return {
    isDowntrend,
    high: highest,
    low: lowest,
    r236: isDowntrend ? highest - range * 0.236 : lowest + range * 0.236,
    r382: isDowntrend ? highest - range * 0.382 : lowest + range * 0.382,
    r500: isDowntrend ? highest - range * 0.500 : lowest + range * 0.500,
    r618: isDowntrend ? highest - range * 0.618 : lowest + range * 0.618,
  };
}

export function computeATR(data: Candlestick[], period = 14): (number | null)[] {
  const atr: (number | null)[] = Array(data.length).fill(null);
  if (data.length <= period) {
    return atr;
  }
  
  const tr: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
    } else {
      const h_l = data[i].high - data[i].low;
      const h_pc = Math.abs(data[i].high - data[i - 1].close);
      const l_pc = Math.abs(data[i].low - data[i - 1].close);
      tr.push(Math.max(h_l, h_pc, l_pc));
    }
  }

  // Calculate first ATR value (SMA of TR for first period elements)
  let sumTr = 0;
  for (let i = 0; i < period; i++) {
    sumTr += tr[i];
  }
  let currentAtr = sumTr / period;
  atr[period - 1] = currentAtr;

  // Subsequent values using Welles Wilder smoothing
  for (let i = period; i < data.length; i++) {
    currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
    atr[i] = currentAtr;
  }

  return atr;
}

export interface VolatilityDetails {
  atr: number;
  formattedAtr: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  color: string;
  bgColor: string;
  borderColor: string;
  ratio: number;
}

export function calculateVolatilityDetails(data: Candlestick[], symbol: string): VolatilityDetails | null {
  if (data.length < 15) return null;

  const atrValues = computeATR(data, 14);
  const latestAtr = atrValues[atrValues.length - 1];
  if (latestAtr === null || latestAtr === undefined) return null;

  // Find the average of all non-null ATR values for comparison
  const validAtrs = atrValues.filter((v): v is number => v !== null);
  if (validAtrs.length === 0) return null;
  const avgAtr = validAtrs.reduce((acc, v) => acc + v, 0) / validAtrs.length;

  const ratio = latestAtr / (avgAtr || 1);

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  let color = 'text-amber-400';
  let bgColor = 'bg-amber-950/20';
  let borderColor = 'border-amber-900/35';

  if (ratio < 0.85) {
    riskLevel = 'LOW';
    color = 'text-emerald-400';
    bgColor = 'bg-emerald-950/20';
    borderColor = 'border-emerald-900/35';
  } else if (ratio > 1.20) {
    riskLevel = 'HIGH';
    color = 'text-rose-400';
    bgColor = 'bg-rose-950/20';
    borderColor = 'border-rose-900/35';
  }

  // Format ATR nicely based on the asset
  let formattedAtr = '';
  if (symbol === 'XAUUSD') {
    formattedAtr = `$${latestAtr.toFixed(2)}`;
  } else if (symbol === 'XAGUSD') {
    formattedAtr = `$${latestAtr.toFixed(3)}`;
  } else {
    // Forex
    const pipMultiplier = symbol.includes('JPY') ? 100 : 10000;
    const pipsValue = latestAtr * pipMultiplier;
    formattedAtr = `${pipsValue.toFixed(1)} pips`;
  }

  return {
    atr: latestAtr,
    formattedAtr,
    riskLevel,
    color,
    bgColor,
    borderColor,
    ratio
  };
}

// Candlestick Pattern Identifier with advanced Profitability Auto-Scanner
export function detectPatterns(data: Candlestick[]): Pattern[] {
  const patterns: Pattern[] = [];
  if (data.length < 5) return patterns;

  // Pre-calculate indicators for confirming profitability of formations
  const rsi = computeRSI(data, 14);
  const ema50 = computeEMA(data, 50);
  const bb = computeBollingerBands(data, 20, 2);

  // Calculate volume context
  let totalVolume = 0;
  let volumeCount = 0;
  for (let j = 0; j < data.length; j++) {
    if (data[j].volume) {
      totalVolume += data[j].volume!;
      volumeCount++;
    }
  }
  const avgVolume = volumeCount > 0 ? totalVolume / volumeCount : 1;

  for (let i = 2; i < data.length; i++) {
    const c = data[i];
    const p = data[i - 1];
    const pp = data[i - 2];

    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const isBullish = c.close > c.open;
    const isBearish = c.close < c.open;

    if (range === 0) continue;

    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);

    let pat: Omit<Pattern, 'winRate' | 'reliability' | 'profitFactor' | 'volumeConfirm' | 'score' | 'indicatorsConfirm'> | null = null;

    // 1. DOJI
    const isDoji = (body / range) < 0.12 && range > 0;
    if (isDoji) {
      pat = {
        id: `doji_${i}`,
        name: 'Doji',
        type: 'neutral',
        time: c.time,
        description: 'Indicates indecision between buyers and sellers. Watch for a reverse signal.',
        candlestickIndex: i,
      };
    }
    // 2. HAMMER (Bullish Reversal - Long lower wick, small body at top, little upper wick)
    else if ((lowerWick > body * 1.8) && (upperWick < body * 0.6) && (body / range > 0.1) && (i > 10 && c.close > c.low + range * 0.6)) {
      pat = {
        id: `hammer_${i}`,
        name: 'Hammer',
        type: 'bullish',
        time: c.time,
        description: 'Bullish reversal pattern. Price rejected low values, showing substantial buying force.',
        candlestickIndex: i,
      };
    }
    // 3. SHOOTING STAR (Bearish Reversal - Long upper wick, small body at bottom, little lower wick)
    else if ((upperWick > body * 1.8) && (lowerWick < body * 0.6) && (body / range > 0.1) && (c.close < c.low + range * 0.4)) {
      pat = {
        id: `shooting_star_${i}`,
        name: 'Shooting Star',
        type: 'bearish',
        time: c.time,
        description: 'Bearish reversal pattern. Sellers pushed price back down after buyers established a temporary peak.',
        candlestickIndex: i,
      };
    }
    // 4. BULLISH ENGULFING (t-1 Bearish, t Bullish and body covers t-1 body fully)
    else if (p.close < p.open && isBullish && c.close > p.open && c.open < p.close) {
      pat = {
        id: `bullish_engulf_${i}`,
        name: 'Bullish Engulfing',
        type: 'bullish',
        time: c.time,
        description: 'A powerful bullish trigger. Buyers took full control, overshadowing the previous day\'s selloff.',
        candlestickIndex: i,
      };
    }
    // 5. BEARISH ENGULFING
    else if (p.close > p.open && isBearish && c.close < p.open && c.open > p.close) {
      pat = {
        id: `bearish_engulf_${i}`,
        name: 'Bearish Engulfing',
        type: 'bearish',
        time: c.time,
        description: 'Strong selling pressure. Bears completely overwhelmed the bullish gains of the prior candle.',
        candlestickIndex: i,
      };
    }
    // 6. MORNING STAR (Bullish 3-candle pattern)
    else if (pp.close < pp.open && (Math.abs(p.close - p.open) / (p.high - p.low || 1) < 0.25) && isBullish && c.close > (pp.open + pp.close) / 2) {
      pat = {
        id: `morning_star_${i}`,
        name: 'Morning Star',
        type: 'bullish',
        time: c.time,
        description: 'A reliable bullish three-candle morning reversal pattern showing seller exhaustion followed by buying confidence.',
        candlestickIndex: i,
      };
    }
    // 7. EVENING STAR (Bearish 3-candle pattern)
    else if (pp.close > pp.open && (Math.abs(p.close - p.open) / (p.high - p.low || 1) < 0.25) && isBearish && c.close < (pp.open + pp.close) / 2) {
      pat = {
        id: `evening_star_${i}`,
        name: 'Evening Star',
        type: 'bearish',
        time: c.time,
        description: 'A bearish three-candle evening reversal pattern indicating that the upward trajectory has topped out.',
        candlestickIndex: i,
      };
    }

    if (pat) {
      // Calculate context-driven profitability metrics
      let baseWinRate = 50;
      let indicatorsConfirm: string[] = [];
      let volumeConfirm = false;

      const currentRsi = rsi[i];
      const currentEma = ema50[i];
      const bbUpper = bb.upper[i];
      const bbLower = bb.lower[i];

      if (pat.type === 'bullish') {
        baseWinRate = pat.name === 'Morning Star' ? 71 : pat.name === 'Bullish Engulfing' ? 68 : 64;

        if (currentRsi !== null && currentRsi !== undefined) {
          if (currentRsi < 35) {
            baseWinRate += 12;
            indicatorsConfirm.push('RSI Oversold Support');
          } else if (currentRsi > 65) {
            baseWinRate -= 10;
          } else if (currentRsi > 50) {
            baseWinRate += 4;
            indicatorsConfirm.push('RSI Positive Momentum');
          }
        }

        if (bbLower !== null && bbLower !== undefined && bbUpper !== null && bbUpper !== undefined && c.close <= bbLower + (bbUpper - bbLower) * 0.15) {
          baseWinRate += 8;
          indicatorsConfirm.push('Lower BB Channel Bounce');
        }

        if (currentEma !== null && currentEma !== undefined && c.close > currentEma) {
          baseWinRate += 6;
          indicatorsConfirm.push('Above EMA 50 Trend Support');
        }

        if (c.volume && c.volume > avgVolume * 1.15) {
          baseWinRate += 5;
          volumeConfirm = true;
          indicatorsConfirm.push('High Volume Confirmation');
        }
      } else if (pat.type === 'bearish') {
        baseWinRate = pat.name === 'Evening Star' ? 72 : pat.name === 'Bearish Engulfing' ? 69 : 65;

        if (currentRsi !== null && currentRsi !== undefined) {
          if (currentRsi > 65) {
            baseWinRate += 12;
            indicatorsConfirm.push('RSI Overbought Resistance');
          } else if (currentRsi < 35) {
            baseWinRate -= 10;
          } else if (currentRsi < 50) {
            baseWinRate += 4;
            indicatorsConfirm.push('RSI Downward Momentum');
          }
        }

        if (bbUpper !== null && bbUpper !== undefined && bbLower !== null && bbLower !== undefined && c.close >= bbUpper - (bbUpper - bbLower) * 0.15) {
          baseWinRate += 8;
          indicatorsConfirm.push('Upper BB Channel Rejection');
        }

        if (currentEma !== null && currentEma !== undefined && c.close < currentEma) {
          baseWinRate += 6;
          indicatorsConfirm.push('Below EMA 50 Trend Resistance');
        }

        if (c.volume && c.volume > avgVolume * 1.15) {
          baseWinRate += 5;
          volumeConfirm = true;
          indicatorsConfirm.push('High Volume Confirmation');
        }
      } else {
        // neutral/Doji
        baseWinRate = 50;
        if (currentRsi !== null && currentRsi !== undefined && (currentRsi < 30 || currentRsi > 70)) {
          baseWinRate += 8;
          indicatorsConfirm.push('Extreme RSI Reversal Climax');
        }
      }

      // Final limits and formatting
      const winRate = Math.min(89, Math.max(38, baseWinRate));
      const reliability = winRate > 75 ? 'High' : winRate >= 64 ? 'Medium' : 'Low';
      const profitFactor = parseFloat((1.1 + (winRate - 45) * 0.025).toFixed(2));
      const score = Math.round(winRate * (volumeConfirm ? 1.05 : 1.0) * (reliability === 'High' ? 1.1 : 1.0));

      patterns.push({
        ...pat,
        winRate,
        reliability,
        profitFactor,
        volumeConfirm,
        score,
        indicatorsConfirm: indicatorsConfirm.length > 0 ? indicatorsConfirm : undefined,
      });
    }
  }

  return patterns;
}

// Generate algorithmic signals based on latest indicators and patterns
export function generateSignal(
  symbol: string,
  timeframe: Timeframe,
  data: Candlestick[],
  indicators: TechnicalIndicatorsState
): TradingSignal {
  const currentPrice = data[data.length - 1]?.close || 1.000;
  const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };

  if (data.length === 0) {
    return {
      type: 'NEUTRAL',
      symbol,
      timeframe,
      price: currentPrice,
      tp: currentPrice,
      sl: currentPrice,
      confidence: 50,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rationale: ['Loading market data...']
    };
  }

  const sma = computeSMA(data, 20);
  const ema = computeEMA(data, 50);
  const rsi = computeRSI(data, 14);
  const macdData = computeMACD(data);
  const bb = computeBollingerBands(data, 20, 2);
  const patterns = detectPatterns(data);

  // Default values
  let buyScore = 50; // starts neutral
  const rationale: string[] = [];

  const latestSma = sma[sma.length - 1];
  const latestEma = ema[ema.length - 1];
  const latestRsi = rsi[rsi.length - 1];
  const latestMacdHist = macdData.histogram[macdData.histogram.length - 1];
  const latestMacdLine = macdData.macd[macdData.macd.length - 1];
  const latestBbUpper = bb.upper[bb.upper.length - 1];
  const latestBbLower = bb.lower[bb.lower.length - 1];

  // 1. Moving Averages crossover
  if (latestSma && latestEma) {
    if (latestSma > latestEma) {
      buyScore += 12;
      rationale.push(`Bullish crossover: 20 SMA (${latestSma.toFixed(4)}) is currently floating above 50 EMA (${latestEma.toFixed(4)}), indicating upside acceleration.`);
    } else {
      buyScore -= 12;
      rationale.push(`Bearish alignment: 20 SMA (${latestSma.toFixed(4)}) resides below 50 EMA (${latestEma.toFixed(4)}), denoting overhead resistance.`);
    }
  }

  // 2. RSI oversold/overbought check
  if (latestRsi !== null && latestRsi !== undefined) {
    if (latestRsi < 30) {
      buyScore += 20; // very bullish turning point
      rationale.push(`RSI is deeply oversold at ${latestRsi.toFixed(1)} (under 30 threshold). Sellers are overextended, presenting high potential for a bullish wedge bounce.`);
    } else if (latestRsi > 70) {
      buyScore -= 20; // very bearish
      rationale.push(`RSI is heavily overbought at ${latestRsi.toFixed(1)} (above 70 limit). Buying steam looks exhausted, raising probabilities of a steep price correction.`);
    } else if (latestRsi > 50) {
      buyScore += 5;
      rationale.push(`RSI sits in constructive territory at ${latestRsi.toFixed(1)}, supporting ongoing momentum.`);
    } else {
      buyScore -= 5;
      rationale.push(`RSI indicates light distribution at ${latestRsi.toFixed(1)}, pointing to soft buyer presence.`);
    }
  }

  // 3. Bollinger Bands channel position
  if (latestBbUpper && latestBbLower) {
    const channelSize = latestBbUpper - latestBbLower;
    const positionPct = (currentPrice - latestBbLower) / (channelSize || 1);
    
    if (positionPct < 0.1) {
      buyScore += 15;
      rationale.push(`Price is pressing against the Lower Bollinger Band context (${latestBbLower.toFixed(4)}). Historically a high-probability zone for immediate buyback reactions.`);
    } else if (positionPct > 0.9) {
      buyScore -= 15;
      rationale.push(`Price has broken outside the Upper Bollinger Band (${latestBbUpper.toFixed(4)}). Strong rejection risks are elevated; shorting candidates have increased.`);
    }
  }

  // 4. MACD trend crossovers
  if (latestMacdHist !== null && latestMacdHist !== undefined && latestMacdLine !== null && latestMacdLine !== undefined) {
    if (latestMacdHist > 0) {
      buyScore += 8;
      if (latestMacdLine > 0) {
        rationale.push(`MACD signal line histogram is positive and climbing, reflecting consistent accumulation trends.`);
      } else {
        rationale.push(`MACD histogram shifted positive while below zero, indicating an emerging trend change.`);
      }
    } else {
      buyScore -= 8;
      rationale.push(`MACD histogram is negative, implying that downside pressure remains the dominant path.`);
    }
  }

  // 5. Candlestick Patterns in last 3 periods
  const recentPatterns = patterns.filter(p => data.length - p.candlestickIndex <= 3);
  recentPatterns.forEach(pat => {
    if (pat.type === 'bullish') {
      buyScore += 15;
      rationale.push(`Spotted a bullish **${pat.name}** pattern recently. This gives a reliable technical anchor to enter long positions.`);
    } else if (pat.type === 'bearish') {
      buyScore -= 15;
      rationale.push(`Spotted a bearish **${pat.name}** pattern recently. Warns of active distribution and recommends moving stops upwards.`);
    } else {
      rationale.push(`Found a neutral **${pat.name}** candlestick formation. Indicates minor consolidating behavior.`);
    }
  });

  // Clamp buyScore to range [0, 100]
  const finalScore = Math.max(0, Math.min(100, buyScore));

  let type: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 50;

  if (finalScore >= 62) {
    type = 'BUY';
    confidence = Math.floor(60 + (finalScore - 62) * (40 / 38));
  } else if (finalScore <= 38) {
    type = 'SELL';
    confidence = Math.floor(60 + (38 - finalScore) * (40 / 38));
  } else {
    type = 'NEUTRAL';
    confidence = Math.floor(45 + Math.abs(finalScore - 50) * 2);
  }

  // Setup sensible dynamic SL / TP based on instrument pip steps
  let atrEquivalent = 0.0025; // simplified ATR

  if (symbol === 'XAUUSD') {
    atrEquivalent = 8.50;
  } else if (symbol === 'XAGUSD') {
    atrEquivalent = 0.25;
  } else if (symbol.includes('JPY')) {
    atrEquivalent = 0.35;
  }
  let tp = currentPrice;
  let sl = currentPrice;

  if (type === 'BUY') {
    tp = currentPrice + atrEquivalent * 1.5;
    sl = currentPrice - atrEquivalent * 1.0;
  } else if (type === 'SELL') {
    tp = currentPrice - atrEquivalent * 1.5;
    sl = currentPrice + atrEquivalent * 1.0;
  }

  return {
    type,
    symbol,
    timeframe,
    price: parseFloat(currentPrice.toFixed(config.pipDecimal + 1)),
    tp: parseFloat(tp.toFixed(config.pipDecimal + 1)),
    sl: parseFloat(sl.toFixed(config.pipDecimal + 1)),
    confidence,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    rationale: rationale.length > 0 ? rationale : ['Market is moving sideways near global anchors. No extreme indicator divergence is seen. Wait for breakout.']
  };
}

// Watchlist default creation and random tick updater simulation
export function generateDefaultWatchlist(): WatchlistItem[] {
  return Object.keys(PAIRS_CONFIG).map(symbol => {
    const config = PAIRS_CONFIG[symbol];
    const rand = Math.random();
    const change = (rand - 0.5) * 1.2;
    const price = config.basePrice * (1 + change / 100);
    const range = price * 0.005;
    return {
      symbol,
      name: config.name,
      price: parseFloat(price.toFixed(config.pipDecimal + 1)),
      change: parseFloat(change.toFixed(2)),
      high: parseFloat((price + range * (0.3 + rand * 0.5)).toFixed(config.pipDecimal + 1)),
      low: parseFloat((price - range * (0.3 + Math.random() * 0.7)).toFixed(config.pipDecimal + 1)),
      spread: config.spreadPips,
    };
  });
}

// Simulate a ticking price update for watchlist and active chart
export function simulatePriceTick(item: WatchlistItem): WatchlistItem {
  const config = PAIRS_CONFIG[item.symbol] || { pipDecimal: 4 };
  const changePercent = (Math.random() - 0.5) * 0.15; // small ticks
  const diff = item.price * changePercent * 0.01;

  const newPrice = item.price + diff;
  const priceMax = Math.max(item.high, newPrice);
  const priceMin = Math.min(item.low, newPrice);

  // Compute percentage changes
  const basePrice = PAIRS_CONFIG[item.symbol].basePrice;
  const newChange = ((newPrice - basePrice) / basePrice) * 100;

  return {
    ...item,
    price: parseFloat(newPrice.toFixed(config.pipDecimal + 1)),
    high: parseFloat(priceMax.toFixed(config.pipDecimal + 1)),
    low: parseFloat(priceMin.toFixed(config.pipDecimal + 1)),
    change: parseFloat(newChange.toFixed(2)),
  };
}

export const CURRENT_NEWS: NewsItem[] = [
  {
    id: 'news_1',
    time: '5m ago',
    impact: 'HIGH',
    title: 'FOMC Meeting Minutes Show Fed Reluctant to Cut Interest Rates Quickly',
    source: 'Bloomberg',
    sentiment: 'bearish',
    affectedPairs: ['EURUSD', 'GBPUSD', 'AUDUSD'],
  },
  {
    id: 'news_2',
    time: '25m ago',
    impact: 'HIGH',
    title: 'Bank of Japan Signals Possible Quantitative Tightening to Prop Up Weak Yen',
    source: 'Reuters',
    sentiment: 'bullish',
    affectedPairs: ['USDJPY', 'GBPJPY'],
  },
  {
    id: 'news_3',
    time: '1h ago',
    impact: 'MEDIUM',
    title: 'Eurozone Inflation Cools Down to 2.4%, Matching Estimates',
    source: 'Financial Times',
    sentiment: 'neutral',
    affectedPairs: ['EURUSD'],
  },
  {
    id: 'news_4',
    time: '3h ago',
    impact: 'MEDIUM',
    title: 'UK Retail Sales Surge by 1.2% in May, Beating British Consensus',
    source: 'Sky News',
    sentiment: 'bullish',
    affectedPairs: ['GBPUSD', 'GBPJPY'],
  },
  {
    id: 'news_5',
    time: '5h ago',
    impact: 'LOW',
    title: 'Canadian Crude Exports Suffer Pipeline Bottleneck Near Key Sea Terminals',
    source: 'Energy Intelligence',
    sentiment: 'bearish',
    affectedPairs: ['USDCAD'],
  }
];
