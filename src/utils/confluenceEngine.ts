import { Candlestick, Pattern, TechnicalIndicatorsState } from '../types';
import { computeSMA, computeEMA, computeRSI, computeMACD } from './forexData';

export interface ConfluenceBreakdown {
  technicalScore: number; // -35 to +35
  patternScore: number;    // -25 to +25
  strengthScore: number;   // -20 to +20
  macroScore: number;      // -20 to +20
  totalScore: number;      // 0 to 100
  verdict: 'STRONG BUY' | 'MODERATE BUY' | 'NEUTRAL' | 'MODERATE SELL' | 'STRONG SELL';
  verdictColor: string;
  summary: string;
  reasons: string[];
}

export function calculateConfluenceScore(
  data: Candlestick[],
  patterns: Pattern[] = [],
  indicatorsState?: TechnicalIndicatorsState,
  baseStrength = 5.0,
  quoteStrength = 5.0,
  rateSpread = 0
): ConfluenceBreakdown {
  if (!data || data.length < 25) {
    return {
      technicalScore: 0,
      patternScore: 0,
      strengthScore: 0,
      macroScore: 0,
      totalScore: 50,
      verdict: 'NEUTRAL',
      verdictColor: 'text-zinc-400',
      summary: 'Insufficient candlestick data to calculate confluence matrix.',
      reasons: ['Awaiting historical bar buffer initialization.'],
    };
  }

  const reasons: string[] = [];
  const latest = data[data.length - 1];
  const close = latest.close;

  // 1. Technical Indicators (Max 35 pts)
  let technicalScore = 0;
  const sma20 = computeSMA(data, 20);
  const ema20 = computeEMA(data, 20);
  const rsi = computeRSI(data, 14);
  const macd = computeMACD(data);

  const lastSma = sma20[sma20.length - 1];
  const lastEma = ema20[ema20.length - 1];
  const lastRsi = rsi[rsi.length - 1];
  const lastMacdHist = macd.histogram[macd.histogram.length - 1];

  // Moving Average alignment
  if (lastEma !== null && lastSma !== null) {
    if (close > lastEma && lastEma > lastSma) {
      technicalScore += 12;
      reasons.push('Price trading firmly above 20 EMA and 20 SMA (Bullish Trend)');
    } else if (close < lastEma && lastEma < lastSma) {
      technicalScore -= 12;
      reasons.push('Price suppressed below 20 EMA and 20 SMA (Bearish Trend)');
    }
  }

  // RSI momentum
  if (lastRsi !== null) {
    if (lastRsi > 52 && lastRsi < 68) {
      technicalScore += 11;
      reasons.push(`RSI momentum bullish at ${lastRsi.toFixed(1)} with upside room`);
    } else if (lastRsi < 48 && lastRsi > 32) {
      technicalScore -= 11;
      reasons.push(`RSI momentum bearish at ${lastRsi.toFixed(1)} under pressure`);
    } else if (lastRsi >= 70) {
      technicalScore -= 5;
      reasons.push(`RSI overbought (${lastRsi.toFixed(1)}), pull-back risk elevated`);
    } else if (lastRsi <= 30) {
      technicalScore += 5;
      reasons.push(`RSI oversold (${lastRsi.toFixed(1)}), technical bounce potential`);
    }
  }

  // MACD confirmation
  if (lastMacdHist !== null && lastMacdHist !== undefined) {
    if (lastMacdHist > 0) {
      technicalScore += 12;
      reasons.push('MACD histogram expanding positive with bullish cross');
    } else {
      technicalScore -= 12;
      reasons.push('MACD histogram negative with bearish signal divergence');
    }
  }

  // 2. Candlestick Patterns (Max 25 pts)
  let patternScore = 0;
  if (patterns.length > 0) {
    const recentPatterns = patterns.slice(-3);
    for (const p of recentPatterns) {
      if (p.type === 'bullish') {
        patternScore += 12;
        reasons.push(`Confirmed pattern: ${p.name} (Bullish win-rate ${p.winRate || 68}%)`);
      } else if (p.type === 'bearish') {
        patternScore -= 12;
        reasons.push(`Confirmed pattern: ${p.name} (Bearish win-rate ${p.winRate || 65}%)`);
      }
    }
  }
  patternScore = Math.max(-25, Math.min(25, patternScore));

  // 3. Currency Strength Alignment (Max 20 pts)
  const strengthDiff = baseStrength - quoteStrength;
  let strengthScore = 0;
  if (strengthDiff >= 3.0) {
    strengthScore = 20;
    reasons.push(`Currency Strength: Base is significantly stronger (+${strengthDiff.toFixed(1)})`);
  } else if (strengthDiff >= 1.0) {
    strengthScore = 10;
    reasons.push(`Currency Strength: Base has moderate strength advantage (+${strengthDiff.toFixed(1)})`);
  } else if (strengthDiff <= -3.0) {
    strengthScore = -20;
    reasons.push(`Currency Strength: Quote is dominating heavily (${strengthDiff.toFixed(1)})`);
  } else if (strengthDiff <= -1.0) {
    strengthScore = -10;
    reasons.push(`Currency Strength: Quote has relative strength advantage (${strengthDiff.toFixed(1)})`);
  }

  // 4. Macro Carry Rate Advantage (Max 20 pts)
  let macroScore = 0;
  if (rateSpread >= 2.0) {
    macroScore = 20;
    reasons.push(`Macro: High positive carry trade spread (+${rateSpread.toFixed(2)}%) favors Longs`);
  } else if (rateSpread > 0) {
    macroScore = 10;
    reasons.push(`Macro: Positive interest rate differential (+${rateSpread.toFixed(2)}%)`);
  } else if (rateSpread <= -2.0) {
    macroScore = -20;
    reasons.push(`Macro: Severe negative carry spread (${rateSpread.toFixed(2)}%) favors Shorts`);
  } else if (rateSpread < 0) {
    macroScore = -10;
    reasons.push(`Macro: Negative interest rate differential (${rateSpread.toFixed(2)}%)`);
  }

  // Total Confluence Calculation
  const netRaw = technicalScore + patternScore + strengthScore + macroScore; // -100 to +100
  const totalScore = Math.max(0, Math.min(100, Math.round(50 + netRaw / 2)));

  let verdict: ConfluenceBreakdown['verdict'] = 'NEUTRAL';
  let verdictColor = 'text-amber-400';
  let summary = 'Consensus indicators are balanced without distinct directional edge.';

  if (totalScore >= 75) {
    verdict = 'STRONG BUY';
    verdictColor = 'text-emerald-400';
    summary = 'Multiple independent technical and macro layers align in bullish harmony.';
  } else if (totalScore >= 60) {
    verdict = 'MODERATE BUY';
    verdictColor = 'text-emerald-300';
    summary = 'Bullish technical and momentum skew favors long directional setups.';
  } else if (totalScore <= 25) {
    verdict = 'STRONG SELL';
    verdictColor = 'text-rose-400';
    summary = 'Heavy confluence of technical resistance and fundamental headwinds favors shorts.';
  } else if (totalScore <= 40) {
    verdict = 'MODERATE SELL';
    verdictColor = 'text-rose-300';
    summary = 'Downward momentum and strength imbalance favor defensive short positioning.';
  }

  return {
    technicalScore,
    patternScore,
    strengthScore,
    macroScore,
    totalScore,
    verdict,
    verdictColor,
    summary,
    reasons,
  };
}
