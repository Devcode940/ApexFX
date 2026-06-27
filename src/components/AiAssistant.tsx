import React, { useState, useEffect, useRef } from 'react';
import { Candlestick, Timeframe, TradingSignal } from '../types';
import { 
  MessageSquare, 
  Send, 
  Bot, 
  Sparkles, 
  User, 
  AlertCircle, 
  HelpCircle,
  TrendingUp,
  Sliders,
  Award,
  ShieldCheck,
  Activity,
  Calculator,
  Compass
} from 'lucide-react';
import { 
  computeRSI, 
  computeSMA, 
  computeEMA, 
  computeFibonacci, 
  computeATR, 
  detectPatterns, 
  PAIRS_CONFIG 
} from '../utils/forexData';

import { useTrading } from '../context/TradingContext';

interface ChatMessage {
  sender: 'ai' | 'user';
  text: string;
  time: string;
  image?: string;
}

type TemplateCategory = 'analysis' | 'trends' | 'risk';

interface AiAssistantProps {}

export const AiAssistant: React.FC<AiAssistantProps> = () => {
  const {
    selectedSymbol: symbol,
    selectedTimeframe: timeframe,
    activeData: data,
    activeSignal,
    aiSnapshot: attachedImage,
    onClearAttachedImage,
  } = useTrading();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('analysis');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Initialize with greeting message based on symbol
  useEffect(() => {
    setMessages([
      {
        sender: 'ai',
        text: `Greetings! I am the **ApexFX AI Analyst**. I have fully scanned **${symbol}** on the **${timeframe}** timeframe. 📊\n\nMy core engine suggests a **${activeSignal.type}** consensus strategy with **${activeSignal.confidence}%** confidence at **${activeSignal.price}**.\n\nUse our **Expert Strategy Templates** below to run real-time confluences, Fibonacci levels, or risk calculations instantly, or ask any custom technical analysis questions!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
    ]);
  }, [symbol, timeframe]);

  // Handle scrolling after new message
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping]);

  const generateResponse = (userMsg: string) => {
    const q = userMsg.toLowerCase();
    const curPrice = data[data.length - 1]?.close || 1.0000;
    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
    const decimals = config.pipDecimal;

    // 1. MULTI-INDICATOR CONFLUENCE CHECK
    if (q.includes('confluence') || q.includes('multi-indicator') || q.includes('check')) {
      const rsiArr = computeRSI(data, 14);
      const lastRsi = rsiArr[rsiArr.length - 1];
      const smaArr = computeSMA(data, 20);
      const lastSma = smaArr[smaArr.length - 1];
      const emaArr = computeEMA(data, 50);
      const lastEma = emaArr[emaArr.length - 1];

      let bullishSignals = 0;
      let bearishSignals = 0;
      let totalSignals = 0;

      const checklist: string[] = [];

      // Evaluate RSI
      if (lastRsi !== null) {
        totalSignals++;
        if (lastRsi < 35) {
          bullishSignals += 1.5; // Over-weighted
          checklist.push(`🟢 **RSI Oversold (${lastRsi.toFixed(1)})**: Extremely oversold levels indicate imminent buying pressure/reversal.`);
        } else if (lastRsi > 65) {
          bearishSignals += 1.5;
          checklist.push(`🔴 **RSI Overbought (${lastRsi.toFixed(1)})**: Extremely overbought levels suggest upside exhaustion.`);
        } else if (lastRsi > 50) {
          bullishSignals++;
          checklist.push(`🟢 **RSI Bullish Momentum (${lastRsi.toFixed(1)})**: Residing above the median 50 level, buyers maintain active momentum.`);
        } else {
          bearishSignals++;
          checklist.push(`🔴 **RSI Bearish Momentum (${lastRsi.toFixed(1)})**: Trading below the 50 level, sellers control momentum.`);
        }
      }

      // Evaluate EMA 50 (Trend)
      if (lastEma !== null) {
        totalSignals++;
        if (curPrice > lastEma) {
          bullishSignals++;
          checklist.push(`🟢 **Above EMA 50 (Trend Support)**: Price is trading above the 50-period EMA, confirming a macro uptrend.`);
        } else {
          bearishSignals++;
          checklist.push(`🔴 **Below EMA 50 (Trend Resistance)**: Price is trading below the 50-period EMA, confirming a macro downtrend.`);
        }
      }

      // Evaluate SMA 20 (Short-term flow)
      if (lastSma !== null) {
        totalSignals++;
        if (curPrice > lastSma) {
          bullishSignals++;
          checklist.push(`🟢 **Above SMA 20 (Bullish Momentum)**: Short-term buyers are keeping pressure above the 20-period baseline.`);
        } else {
          bearishSignals++;
          checklist.push(`🔴 **Below SMA 20 (Bearish Momentum)**: Sellers maintain control below the 20-period moving average.`);
        }
      }

      const consensusScore = Math.round((bullishSignals / (bullishSignals + bearishSignals || 1)) * 100);
      const finalConsensus = consensusScore >= 65 ? 'STRONG BULLISH' : consensusScore > 45 ? 'NEUTRAL / RANGEBOUND' : 'STRONG BEARISH';

      return `### 🔍 Multi-Indicator Confluence Report for **${symbol}**\n\n` +
        `Current Live Price: **${curPrice.toFixed(decimals + 1)}**\n` +
        `Market consensus rating: **${finalConsensus}** (${consensusScore}% Bullish Alignment)\n\n` +
        `#### Active Confirmation Checklist:\n` +
        checklist.map(line => `- ${line}`).join('\n') + `\n\n` +
        `#### Trading Guidance:\n` +
        `${consensusScore >= 65 
          ? `✓ Focus on **Buy / Long** setups near local dynamic supports like the SMA 20 or EMA 50. Use tight protection right below key EMA levels.` 
          : consensusScore > 45 
          ? `✓ Price is in standard neutral fluctuation. Avoid aggressive trend-following; prefer range-bound boundary strategies or wait for a breakout confirmation.` 
          : `✓ Focus on **Sell / Short** setups near moving average rejection zones. Ensure stop loss orders protect your margin above local high resistance clusters.`
        }`;
    }

    // 2. FIBONACCI RETRACEMENT LEVELS
    if (q.includes('fibonacci') || q.includes('retracement') || q.includes('fibo')) {
      const fib = computeFibonacci(data);
      if (!fib) {
        return `⚠️ **Insufficient Data**: Not enough historical candles loaded to anchor Fibonacci high/low points. Please switch to a higher timeframe or wait for more feed ticks.`;
      }

      return `### 📏 Real-Time Fibonacci Retracement Levels for **${symbol}**\n\n` +
        `Calculated from trailing 100 candles of **${timeframe}**:\n` +
        `- **High Anchor Point**: \`${fib.high.toFixed(decimals + 1)}\`\n` +
        `- **Low Anchor Point**: \`${fib.low.toFixed(decimals + 1)}\`\n` +
        `- **Market Direction**: **${fib.isDowntrend ? 'Downtrend Rebound Target' : 'Uptrend Pullback Support'}**\n\n` +
        `#### Key Retracement Support/Resistance Grid:\n` +
        `- **23.6% Level**: \`${fib.r236.toFixed(decimals + 1)}\` (First defense line)\n` +
        `- **38.2% Level**: \`${fib.r382.toFixed(decimals + 1)}\` (Moderate pullback support)\n` +
        `- **50.0% Level**: \`${fib.r500.toFixed(decimals + 1)}\` (Psychological median boundary)\n` +
        `- **61.8% Level**: \`**${fib.r618.toFixed(decimals + 1)}**\` 🚀 (The Golden Ratio Pocket)\n\n` +
        `*Analytical Outlook*: The current price is hovering around **${curPrice.toFixed(decimals + 1)}**. ` +
        `If price pulls back, watch the **61.8% level (${fib.r618.toFixed(decimals + 1)})** closely. It represents the highest statistical probability zone for strong buying/selling bounce confluence.`;
    }

    // 3. EMA & SMA TREND CROSSOVERS
    if (q.includes('crossover') || q.includes('moving average') || q.includes('ma ')) {
      const sma20 = computeSMA(data, 20);
      const ema50 = computeEMA(data, 50);
      const lastSma = sma20[sma20.length - 1];
      const lastEma = ema50[ema50.length - 1];

      if (lastSma === null || lastEma === null) {
        return `⚠️ **Data loading**: Moving average lines are currently computing. Ensure you have loaded enough candlestick ticks on the main board.`;
      }

      const isSmaAboveEma = lastSma > lastEma;
      const smaDist = Math.abs(lastSma - lastEma).toFixed(decimals + 1);

      return `### 📈 Moving Average Alignment Check (SMA 20 vs EMA 50)\n\n` +
        `Current indicator values for **${symbol}** (${timeframe}):\n` +
        `- **Fast SMA (20-period)**: \`${lastSma.toFixed(decimals + 1)}\`\n` +
        `- **Slow EMA (50-period)**: \`${lastEma.toFixed(decimals + 1)}\`\n` +
        `- **Crossover State**: **${isSmaAboveEma ? 'Bullish Alignment (Golden Flow)' : 'Bearish Alignment (Death Flow)'}**\n` +
        `- **Line Separation**: \`${smaDist}\` index units\n\n` +
        `#### Trend Interpretation:\n` +
        `${isSmaAboveEma 
          ? `🟢 **Golden Aligned**: Since SMA 20 sits above EMA 50, intermediate-term momentum supports the uptrend. Any dip toward the **EMA 50 (${lastEma.toFixed(decimals + 1)})** offers a high-probability buying confluence with strong trend-following protection.` 
          : `🔴 **Death Aligned**: Since SMA 20 sits below EMA 50, intermediate sellers control the court. Upward pullbacks toward the **EMA 50 (${lastEma.toFixed(decimals + 1)})** represent key short-selling re-entry points rather than breakout triggers.`
        }\n\n` +
        `*Trade Execution*: Look for candlesticks rejecting the EMA 50 boundary (forming long hammers/shooting stars) to trigger sniper entries in the direction of the dominant crossover trend.`;
    }

    // 4. VOLATILITY ATR REPORT
    if (q.includes('volatility') || q.includes('atr') || q.includes('range')) {
      const atrArr = computeATR(data, 14);
      const lastAtr = atrArr[atrArr.length - 1];

      if (lastAtr === null || lastAtr === undefined) {
        return `⚠️ **Calculation Timeout**: Average True Range requires at least 15 completed candles. Please check back when more live feed data arrives.`;
      }

      // Convert to pips (generally 4 decimals = 1 pip, except JPY pairs where 2 decimals = 1 pip)
      const isJpy = symbol.toLowerCase().includes('jpy');
      const pipMultiplier = isJpy ? 100 : 10000;
      const atrPips = (lastAtr * pipMultiplier).toFixed(1);

      // Determine volatility category
      let volatilityState = 'Normal / Steady';
      if (parseFloat(atrPips) > 25) {
        volatilityState = 'Elevated / High Risk';
      } else if (parseFloat(atrPips) < 8) {
        volatilityState = 'Low / Compression Phase';
      }

      return `### ⚡ Volatility and ATR (Average True Range) Audit\n\n` +
        `- **Active Asset**: **${symbol}** (${timeframe})\n` +
        `- **Current 14-period ATR**: \`${lastAtr.toFixed(decimals + 2)}\` (**${atrPips} pips** equivalent)\n` +
        `- **Volatility State**: **${volatilityState}**\n\n` +
        `#### Multiplier Risk Protection Guide:\n` +
        `- **Suggested Stop Loss Distance**: \`${(lastAtr * 1.5).toFixed(decimals + 1)}\` (**${(parseFloat(atrPips) * 1.5).toFixed(1)} pips** | 1.5x ATR multiplier)\n` +
        `- **Suggested Take Profit Target**: \`${(lastAtr * 3.0).toFixed(decimals + 1)}\` (**${(parseFloat(atrPips) * 3.0).toFixed(1)} pips** | 3.0x ATR multiplier for a healthy 1:2 Risk-Reward ratio)\n\n` +
        `*Strategic Volatility Insight*: ${
          parseFloat(atrPips) < 8 
            ? `⚠️ **Squeeze Alert**: Current ATR is highly compressed. Low volatility environments typically lead to massive, sudden breakout expansions. Avoid tight stop losses as the breakout candle will be highly volatile.` 
            : `✓ **Stable Liquidity**: Volatility is in a healthy trading range. Standard support/resistance rejections are highly reliable here.`
        }`;
    }

    // 5. PROFITABLE PATTERN SCANNER
    if (q.includes('pattern') || q.includes('scan') || q.includes('profitable')) {
      const patterns = detectPatterns(data);
      if (patterns.length === 0) {
        return `🔍 **Candlestick Pattern Scan**: No classic reversal patterns (such as Engulfings, Hammers, Stars, or Dojis) were scanned on the visible chart.\n\n*ApexFX Co-Pilot Suggestion*: Try switching currency pairs or timeframes to scan other active markets for setups!`;
      }

      // Sort by winRate descending
      const sorted = [...patterns].sort((a, b) => (b.winRate || 0) - (a.winRate || 0));
      const topPat = sorted[0];

      return `### 🎯 Scanned Candlestick Formations & Historical Probabilities\n\n` +
        `I have successfully scanned the active candlesticks. A total of **${patterns.length} technical patterns** were flagged.\n\n` +
        `#### Top Scanned Opportunity:\n` +
        `- **Pattern Name**: **${topPat.name}** (${topPat.type.toUpperCase()})\n` +
        `- **Estimated Win Probability**: \`**${topPat.winRate}%**\` 🏆\n` +
        `- **Profit Factor**: \`${topPat.profitFactor}x\`\n` +
        `- **Scanned Candle Index**: \`#${topPat.candlestickIndex}\`\n` +
        `- **Pattern Description**: _${topPat.description}_\n\n` +
        `#### Active Indicator Confluences:\n` +
        `${topPat.indicatorsConfirm 
          ? topPat.indicatorsConfirm.map(ind => `✓ **${ind}** (+Confluence score)`).join('\n')
          : `• No external indicator alignment flagged (Classic formation only).`
        }\n\n` +
        `*Action Plan*: Locate index **#${topPat.candlestickIndex}** on your trading chart using the **eye** button in the scanner panel. Check if volume or nearby support lines confirm entry!`;
    }

    // 6. LOT SIZE AND RISK CALCULATOR (1% Rule)
    if (q.includes('risk') || q.includes('lot size') || q.includes('calculator') || q.includes('1%')) {
      const atrArr = computeATR(data, 14);
      const lastAtr = atrArr[atrArr.length - 1] || 0.0012;
      
      const isJpy = symbol.toLowerCase().includes('jpy');
      const pipMultiplier = isJpy ? 100 : 10000;
      const atrPips = Math.max(5, lastAtr * pipMultiplier);
      const stopLossPips = Math.round(atrPips * 1.5);
      
      // Calculate standard lot size assuming $10,000 account, risking 1% ($100)
      // Standard forex pip value: 1 Standard Lot ($100,000) = $10 per pip for most base pairs.
      // Lot Size = Risk Amount / (SL in Pips * Pip Value of 1 Standard Lot)
      const riskAmount = 100; // 1% of $10,000
      const pipValueStandardLot = 10; // Approx $10/pip
      const standardLotSize = parseFloat((riskAmount / (stopLossPips * pipValueStandardLot)).toFixed(2));
      const miniLotSize = parseFloat((standardLotSize * 10).toFixed(1));
      
      return `### 🛡️ Professional Risk & Lot Sizing Matrix (1% Risk Rule)\n\n` +
        `Calculated for **${symbol}** using an ATR-based dynamic stop loss:\n\n` +
        `- **Assumed Account Equity**: \`$10,000 USD\`\n` +
        `- **Maximum Trade Risk (1%)**: \`$100 USD\`\n` +
        `- **Dynamic Stop Loss Distance**: \`**${stopLossPips} pips**\` (Calculated as 1.5x ATR volatility padding)\n\n` +
        `#### Recommended Sniper Lot Sizes:\n` +
        `- 📦 **Standard Lots**: \`${standardLotSize} Lots\` (Value: $100,000/Lot, $10.00/pip movement)\n` +
        `- ✉ **Mini Lots**: \`${miniLotSize} Mini Lots\` (Value: $10,000/Lot, $1.00/pip movement)\n` +
        `- 🔎 **Micro Lots**: \`${Math.round(standardLotSize * 100)} Micro Lots\` (Value: $1,000/Lot, $0.10/pip movement)\n\n` +
        `#### Recommended Profit Brackets:\n` +
        `- **Conservative Take Profit (1:1.5 RR)**: \`${(stopLossPips * 1.5).toFixed(0)} pips\` reward target (Expected Profit: \`$150\`)\n` +
        `- **Aggressive Take Profit (1:2.0 RR)**: \`${(stopLossPips * 2.0).toFixed(0)} pips\` reward target (Expected Profit: \`$200\`)\n\n` +
        `*Traders Mantra*: Never enter a trade without an active Stop Loss. Lot size is your steering wheel—use it to keep risk strictly bounded to 1%!`;
    }

    // Default response mapping to active indicators
    if (q.includes('rsi') || q.includes('strength')) {
      const rsiArr = computeRSI(data, 14);
      const lastRsi = rsiArr[rsiArr.length - 1];
      if (lastRsi !== null) {
        return `Checking **RSI (Relative Strength Index)** for **${symbol}**:\n\nThe current RSI is reading **${lastRsi.toFixed(2)}**. \n\n- ${
          lastRsi > 70 
            ? '⚠️ **Overbought Territory**: Since RSI sits above 70, the asset is technically overextended. Buyers might see fading liquidity and high rejection risks near local resistance.'
            : lastRsi < 30
            ? '🚀 **Oversold Territory**: With RSI under the 30 boundary, extreme panic-selling has occurred. Expect buyback reactions and value hunters entering.'
            : '⚖️ **Neutral Distribution**: RSI resides in mid-tier territory, suggesting no immediate divergence. The current trend is likely to continue sideways.'
        }`;
      }
    }

    if (q.includes('stop loss') || q.includes('sl') || q.includes('tp') || q.includes('protect')) {
      return `Evaluating protection brackets for **${symbol}**:\n\nBased on ATR volatility multipliers and our active signal metric, here is the suggested configuration:\n\n- **Order Type**: ${activeSignal.type}\n- **Stop Loss (SL)**: \`${activeSignal.sl}\` (${Math.abs(activeSignal.price - activeSignal.sl).toFixed(5)} offset units)\n- **Take Profit (TP)**: \`${activeSignal.tp}\` (${Math.abs(activeSignal.price - activeSignal.tp).toFixed(5)} offset units)\n\n*Rule of thumb*: For Long setups, place your Stop Loss right below the nearest 20-period Simple Moving Average (SMA).`;
    }

    if (q.includes('breakout') || q.includes('support') || q.includes('resistance')) {
      const slice = data.slice(-40);
      const highs = slice.map(c => c.high);
      const lows = slice.map(c => c.low);
      const res = Math.max(...highs);
      const sup = Math.min(...lows);
      return `Analyzing Key Psychological Channels for **${symbol}** (${timeframe}):\n\n- **Major Resistance**: \`${res.toFixed(5)}\` (Local maximum of trailing 40 candles)\n- **Key Support**: \`${sup.toFixed(5)}\` (Local minimum of trailing 40 candles)\n\n*Strategic Outlook*: If price closes above resistance on higher volume, a bullish breakout is confirmed. Conversely, falling below support suggests rapid distribution toward macro levels.`;
    }

    return `According to our indicator consensus for **${symbol}** on the **${timeframe}** chart, the trend direction points toward **${activeSignal.type}**.\n\nHere are the supporting indices:\n\n` +
      activeSignal.rationale.map(r => `- ${r}`).join('\n') + 
      `\n\nLet me know if you would like me to detail moving average crossovers, calculate Fibonacci levels, or trace candlestick shapes!`;
  };

  const handleSendMessage = async (textToSend = inputText, imageToSend: string | null = attachedImage) => {
    if (!textToSend.trim() && !imageToSend) return;

    const userMsgTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      sender: 'user',
      text: textToSend || 'Please analyze this chart snapshot.',
      time: userMsgTime,
      ...(imageToSend ? { image: imageToSend } : {}),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputText('');
    if (onClearAttachedImage) {
      onClearAttachedImage();
    }
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ sender: m.sender, text: m.text, image: m.image })),
          selectedSymbol: symbol,
          selectedTimeframe: timeframe,
          activeSignal,
        }),
      });

      if (!response.ok) {
        throw new Error('API request failed');
      }

      const resData = await response.json();
      if (resData.error) {
        throw new Error(resData.error);
      }

      const aiMsgTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: resData.text,
          time: aiMsgTime,
        }
      ]);
    } catch (err) {
      // Fallback to local rule-based responses if server-side API is unavailable
      const respText = generateResponse(textToSend);
      const aiMsgTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: respText,
          time: aiMsgTime,
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden h-full" id="ai_assistant_component">
      {/* Header */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200">
            AI Co-Pilot Strategist
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>Context: {symbol} ({timeframe})</span>
        </div>
      </div>

      {/* Messages Thread */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5 min-h-[200px] max-h-[300px]">
        {messages.map((msg, idx) => {
          const isAi = msg.sender === 'ai';
          return (
            <div
              key={idx}
              className={`flex gap-2.5 max-w-[90%] ${isAi ? 'mr-auto' : 'ml-auto flex-row-reverse text-right'}`}
            >
              {/* Profile Icon */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white ${
                isAi ? 'bg-emerald-600' : 'bg-blue-600'
              }`}>
                {isAi ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
              </div>

              <div className="space-y-1">
                {msg.image && (
                  <div className="mb-1.5 overflow-hidden rounded-lg border border-zinc-800 max-w-[240px] ml-auto">
                    <img 
                      src={msg.image} 
                      alt="Chart Snapshot" 
                      className="w-full h-auto object-cover rounded-lg" 
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
                <div className={`p-2.5 rounded-lg text-xs leading-relaxed ${
                  isAi ? 'bg-zinc-900 text-zinc-200 rounded-tl-none' : 'bg-blue-950/40 text-blue-100 border border-blue-900/40 rounded-tr-none'
                }`}>
                  {/* Print formatted markdown elements */}
                  {msg.text.split('\n').map((line, lineIdx) => {
                    // Check for headers
                    if (line.startsWith('### ')) {
                      return <h3 key={lineIdx} className="font-bold text-emerald-400 text-xs mt-2.5 mb-1.5 uppercase font-display tracking-wider">{line.replace('### ', '')}</h3>;
                    }
                    if (line.startsWith('#### ')) {
                      return <h4 key={lineIdx} className="font-semibold text-zinc-300 text-[11px] mt-2 mb-1 uppercase font-mono tracking-wide">{line.replace('#### ', '')}</h4>;
                    }

                    return (
                      <p key={lineIdx} className={lineIdx > 0 ? 'mt-1.5' : ''}>
                        {line.split('**').map((chunk, chunkIdx) => 
                          chunkIdx % 2 === 1 ? <strong key={chunkIdx} className="font-bold text-white">{chunk}</strong> : chunk
                        ).map((item, key) => {
                          if (typeof item === 'string') {
                            return item.split('`').map((subchunk, subidx) => 
                              subidx % 2 === 1 ? <code key={subidx} className="bg-zinc-950 border border-zinc-800 text-emerald-400 px-1.5 py-0.5 rounded font-mono text-[10px]">{subchunk}</code> : subchunk
                            );
                          }
                          return item;
                        })}
                      </p>
                    );
                  })}
                </div>
                <div className="text-[9px] text-zinc-500 font-mono tracking-tighter px-1">
                  {msg.time}
                </div>
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="flex gap-2.5 max-w-[80%] mr-auto items-center text-zinc-500">
            <div className="w-6 h-6 rounded-full bg-emerald-600/20 text-emerald-400 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 animate-bounce" />
            </div>
            <div className="bg-zinc-900 px-3 py-2 rounded-lg text-[10px] font-mono tracking-widest uppercase animate-pulse">
              AI Is Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Professional Strategy Templates Library */}
      <div className="bg-zinc-900/40 border-t border-zinc-800/80 p-3">
        <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-zinc-800/40">
          <div className="flex items-center gap-1 text-[10px] uppercase font-mono font-bold text-zinc-400">
            <Compass className="w-3.5 h-3.5 text-emerald-500" />
            <span>AI Strategy Templates</span>
          </div>

          {/* Quick tab filters */}
          <div className="flex bg-zinc-950 p-0.5 rounded border border-zinc-800 font-mono text-[9px]">
            <button
              onClick={() => setActiveCategory('analysis')}
              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                activeCategory === 'analysis' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'
              }`}
            >
              Analysis
            </button>
            <button
              onClick={() => setActiveCategory('trends')}
              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                activeCategory === 'trends' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'
              }`}
            >
              Indicators
            </button>
            <button
              onClick={() => setActiveCategory('risk')}
              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                activeCategory === 'risk' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-500'
              }`}
            >
              Risk
            </button>
          </div>
        </div>

        {/* Templates Buttons Grid */}
        <div className="grid grid-cols-2 gap-1.5 max-h-[105px] overflow-y-auto scrollbar-thin">
          {activeCategory === 'analysis' && (
            <>
              <button
                onClick={() => handleSendMessage('Run a multi-indicator confluence check to find matching confirmation signals.')}
                className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold text-zinc-200">Indicator Confluence</span>
                </div>
                <p className="text-[9px] text-zinc-500 leading-tight">Combine RSI, EMA50 & SMA20 strategy.</p>
              </button>

              <button
                onClick={() => handleSendMessage('Calculate Fibonacci retracement levels from the highest peaks and lowest troughs.')}
                className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold text-zinc-200">Fibonacci Grid</span>
                </div>
                <p className="text-[9px] text-zinc-500 leading-tight">Extract mathematical golden-ratio supports.</p>
              </button>
            </>
          )}

          {activeCategory === 'trends' && (
            <>
              <button
                onClick={() => handleSendMessage('Analyze current Moving Average Crossovers (SMA 20 vs EMA 50) for entry alignment.')}
                className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Activity className="w-3.5 h-3.5 text-yellow-500 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold text-zinc-200">EMA/SMA Crossover</span>
                </div>
                <p className="text-[9px] text-zinc-500 leading-tight">Flag Golden and Death crossovers instantly.</p>
              </button>

              <button
                onClick={() => handleSendMessage('Assess market volatility via ATR (Average True Range) to gauge current trading risk levels.')}
                className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold text-zinc-200">ATR Volatility Scan</span>
                </div>
                <p className="text-[9px] text-zinc-500 leading-tight">Audit current pip range standard volatility.</p>
              </button>
            </>
          )}

          {activeCategory === 'risk' && (
            <>
              <button
                onClick={() => handleSendMessage('Scan for the most profitable candlestick patterns in the active history.')}
                className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Award className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold text-zinc-200">High Probability Scan</span>
                </div>
                <p className="text-[9px] text-zinc-500 leading-tight">List the scanned candlestick shapes.</p>
              </button>

              <button
                onClick={() => handleSendMessage('Calculate recommended lot size and risk-reward ratio assuming a 1% risk on a $10,000 account.')}
                className="p-2 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono rounded-lg cursor-pointer transition-all flex flex-col text-left group"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Calculator className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold text-zinc-200">1% Lot Size Calculator</span>
                </div>
                <p className="text-[9px] text-zinc-500 leading-tight">Forex mathematics & risk control guide.</p>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Attached Image Preview Banner */}
      {attachedImage && (
        <div className="px-3 py-2 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded border border-zinc-700 overflow-hidden bg-zinc-950 shrink-0">
              <img src={attachedImage} alt="Pending snapshot" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">Chart Snapshot Attached</span>
              <span className="text-[9px] text-zinc-500 font-mono">Ready to be analyzed by Co-Pilot</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 font-sans">
            <button
              type="button"
              onClick={() => handleSendMessage('Please run a full visual candle chart analysis on this snapshot.', attachedImage)}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-mono font-bold transition-all cursor-pointer shadow"
            >
              Analyze Snapshot
            </button>
            <button
              type="button"
              onClick={onClearAttachedImage}
              className="p-1 hover:bg-zinc-800 text-zinc-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
              title="Remove snapshot"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="p-3 bg-zinc-900 border-t border-zinc-800 flex gap-2"
      >
        <input
          type="text"
          placeholder="Ask AI Analyst (e.g. 'RSI check', 'Support lines')..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          className="flex-1 bg-zinc-950 text-xs border border-zinc-800 focus:border-zinc-700 outline-none rounded-lg px-3 py-2 text-zinc-200"
        />
        <button
          type="submit"
          className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-3.5 py-2 transition-all flex items-center justify-center cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
