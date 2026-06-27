import React from 'react';
import { TradingSignal, Candlestick } from '../types';
import { ShieldCheck, Crosshair, TrendingUp, TrendingDown, RefreshCw, BarChart2, Gauge, Activity, PanelRightClose } from 'lucide-react';
import { formatPrice, computeSMA, computeEMA, computeRSI } from '../utils/forexData';

import { useTrading } from '../context/TradingContext';

interface SignalPanelProps {
  onCollapseOverride?: () => void;
}

export const SignalPanel: React.FC<SignalPanelProps> = React.memo(({ onCollapseOverride }) => {
  const {
    activeSignal: signal,
    handleRefreshSignal: onRefresh,
    isRefreshingSignal: isRefreshing,
    activeData: data,
    setRightSidebarOpen,
  } = useTrading();

  const onCollapse = onCollapseOverride || (() => setRightSidebarOpen(false));

  if (!signal) {
    return (
      <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-center text-xs text-zinc-400 font-mono">
        Waiting for market signal confluences...
      </div>
    );
  }
  const isBuy = signal.type === 'BUY';
  const isSell = signal.type === 'SELL';
  
  // Calculate risk reward ratio
  const differenceTp = Math.abs(signal.tp - signal.price);
  const differenceSl = Math.abs(signal.sl - signal.price);
  const riskRewardRatio = differenceSl > 0 ? (differenceTp / differenceSl).toFixed(2) : '1.50';

  let typeColor = 'bg-zinc-800 text-zinc-300 border-zinc-700';
  let typeTextColor = 'text-zinc-300';
  let typeBg = 'bg-zinc-950';

  if (isBuy) {
    typeColor = 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50';
    typeTextColor = 'text-emerald-400';
    typeBg = 'bg-emerald-950/20';
  } else if (isSell) {
    typeColor = 'bg-rose-950/60 text-rose-300 border-rose-500/50';
    typeTextColor = 'text-rose-400';
    typeBg = 'bg-rose-950/20';
  }

  // --- Sentiment Analysis from active signal metrics ---
  const analyzeSentiment = () => {
    let bullPoints = 0;
    let bearPoints = 0;
    
    signal.rationale.forEach(r => {
      const text = r.toLowerCase();
      if (text.includes('bullish') || text.includes('buyback') || text.includes('accumulation') || text.includes('oversold') || text.includes('upside') || text.includes('hammer') || text.includes('morning star')) {
        bullPoints++;
      }
      if (text.includes('bearish') || text.includes('distribution') || text.includes('overbought') || text.includes('downside') || text.includes('rejection') || text.includes('shooting star') || text.includes('evening star')) {
        bearPoints++;
      }
    });

    let score = 50;
    if (signal.type === 'BUY') {
      score = 50 + (signal.confidence / 2);
    } else if (signal.type === 'SELL') {
      score = 50 - (signal.confidence / 2);
    } else {
      const total = bullPoints + bearPoints;
      if (total > 0) {
        score = 50 + ((bullPoints - bearPoints) / total) * 15;
      }
    }

    score = Math.max(5, Math.min(95, score));
    const bullishPct = Math.round(score);
    const bearishPct = 100 - bullishPct;

    let consensusLabel = 'Neutral / Rangebound';
    let consensusColor = 'text-zinc-400';
    if (bullishPct >= 75) {
      consensusLabel = 'Strong Bullish';
      consensusColor = 'text-emerald-400';
    } else if (bullishPct >= 55) {
      consensusLabel = 'Moderate Bullish';
      consensusColor = 'text-emerald-500';
    } else if (bullishPct <= 25) {
      consensusLabel = 'Strong Bearish';
      consensusColor = 'text-rose-400';
    } else if (bullishPct <= 45) {
      consensusLabel = 'Moderate Bearish';
      consensusColor = 'text-rose-500';
    }

    const breakdown = [
      {
        name: 'Trend Bias (SMA/EMA)',
        status: signal.rationale.some(r => r.includes('SMA') && r.includes('above')) ? 'bullish' :
                signal.rationale.some(r => r.includes('SMA') && r.includes('below')) ? 'bearish' : 'neutral'
      },
      {
        name: 'Momentum Index (RSI)',
        status: signal.rationale.some(r => r.includes('RSI') && r.includes('oversold')) ? 'bullish' :
                signal.rationale.some(r => r.includes('RSI') && r.includes('overbought')) ? 'bearish' :
                signal.rationale.some(r => r.includes('RSI') && r.includes('constructive')) ? 'bullish' :
                signal.rationale.some(r => r.includes('RSI') && r.includes('distribution')) ? 'bearish' : 'neutral'
      },
      {
        name: 'Volatility Channels (Bollinger)',
        status: signal.rationale.some(r => r.includes('Bollinger') && r.includes('Lower')) ? 'bullish' :
                signal.rationale.some(r => r.includes('Bollinger') && r.includes('Upper')) ? 'bearish' : 'neutral'
      },
      {
        name: 'MACD Trend Divergence',
        status: signal.rationale.some(r => r.includes('MACD') && (r.includes('positive') || r.includes('climbing') || r.includes('emerging'))) ? 'bullish' :
                signal.rationale.some(r => r.includes('MACD') && r.includes('negative')) ? 'bearish' : 'neutral'
      },
      {
        name: 'Candlestick Formations',
        status: signal.rationale.some(r => r.includes('bullish') && (r.includes('Spotted') || r.includes('pattern'))) ? 'bullish' :
                signal.rationale.some(r => r.includes('bearish') && (r.includes('Spotted') || r.includes('pattern'))) ? 'bearish' : 'neutral'
      }
    ];

    return {
      bullishPct,
      bearishPct,
      consensusLabel,
      consensusColor,
      breakdown
    };
  };

  const sentiment = analyzeSentiment();

  // --- Trend Strength Calculation (aggregates moving average alignment and RSI velocity to provide a 0-100 score) ---
  const calculateTrendStrength = () => {
    if (!data || data.length < 50) {
      return {
        score: 50,
        label: 'Neutral / Insufficient Data',
        color: 'text-zinc-400',
        bgColor: 'bg-zinc-900/40',
        borderColor: 'border-zinc-800/80',
        scoreColor: 'text-zinc-300',
        maAlignment: 'Neutral',
        rsiVelocity: 0,
        rsiCurrent: 50,
        sma20Val: 0,
        ema50Val: 0,
        ema100Val: 0,
      };
    }

    const sma20 = computeSMA(data, 20);
    const ema50 = computeEMA(data, 50);
    const ema100 = computeEMA(data, 100);
    const rsi = computeRSI(data, 14);

    const len = data.length;
    const currentPrice = data[len - 1].close;

    const sma20Val = sma20[len - 1] ?? currentPrice;
    const ema50Val = ema50[len - 1] ?? currentPrice;
    const ema100Val = ema100[len - 1] ?? currentPrice;

    // 1. Moving Average Alignment Score (-50 to +50 points)
    let maPoints = 0;
    
    // Position of price relative to MAs
    if (currentPrice > sma20Val) maPoints += 10;
    else maPoints -= 10;

    if (currentPrice > ema100Val) maPoints += 10;
    else maPoints -= 10;

    // Alignment between MAs
    if (sma20Val > ema50Val) maPoints += 15;
    else maPoints -= 15;

    if (ema50Val > ema100Val) maPoints += 15;
    else maPoints -= 15;

    // Map maPoints from [-50, 50] to [0, 50]
    const maScoreNormalized = ((maPoints + 50) / 100) * 50;

    // Determine MA alignment description
    let maAlignment = 'Mixed';
    if (currentPrice > sma20Val && sma20Val > ema50Val && ema50Val > ema100Val) {
      maAlignment = 'Full Bullish Alignment';
    } else if (currentPrice < sma20Val && sma20Val < ema50Val && ema50Val < ema100Val) {
      maAlignment = 'Full Bearish Alignment';
    } else if (sma20Val > ema50Val && currentPrice > ema50Val) {
      maAlignment = 'Bullish Bias';
    } else if (sma20Val < ema50Val && currentPrice < ema50Val) {
      maAlignment = 'Bearish Bias';
    }

    // 2. RSI level & velocity score (0 to 50 points)
    const rsiCurrent = rsi[len - 1] ?? 50;
    // Look back 4 periods to measure the change (velocity) of the RSI
    const rsiPrev = rsi[len - 5] ?? rsiCurrent;
    const rsiVelocity = rsiCurrent - rsiPrev;

    // Base Level contribution: 0 to 25. Neutral (RSI = 50) -> 12.5 points.
    let rsiLevelScore = 12.5;
    if (rsiCurrent >= 50) {
      // Scale from 12.5 to 25 as RSI moves from 50 to 70+
      rsiLevelScore = 12.5 + Math.min(20, rsiCurrent - 50) * (12.5 / 20);
    } else {
      // Scale from 12.5 to 0 as RSI moves from 50 to 30-
      rsiLevelScore = 12.5 - Math.min(20, 50 - rsiCurrent) * (12.5 / 20);
    }

    // Velocity contribution: 0 to 25. Neutral (velocity = 0) -> 12.5 points.
    // A velocity of +5 or more (or -5 or less) gives full range.
    let rsiVelocityScore = 12.5 + (rsiVelocity * 2.5); // 2.5 multiplier so a change of +/-5 moves score by +/-12.5
    rsiVelocityScore = Math.max(0, Math.min(25, rsiVelocityScore));

    const rsiScoreNormalized = rsiLevelScore + rsiVelocityScore;

    // 3. Final aggregated Trend Strength Score (0 to 100)
    let finalScore = Math.round(maScoreNormalized + rsiScoreNormalized);
    finalScore = Math.max(0, Math.min(100, finalScore));

    // Labels & Styling
    let label = 'Neutral / Rangebound';
    let color = 'text-zinc-400';
    let bgColor = 'bg-zinc-900/40';
    let borderColor = 'border-zinc-800/80';
    let scoreColor = 'text-zinc-300';

    if (finalScore >= 80) {
      label = 'Strong Uptrend';
      color = 'text-emerald-400';
      bgColor = 'bg-emerald-950/20';
      borderColor = 'border-emerald-500/35';
      scoreColor = 'text-emerald-400';
    } else if (finalScore >= 60) {
      label = 'Weak Uptrend';
      color = 'text-emerald-500/90';
      bgColor = 'bg-emerald-950/10';
      borderColor = 'border-emerald-500/20';
      scoreColor = 'text-emerald-500';
    } else if (finalScore <= 20) {
      label = 'Strong Downtrend';
      color = 'text-rose-400';
      bgColor = 'bg-rose-950/20';
      borderColor = 'border-rose-500/35';
      scoreColor = 'text-rose-400';
    } else if (finalScore <= 40) {
      label = 'Weak Downtrend';
      color = 'text-rose-500/90';
      bgColor = 'bg-rose-950/10';
      borderColor = 'border-rose-500/20';
      scoreColor = 'text-rose-500';
    }

    return {
      score: finalScore,
      label,
      color,
      bgColor,
      borderColor,
      scoreColor,
      maAlignment,
      rsiVelocity,
      rsiCurrent,
      sma20Val,
      ema50Val,
      ema100Val,
    };
  };

  const trend = calculateTrendStrength();

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden h-full" id="signal_component">
      {/* Header */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onCollapse ? (
            <button
              onClick={onCollapse}
              className="text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer mr-1"
              title="Collapse Panel"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          ) : (
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          )}
          <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200">
            AI Trade Engine Signals
          </h2>
        </div>
        <button
          onClick={onRefresh}
          className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
          title="Recalculate signal values"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-4 flex-1 space-y-4 overflow-y-auto">
        {/* Core signal announcement card */}
        <div className={`p-4 rounded-lg border flex flex-col md:flex-row items-center justify-between gap-4 ${typeColor} ${typeBg}`}>
          <div className="space-y-1 text-center md:text-left">
            <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-mono">
              SUGGESTED STRATEGY ({signal.timeframe})
            </span>
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <span className={`text-2xl font-display font-black tracking-wider ${typeTextColor}`}>
                {signal.type}
              </span>
              <span className="text-zinc-500 font-normal">at</span>
              <span className="text-xl font-mono font-extrabold text-zinc-100">
                {formatPrice(signal.price, signal.symbol)}
              </span>
            </div>
          </div>

          {/* Confidence slider display */}
          <div className="w-full md:w-36 space-y-1">
            <div className="flex justify-between text-[11px] font-mono text-zinc-400">
              <span>Confidence</span>
              <span className={`font-bold ${typeTextColor}`}>{signal.confidence}%</span>
            </div>
            <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden border border-zinc-800">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  isBuy ? 'bg-emerald-500' : isSell ? 'bg-rose-500' : 'bg-zinc-500'
                }`}
                style={{ width: `${signal.confidence}%` }}
              />
            </div>
          </div>
        </div>

        {/* Trade Setup metrics (TP/SL) */}
        {signal.type !== 'NEUTRAL' ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
              <div className="text-[10px] text-zinc-400 uppercase font-mono">Stop Loss (SL)</div>
              <div className="text-sm font-bold font-mono text-rose-400 tracking-tight mt-0.5">
                {formatPrice(signal.sl, signal.symbol)}
              </div>
            </div>

            <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
              <div className="text-[10px] text-zinc-400 uppercase font-mono">Take Profit (TP)</div>
              <div className="text-sm font-bold font-mono text-emerald-400 tracking-tight mt-0.5">
                {formatPrice(signal.tp, signal.symbol)}
              </div>
            </div>

            <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800 flex flex-col justify-center">
              <div className="text-[10px] text-zinc-400 uppercase font-mono">Risk/Reward</div>
              <div className="text-sm font-bold font-mono text-blue-400 tracking-tight mt-0.5">
                1 : {riskRewardRatio}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg p-3 text-center text-xs text-zinc-400 font-mono flex items-center justify-center gap-2">
            <BarChart2 className="w-4 h-4 text-zinc-500" />
            <span>Market is consolidating. Wait for technical expansion.</span>
          </div>
        )}

        {/* Market Sentiment Consensus Meter */}
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3.5 space-y-3" id="sentiment_meter_card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
              <Gauge className="w-4 h-4 text-emerald-400" />
              <span>Market Sentiment</span>
            </div>
            <span className={`text-[11px] font-mono font-black uppercase tracking-tight px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 ${sentiment.consensusColor}`}>
              {sentiment.consensusLabel}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] font-mono font-bold">
              <span className="text-rose-400 flex items-center gap-0.5">
                <TrendingDown className="w-3 h-3" /> BEAR {sentiment.bearishPct}%
              </span>
              <span className="text-emerald-400 flex items-center gap-0.5">
                BULL {sentiment.bullishPct}% <TrendingUp className="w-3 h-3" />
              </span>
            </div>

            <div className="relative w-full h-3.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800/80 flex">
              <div
                className="h-full bg-gradient-to-r from-rose-600 to-rose-500 transition-all duration-500"
                style={{ width: `${sentiment.bearishPct}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500"
                style={{ width: `${sentiment.bullishPct}%` }}
              />
              <div className="absolute left-1/2 top-0 bottom-0 w-[1.5px] bg-zinc-950/70" />
            </div>
          </div>

          {/* Detailed Indicator Breakdown */}
          <div className="pt-2.5 border-t border-zinc-800/50 space-y-1.5">
            <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">Consensus Matrix Scan</div>
            <div className="grid grid-cols-1 gap-1.5">
              {sentiment.breakdown.map((item, idx) => {
                let statusLabel = 'NEUTRAL';
                let statusColor = 'text-zinc-500';
                let bulletColor = 'bg-zinc-800 border-zinc-700';

                if (item.status === 'bullish') {
                  statusLabel = 'BULLISH';
                  statusColor = 'text-emerald-400';
                  bulletColor = 'bg-emerald-500 shadow-sm shadow-emerald-500/30';
                } else if (item.status === 'bearish') {
                  statusLabel = 'BEARISH';
                  statusColor = 'text-rose-400';
                  bulletColor = 'bg-rose-500 shadow-sm shadow-rose-500/30';
                }

                return (
                  <div key={idx} className="flex items-center justify-between text-[11px] font-mono py-0.5">
                    <span className="text-zinc-400 font-sans">{item.name}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold ${statusColor}`}>{statusLabel}</span>
                      <span className={`h-1.5 w-1.5 rounded-full transition-colors ${bulletColor}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Trend Strength Dashboard Widget */}
        <div className={`border rounded-xl p-3.5 space-y-3 ${trend.bgColor} ${trend.borderColor}`} id="trend_strength_widget">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
              <Activity className="w-4 h-4 text-amber-400" />
              <span>Trend Strength Index</span>
            </div>
            <span className={`text-[11px] font-mono font-black uppercase tracking-tight px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 ${trend.color}`}>
              {trend.label}
            </span>
          </div>

          <div className="flex items-center gap-4 py-1">
            {/* Elegant Circle Gauge for Score */}
            <div className="relative flex items-center justify-center shrink-0 w-16 h-16 bg-zinc-950 rounded-full border border-zinc-800">
              <svg className="w-14 h-14 transform -rotate-90">
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  fill="transparent"
                  className="text-zinc-800/60"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  fill="transparent"
                  strokeDasharray={`${2 * Math.PI * 24}`}
                  strokeDashoffset={`${2 * Math.PI * 24 * (1 - trend.score / 100)}`}
                  className={`${trend.scoreColor} transition-all duration-1000 ease-out`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
                <span className="text-sm font-extrabold text-zinc-100">{trend.score}</span>
                <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider">Index</span>
              </div>
            </div>

            {/* Sub-details / Technical Aggregation */}
            <div className="flex-1 space-y-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-zinc-500">MA Alignment</span>
                  <span className={`font-semibold ${
                    trend.maAlignment.includes('Bullish') ? 'text-emerald-400' :
                    trend.maAlignment.includes('Bearish') ? 'text-rose-400' : 'text-zinc-300'
                  }`}>{trend.maAlignment}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-zinc-500">RSI Level (14)</span>
                  <span className="text-zinc-300 font-semibold">{trend.rsiCurrent.toFixed(1)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-zinc-500">RSI Velocity</span>
                  <span className={`font-semibold flex items-center gap-0.5 ${
                    trend.rsiVelocity > 0 ? 'text-emerald-400' : trend.rsiVelocity < 0 ? 'text-rose-400' : 'text-zinc-400'
                  }`}>
                    {trend.rsiVelocity > 0 ? '+' : ''}{trend.rsiVelocity.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Graphical Micro-Bar for RSI Velocity and MA position */}
          <div className="pt-2 border-t border-zinc-800/40 grid grid-cols-2 gap-3 text-[10px] font-mono text-zinc-400">
            <div className="space-y-1 bg-zinc-950/50 p-1.5 rounded border border-zinc-800/40">
              <span className="text-zinc-500 block text-[9px] uppercase font-bold">MA Cascade</span>
              <div className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${trend.maAlignment.includes('Bullish') ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="truncate">{trend.sma20Val > trend.ema50Val ? 'Bullish Stack' : 'Bearish Gap'}</span>
              </div>
            </div>
            <div className="space-y-1 bg-zinc-950/50 p-1.5 rounded border border-zinc-800/40">
              <span className="text-zinc-500 block text-[9px] uppercase font-bold">RSI Mom. (Vel)</span>
              <div className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${trend.rsiVelocity > 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="truncate">{trend.rsiVelocity > 1.5 ? 'Accelerating' : trend.rsiVelocity < -1.5 ? 'Decelerating' : 'Stable'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bullet rationale points */}
        <div className="space-y-2.5">
          <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 border-b border-zinc-800/60 pb-1.5">
            <Crosshair className="w-3.5 h-3.5 text-zinc-500" />
            Technical Signal Elements ({signal.symbol})
          </div>
          
          <div className="space-y-2 text-xs">
            {signal.rationale.map((point, index) => {
              // Extract sub strings between double stars and bold them
              const formattedText = point.split('**').map((chunk, i) => 
                i % 2 === 1 ? <strong key={i} className="text-zinc-100 font-semibold">{chunk}</strong> : chunk
              );
              
              return (
                <div key={index} className="flex gap-2 items-start py-1 px-1.5 text-zinc-300">
                  <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${
                    isBuy ? 'bg-emerald-500' : isSell ? 'bg-rose-500' : 'bg-zinc-500'
                  }`} />
                  <p className="leading-normal font-sans text-zinc-300">
                    {formattedText}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer warning */}
      <div className="px-4 py-2.5 bg-zinc-900 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono leading-relaxed uppercase">
        ⚠️ FOREX INVESTING CARRIES SUBSTANTIAL RISK. THESE ALGORITHMIC CALCULATIONS ARE EXPERIMENTAL AND PROVIDED ONLY AS INDICATIONAL WORKSPACE AIDS.
      </div>
    </div>
  );
});
