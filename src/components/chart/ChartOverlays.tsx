import React from 'react';
import { motion } from 'motion/react';
import { Zap, Sparkles } from 'lucide-react';
import type { Timeframe } from '../../types';
import {
  FOREX_SESSIONS,
  ForexSessionKey,
  isSessionActiveAtTime,
  getSessionLocalHoursString,
  getLocalTimezoneName,
  SessionBlock,
} from '../../utils/forexSessions';
import type { AnimatedTrade, ChartTheme, DrawingsState, HudData } from '../../types/chart';
import { PAIRS_CONFIG } from '../../utils/forexData';

export interface PriceStreak {
  count: number;
  type: 'bullish' | 'bearish' | 'neutral';
}

interface ChartOverlaysProps {
  theme: ChartTheme;
  symbol: string;
  timeframe: Timeframe;
  sessionBlocks: SessionBlock[];
  showSessionShading: boolean;
  enabledSessions: Record<ForexSessionKey, boolean>;
  priceStreak: PriceStreak;
  drawings: DrawingsState;
  showTradeAnimations: boolean;
  symbolTradesToAnimate: AnimatedTrade[];
  showPatternBeams: boolean;
  hudData: HudData | null;
}

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const ChartOverlays: React.FC<ChartOverlaysProps> = ({
  theme,
  symbol,
  timeframe,
  sessionBlocks,
  showSessionShading,
  enabledSessions,
  priceStreak,
  drawings,
  showTradeAnimations,
  symbolTradesToAnimate,
  showPatternBeams,
  hudData,
}) => {
  const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
  const precision = config.pipDecimal + 1;
  const pipsPrecision = config.pipDecimal;

  return (
    <>
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
        {FOREX_SESSIONS.filter((s) => enabledSessions[s.key] && isSessionActiveAtTime(s, Math.floor(Date.now() / 1000))).map((activeSess) => (
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
        {(drawings.riskRewards || []).map((tool) => (
          <div
            key={tool.id}
            id={`rr-tool-${tool.id}`}
            className="absolute pointer-events-none"
            style={{ width: '120px', display: 'none' }}
          >
            {/* Profit Zone */}
            <div
              className="absolute w-full bg-emerald-500/20"
              style={{
                top: 'var(--profit-top)',
                height: 'var(--profit-height)',
                borderTop: tool.type === 'long' ? '1px solid rgba(16, 185, 129, 0.6)' : 'none',
                borderBottom: tool.type === 'short' ? '1px solid rgba(16, 185, 129, 0.6)' : 'none',
              }}
            >
              <div className={`text-[10px] text-emerald-400 px-1 font-mono font-medium leading-none absolute ${tool.type === 'long' ? 'top-0.5' : 'bottom-0.5'}`}>
                TP {tool.tp.toFixed(precision)}
              </div>
            </div>

            {/* Loss Zone */}
            <div
              className="absolute w-full bg-red-500/20"
              style={{
                top: 'var(--loss-top)',
                height: 'var(--loss-height)',
                borderBottom: tool.type === 'long' ? '1px solid rgba(239, 68, 68, 0.6)' : 'none',
                borderTop: tool.type === 'short' ? '1px solid rgba(239, 68, 68, 0.6)' : 'none',
              }}
            >
              <div className={`text-[10px] text-red-400 px-1 font-mono font-medium leading-none absolute ${tool.type === 'long' ? 'bottom-0.5' : 'top-0.5'}`}>
                SL {tool.sl.toFixed(precision)}
              </div>
            </div>

            {/* Entry Line */}
            <div className="absolute w-full border-t border-zinc-400/80 z-20" style={{ top: 'var(--entry-y)' }}>
              <div className="text-[10px] text-zinc-300 font-mono pl-1 -mt-3 drop-shadow-md">Entry</div>
            </div>
          </div>
        ))}

        {(drawings.fibonacci || []).map((tool) => {
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

              {FIB_RATIOS.map((ratio) => {
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
                      opacity: 0.8,
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
                        @{trade.entryPrice.toFixed(pipsPrecision)}
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
                          title={`Trade Exit @ ${(trade.exitPrice || trade.entryPrice).toFixed(pipsPrecision)}`}
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
            <span className="flex gap-1.5"><span className="text-zinc-500">O</span><span className={`font-semibold ${hudData.open > hudData.close ? 'text-red-500' : 'text-emerald-500'}`}>{hudData.open.toFixed(precision)}</span></span>
            <span className="flex gap-1.5"><span className="text-zinc-500">H</span><span className={`font-semibold ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>{hudData.high.toFixed(precision)}</span></span>
            <span className="flex gap-1.5"><span className="text-zinc-500">L</span><span className={`font-semibold ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>{hudData.low.toFixed(precision)}</span></span>
            <span className="flex gap-1.5"><span className="text-zinc-500">C</span><span className={`font-semibold ${hudData.close >= hudData.open ? 'text-emerald-500' : 'text-red-500'}`}>{hudData.close.toFixed(precision)}</span></span>
          </div>

          {/* Indicator Values */}
          {(hudData.sma !== undefined || hudData.ema !== undefined || hudData.bbUpper !== undefined || hudData.rsi !== undefined) && (
            <div className={`flex flex-col gap-0.5 mt-1 pt-1 border-t ${theme === 'dark' ? 'border-zinc-800/50' : 'border-zinc-200'}`}>
              {hudData.sma !== undefined && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">SMA(20)</span>
                  <span className="text-blue-400 font-semibold">{hudData.sma.toFixed(precision)}</span>
                </div>
              )}
              {hudData.ema !== undefined && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">EMA(50)</span>
                  <span className="text-yellow-400 font-semibold">{hudData.ema.toFixed(precision)}</span>
                </div>
              )}
              {hudData.bbUpper !== undefined && hudData.bbLower !== undefined && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">BB(20,2)</span>
                  <span className="text-purple-400 font-semibold">{hudData.bbUpper.toFixed(precision)} / {hudData.bbLower.toFixed(precision)}</span>
                </div>
              )}
              {hudData.rsi !== undefined && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">RSI(14)</span>
                  <span className={`font-semibold ${hudData.rsi > 70 ? 'text-red-400' : hudData.rsi < 30 ? 'text-emerald-400' : 'text-zinc-300'}`}>
                    {hudData.rsi.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
