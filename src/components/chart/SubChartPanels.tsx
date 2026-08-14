import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TechnicalIndicatorsState } from '../../types';
import type { ChartTheme, HudData } from '../../types/chart';
import { PAIRS_CONFIG } from '../../utils/forexData';

interface SubChartPanelsProps {
  theme: ChartTheme;
  symbol: string;
  indicators: TechnicalIndicatorsState;
  onToggleIndicator: (key: keyof TechnicalIndicatorsState) => void;
  isRsiMinimized: boolean;
  setIsRsiMinimized: (minimized: boolean) => void;
  isMacdMinimized: boolean;
  setIsMacdMinimized: (minimized: boolean) => void;
  rsiContainerRef: React.RefObject<HTMLDivElement | null>;
  macdContainerRef: React.RefObject<HTMLDivElement | null>;
  isExpandedFullScreen: boolean;
  hudData: HudData | null;
}

const panelHeaderClass = (theme: ChartTheme) =>
  `flex items-center justify-between px-2 py-1 border-b text-[10px] font-mono font-bold uppercase tracking-wider cursor-pointer select-none ${
    theme === 'dark' ? 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-200' : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:text-zinc-800'
  }`;

export const SubChartPanels: React.FC<SubChartPanelsProps> = ({
  theme,
  symbol,
  indicators,
  onToggleIndicator,
  isRsiMinimized,
  setIsRsiMinimized,
  isMacdMinimized,
  setIsMacdMinimized,
  rsiContainerRef,
  macdContainerRef,
  isExpandedFullScreen,
  hudData,
}) => {
  const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
  const precision = config.pipDecimal + 1;

  return (
    <>
      {indicators.rsi && (
        <div className={`${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/70' : 'bg-white border-zinc-200'} border rounded-lg overflow-hidden shadow-md`}>
          <div
            className={panelHeaderClass(theme)}
            onClick={() => setIsRsiMinimized(!isRsiMinimized)}
          >
            <span className="text-rose-400">RSI (14) — Relative Strength Index</span>
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] ${hudData && hudData.rsi !== undefined ? (hudData.rsi > 70 ? 'text-red-400' : hudData.rsi < 30 ? 'text-emerald-400' : 'text-amber-400') : 'text-zinc-600'}`}>
                {hudData && hudData.rsi !== undefined ? hudData.rsi.toFixed(2) : '—'}
              </span>
              {isRsiMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </div>
          {!isRsiMinimized && (
            <div ref={rsiContainerRef} style={{ height: isExpandedFullScreen ? 110 : 100 }} className="w-full" />
          )}
        </div>
      )}

      {indicators.macd && (
        <div className={`${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/70' : 'bg-white border-zinc-200'} border rounded-lg overflow-hidden shadow-md`}>
          <div
            className={panelHeaderClass(theme)}
            onClick={() => setIsMacdMinimized(!isMacdMinimized)}
          >
            <span className="text-blue-400">MACD (12, 26, 9)</span>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500 hidden sm:inline">
                {hudData && hudData.close !== undefined ? hudData.close.toFixed(precision) : '—'}
              </span>
              {isMacdMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </div>
          {!isMacdMinimized && (
            <div ref={macdContainerRef} style={{ height: isExpandedFullScreen ? 110 : 100 }} className="w-full" />
          )}
        </div>
      )}
    </>
  );
};
