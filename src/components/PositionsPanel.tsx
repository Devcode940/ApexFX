import React, { useState, useEffect } from 'react';
import { TradePosition, TradingSignal, ClosedTrade } from '../types';
import { DollarSign, Trash2, TrendingUp, TrendingDown, ClipboardList, ShoppingCart, PlusCircle, AlertCircle, History, Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { formatPrice } from '../utils/forexData';

import { useTrading } from '../context/TradingContext';

interface PositionsPanelProps {}

export const PositionsPanel: React.FC<PositionsPanelProps> = () => {
  const {
    positions,
    closedTrades,
    handleClearHistory: onClearHistory,
    selectedSymbol,
    currentPrice,
    activeSignal,
    handleOpenPosition: onOpenPosition,
    handleClosePosition: onClosePosition,
  } = useTrading();
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions');
  const [amount, setAmount] = useState<number>(0.1); // lot size
  const [useSltp, setUseSltp] = useState<boolean>(true);
  const [customSl, setCustomSl] = useState<string>('');
  const [customTp, setCustomTp] = useState<string>('');
  const [errorText, setErrorText] = useState<string>('');
  const [pnlHistory, setPnlHistory] = useState<{ time: string; date: string; fullTime: string; pnl: number }[]>([]);

  // --- Closed Trades History Pagination ---
  const [historyPage, setHistoryPage] = useState<number>(1);
  const [historyPageSize, setHistoryPageSize] = useState<number>(4);
  const totalPages = Math.ceil(closedTrades.length / historyPageSize);
  const paginatedClosedTrades = closedTrades.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize
  );

  useEffect(() => {
    if (historyPage > totalPages && totalPages > 0) {
      setHistoryPage(totalPages);
    }
  }, [closedTrades, totalPages, historyPage]);

  // --- Position Size Calculator State ---
  const [showCalculator, setShowCalculator] = useState<boolean>(false);
  const [balance, setBalance] = useState<number>(() => {
    const cached = localStorage.getItem('forexinsight_calc_balance');
    const parsed = cached ? parseFloat(cached) : NaN;
    return !isNaN(parsed) ? parsed : 10000;
  });
  const [riskPercent, setRiskPercent] = useState<number>(() => {
    const cached = localStorage.getItem('forexinsight_calc_risk_percent');
    const parsed = cached ? parseFloat(cached) : NaN;
    return !isNaN(parsed) ? parsed : 1.0;
  });
  const [manualSlPips, setManualSlPips] = useState<number>(() => {
    const cached = localStorage.getItem('forexinsight_calc_manual_sl_pips');
    const parsed = cached ? parseInt(cached) : NaN;
    return !isNaN(parsed) ? parsed : 50;
  });

  // --- Sync Calculator settings to LocalStorage ---
  useEffect(() => {
    localStorage.setItem('forexinsight_calc_balance', balance.toString());
  }, [balance]);

  useEffect(() => {
    localStorage.setItem('forexinsight_calc_risk_percent', riskPercent.toString());
  }, [riskPercent]);

  useEffect(() => {
    localStorage.setItem('forexinsight_calc_manual_sl_pips', manualSlPips.toString());
  }, [manualSlPips]);

  const getPipMultiplier = (symbol: string) => {
    if (symbol.includes('JPY')) return 100;
    if (symbol.includes('XAG')) return 1000;
    if (symbol.includes('XAU')) return 100;
    return 10000;
  };

  const getPipValueStandardLot = (symbol: string) => {
    if (symbol.includes('XAU')) return 1.0;
    if (symbol.includes('XAG')) return 5.0;
    if (symbol.includes('JPY')) return 6.5;
    return 10.0;
  };

  const getActiveSlPips = () => {
    if (useSltp) {
      const slParsed = parseFloat(customSl);
      const activeSl = !isNaN(slParsed) && slParsed > 0 ? slParsed : activeSignal.sl;
      if (activeSl > 0) {
        const multiplier = getPipMultiplier(selectedSymbol);
        const diff = Math.abs(currentPrice - activeSl);
        const calculatedPips = Math.round(diff * multiplier);
        if (calculatedPips > 0) {
          return { pips: calculatedPips, isAuto: true };
        }
      }
    }
    return { pips: manualSlPips, isAuto: false };
  };

  const activeSlInfo = getActiveSlPips();
  const riskAmount = (balance * riskPercent) / 100;
  const pipValue = getPipValueStandardLot(selectedSymbol);
  const suggestedLotSizeRaw = activeSlInfo.pips > 0 ? (riskAmount / (activeSlInfo.pips * pipValue)) : 0.1;
  const suggestedLotSize = parseFloat(Math.max(0.01, Math.min(100.0, suggestedLotSizeRaw)).toFixed(2));

  useEffect(() => {
    if (positions.length === 0) {
      setPnlHistory((prev) => prev.length === 0 ? prev : []);
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const fullTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const currentTotal = parseFloat(positions.reduce((acc, pos) => acc + pos.pnl, 0).toFixed(2));

    setPnlHistory((prev) => {
      const lastItem = prev[prev.length - 1];
      if (lastItem && lastItem.pnl === currentTotal) {
        return prev;
      }
      const nextHistory = [...prev, { time: timeStr, date: dateStr, fullTime: fullTimeStr, pnl: currentTotal }];
      if (nextHistory.length > 20) {
        nextHistory.shift();
      }
      return nextHistory;
    });
  }, [positions]);

  const isJPY = selectedSymbol.includes('JPY');
  const pipDecimal = isJPY ? 2 : 4;

  const handleOpenMarketOrder = (type: 'BUY' | 'SELL') => {
    setErrorText('');

    if (amount <= 0) {
      setErrorText('Lot size must be greater than 0.');
      return;
    }

    let slValue: number | undefined = undefined;
    let tpValue: number | undefined = undefined;

    if (useSltp) {
      // Parse custom inputs or default to the current active signal recommendation
      const slParsed = parseFloat(customSl);
      const tpParsed = parseFloat(customTp);

      slValue = !isNaN(slParsed) && slParsed > 0 ? slParsed : activeSignal.sl;
      tpValue = !isNaN(tpParsed) && tpParsed > 0 ? tpParsed : activeSignal.tp;

      // Simple validation sanity check
      if (type === 'BUY') {
        if (slValue && slValue >= currentPrice) {
          setErrorText('Buy Stop Loss must be under market price.');
          return;
        }
        if (tpValue && tpValue <= currentPrice) {
          setErrorText('Buy Take Profit must be above market price.');
          return;
        }
      } else {
        if (slValue && slValue <= currentPrice) {
          setErrorText('Sell Stop Loss must be above market price.');
          return;
        }
        if (tpValue && tpValue >= currentPrice) {
          setErrorText('Sell Take Profit must be under market price.');
          return;
        }
      }
    }

    onOpenPosition(type, amount, slValue, tpValue);
    
    // Clear inputs
    setCustomSl('');
    setCustomTp('');
  };

  // Pre-fill fields with signal suggestions
  const handleAutoFill = () => {
    setCustomSl(activeSignal.sl.toString());
    setCustomTp(activeSignal.tp.toString());
    setUseSltp(true);
    setErrorText('');
  };

  const totalPnL = positions.reduce((acc, pos) => acc + pos.pnl, 0);

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden h-full" id="positions_component">
      {/* Header */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-emerald-400" />
          <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200">
            Paper Trading Terminal
          </h2>
        </div>
        <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
          totalPnL >= 0 ? 'bg-emerald-950/40 text-emerald-400' : 'bg-red-950/40 text-red-500'
        }`}>
          PnL: {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
        </span>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-4">
        {/* Instant Market Order execution card */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-zinc-300">Market Execution ticket ({selectedSymbol})</span>
            <span className="text-xs font-mono text-zinc-400">Price: {currentPrice.toFixed(isJPY ? 3 : 5)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-zinc-400 font-mono uppercase mb-1">Volume (Lots)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="10.0"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full bg-zinc-950 text-xs font-mono border border-zinc-800 focus:border-zinc-700 outline-none rounded p-2 text-zinc-200 font-medium"
              />
            </div>

            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={handleAutoFill}
                disabled={activeSignal.type === 'NEUTRAL'}
                className="w-full py-2 px-1.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:text-white rounded text-[10px] font-mono tracking-tight uppercase transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Fill AI Indicators
              </button>
            </div>
          </div>

          {/* SL / TP toggle selection */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                id="use-sltp-checkbox"
                type="checkbox"
                checked={useSltp}
                onChange={(e) => setUseSltp(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-zinc-950 border-zinc-800 text-emerald-500 focus:ring-opacity-0 outline-none accent-emerald-500 cursor-pointer"
              />
              <label htmlFor="use-sltp-checkbox" className="text-[11px] text-zinc-300 select-none cursor-pointer">
                Attach protective SL &amp; TP limits
              </label>
            </div>

            {useSltp && (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-[9px] text-zinc-500 font-mono uppercase block mb-1">Stop Loss (SL)</span>
                  <input
                    type="text"
                    placeholder={`e.g. ${activeSignal.sl}`}
                    value={customSl}
                    onChange={(e) => setCustomSl(e.target.value)}
                    className="w-full bg-zinc-950 text-xs font-mono border border-zinc-800 outline-none rounded p-1.5 text-zinc-200"
                  />
                </div>
                <div>
                  <span className="text-[9px] text-zinc-500 font-mono uppercase block mb-1">Take Profit (TP)</span>
                  <input
                    type="text"
                    placeholder={`e.g. ${activeSignal.tp}`}
                    value={customTp}
                    onChange={(e) => setCustomTp(e.target.value)}
                    className="w-full bg-zinc-950 text-xs font-mono border border-zinc-800 outline-none rounded p-1.5 text-zinc-200"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Position Size Calculator Toggle Header */}
          <div className="pt-1.5 border-t border-zinc-800/40" id="pos_size_calculator">
            <button
              type="button"
              onClick={() => setShowCalculator(!showCalculator)}
              className="w-full flex items-center justify-between text-[11px] font-mono font-bold uppercase text-zinc-400 hover:text-zinc-200 py-1 transition-colors cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>Risk &amp; Position Size Calculator</span>
              </div>
              {showCalculator ? (
                <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              )}
            </button>

            {showCalculator && (
              <div className="mt-2.5 p-3 bg-zinc-950/80 border border-zinc-800/80 rounded-lg space-y-3.5 text-xs">
                {/* Inputs Row */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <span className="text-[9px] text-zinc-500 font-mono uppercase block mb-1">Account Balance ($)</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1.5 text-zinc-500 font-mono text-[11px]">$</span>
                      <input
                        type="number"
                        min="1"
                        step="1000"
                        value={balance}
                        onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                        className="w-full bg-zinc-900 text-xs font-mono border border-zinc-800 outline-none rounded p-1.5 pl-[18px] text-zinc-200"
                      />
                    </div>
                    {/* Quick presets for balance */}
                    <div className="flex gap-1 mt-1 justify-between">
                      {[10000, 50000, 100000].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setBalance(val)}
                          className="text-[8px] font-mono text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-800/50 rounded px-1 py-0.5 cursor-pointer"
                        >
                          ${val / 1000}k
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[9px] text-zinc-500 font-mono uppercase block mb-1">Risk per Trade (%)</span>
                    <input
                      type="number"
                      min="0.1"
                      max="100"
                      step="0.5"
                      value={riskPercent}
                      onChange={(e) => setRiskPercent(parseFloat(e.target.value) || 0)}
                      className="w-full bg-zinc-900 text-xs font-mono border border-zinc-800 outline-none rounded p-1.5 text-zinc-200"
                    />
                    {/* Quick presets for risk */}
                    <div className="flex gap-1 mt-1 justify-between">
                      {[0.5, 1.0, 2.0, 3.0].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setRiskPercent(val)}
                          className="text-[8px] font-mono text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-800/50 rounded px-1 py-0.5 cursor-pointer"
                        >
                          {val}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Stop Loss Distance Info / Input */}
                <div className="bg-zinc-900/40 p-2 rounded border border-zinc-800/40 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-500">Stop Loss Distance:</span>
                    <span className={`font-semibold ${activeSlInfo.isAuto ? 'text-amber-400' : 'text-zinc-300'}`}>
                      {activeSlInfo.pips} Pips {activeSlInfo.isAuto ? '(Auto-Sync)' : '(Manual)'}
                    </span>
                  </div>

                  {!activeSlInfo.isAuto && (
                    <div className="space-y-1">
                      <span className="text-[9px] text-zinc-500 font-mono uppercase block">Manual SL (Pips)</span>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={manualSlPips}
                        onChange={(e) => setManualSlPips(parseInt(e.target.value) || 0)}
                        className="w-full bg-zinc-900 text-xs font-mono border border-zinc-800 outline-none rounded p-1.5 text-zinc-200"
                      />
                    </div>
                  )}

                  {activeSlInfo.isAuto && (
                    <p className="text-[9px] text-zinc-500 italic leading-snug">
                      Pips are automatically calculated based on your active Stop Loss target above. Turn off SL protection to enter pips manually.
                    </p>
                  )}
                </div>

                {/* Suggested Output Summary */}
                <div className="bg-zinc-900 border border-zinc-800 p-2.5 rounded-lg flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-zinc-500 font-mono uppercase block">Suggested Lot Size</span>
                    <span className="text-sm font-mono font-extrabold text-amber-400">
                      {suggestedLotSize} Lots
                    </span>
                    <p className="text-[9px] text-zinc-500">
                      Risk: <span className="text-red-400 font-medium">${riskAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> ({riskPercent}%)
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAmount(suggestedLotSize);
                      setErrorText('');
                    }}
                    className="py-1.5 px-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded text-[10px] font-mono uppercase tracking-tight transition-colors cursor-pointer"
                  >
                    Apply to Ticket
                  </button>
                </div>
              </div>
            )}
          </div>

          {errorText && (
            <div className="flex items-center gap-1.5 text-[11px] text-red-500 bg-red-950/20 px-2.5 py-1.5 rounded border border-red-900/30">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errorText}</span>
            </div>
          )}

          {/* Execute buttons */}
          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <button
              onClick={() => handleOpenMarketOrder('BUY')}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded py-2 transition-colors cursor-pointer flex items-center justify-center gap-1.5 uppercase font-display"
            >
              <TrendingUp className="w-4 h-4" />
              Buy / Long
            </button>
            <button
              onClick={() => handleOpenMarketOrder('SELL')}
              className="bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded py-2 transition-colors cursor-pointer flex items-center justify-center gap-1.5 uppercase font-display"
            >
              <TrendingDown className="w-4 h-4" />
              Sell / Short
            </button>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex border border-zinc-800/80 p-0.5 bg-zinc-950/45 rounded-lg">
          <button
            onClick={() => setActiveTab('positions')}
            className={`flex-1 py-1 text-[11px] font-mono font-bold uppercase rounded transition-all cursor-pointer ${
              activeTab === 'positions'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm shadow-black/20'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Active ({positions.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-1 text-[11px] font-mono font-bold uppercase rounded transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm shadow-black/20'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            History ({closedTrades.length})
          </button>
        </div>

        {activeTab === 'positions' ? (
          <>
            {/* Positions list ledger */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 border-b border-zinc-800/60 pb-1.5">
                <ClipboardList className="w-3.5 h-3.5 text-zinc-500" />
                Open Trades Ledger ({positions.length})
              </div>

              {positions.length === 0 ? (
                <div className="text-center py-6 text-zinc-500 text-xs border border-dashed border-zinc-800/60 rounded-lg">
                  No active trades. Place long or short orders above.
                </div>
              ) : (
                <div className="space-y-2 max-h-[190px] overflow-y-auto">
                  {positions.map((pos) => {
                    const isBuy = pos.type === 'BUY';
                    const isGain = pos.pnl >= 0;
                    
                    return (
                      <div
                        key={pos.id}
                        className="p-3 bg-zinc-900/30 rounded border border-zinc-800/60 flex items-center justify-between text-xs hover:border-zinc-700/60 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] uppercase font-bold px-1.5 rounded ${
                              isBuy ? 'bg-emerald-950 text-emerald-400 border border-emerald-900/40' : 'bg-rose-950 text-rose-400 border border-rose-900/40'
                            }`}>
                              {pos.type}
                            </span>
                            <span className="font-mono font-semibold text-zinc-200">
                              {pos.symbol.slice(0, 3)}/{pos.symbol.slice(3)}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              {pos.amount.toFixed(1)} lots
                            </span>
                          </div>
                          
                          <div className="text-[10px] text-zinc-400 font-mono">
                            Entry: {formatPrice(pos.entryPrice, pos.symbol)}
                          </div>

                          {(pos.sl || pos.tp) && (
                            <div className="text-[9px] text-zinc-500 font-mono flex gap-2">
                              {pos.sl && <span>SL: {formatPrice(pos.sl, pos.symbol)}</span>}
                              {pos.tp && <span>TP: {formatPrice(pos.tp, pos.symbol)}</span>}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className={`font-mono font-bold text-sm leading-none ${
                              isGain ? 'text-emerald-400' : 'text-rose-500'
                            }`}>
                              {isGain ? '+' : ''}${pos.pnl.toFixed(2)}
                            </div>
                            <span className="text-[9px] text-zinc-500 font-mono leading-none">
                              Unrealized PnL
                            </span>
                          </div>

                          <button
                            onClick={() => onClosePosition(pos.id)}
                            className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors cursor-pointer"
                            title="Close Position"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Real-time PnL Equity Curve Area Chart */}
            <div className="pt-3 border-t border-zinc-800/60 space-y-2" id="pnl_performance_tracker">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Real-time Equity Curve (PnL)</span>
                </div>
                {positions.length > 0 && (
                  <span className={`text-[10px] font-mono font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                    {totalPnL >= 0 ? '🟢 NET PROFIT' : '🔴 DRAWDOWN'}
                  </span>
                )}
              </div>

              {positions.length === 0 ? (
                <div className="h-[100px] flex items-center justify-center border border-dashed border-zinc-800/50 rounded-lg text-[10px] font-mono text-zinc-500 bg-zinc-900/10">
                  Awaiting active positions for live equity line...
                </div>
              ) : (
                <div className="h-[100px] w-full rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pnlHistory} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="pnlColorGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={totalPnL >= 0 ? '#10b981' : '#f43f5e'} stopOpacity={0.25}/>
                          <stop offset="95%" stopColor={totalPnL >= 0 ? '#10b981' : '#f43f5e'} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis 
                        dataKey="time" 
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#71717a', fontSize: 8, fontFamily: 'monospace' }}
                      />
                      <YAxis 
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#71717a', fontSize: 8, fontFamily: 'monospace' }}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const value = payload[0].value as number;
                            const date = payload[0].payload.date || new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                            const fullTime = payload[0].payload.fullTime || payload[0].payload.time;
                            const isPositive = value >= 0;
                            return (
                              <div className="bg-zinc-900/95 backdrop-blur-sm border border-zinc-800/80 px-3 py-2 rounded-lg shadow-xl text-[10px] font-mono select-none pointer-events-none min-w-[130px] flex flex-col gap-1">
                                <div className="text-[9px] text-zinc-400 font-bold border-b border-zinc-800/60 pb-1 leading-none">
                                  {date}
                                </div>
                                <div className="flex items-center justify-between gap-3 text-[9px] text-zinc-500">
                                  <span>Time:</span>
                                  <span className="text-zinc-300 font-medium">{fullTime}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 font-semibold mt-0.5">
                                  <span className="text-zinc-400">Net PnL:</span>
                                  <span className={isPositive ? 'text-emerald-400' : 'text-rose-400'}>
                                    {isPositive ? '+' : ''}${value.toFixed(2)}
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <ReferenceLine y={0} stroke="#27272a" strokeDasharray="3 3" />
                      <Area 
                        type="monotone" 
                        dataKey="pnl" 
                        stroke={totalPnL >= 0 ? '#10b981' : '#f43f5e'} 
                        strokeWidth={1.5}
                        fillOpacity={1} 
                        fill="url(#pnlColorGrad)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
              <div className="flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-zinc-500" />
                <span>Closed Trades Ledger</span>
              </div>
              {closedTrades.length > 0 && onClearHistory && (
                <button
                  onClick={onClearHistory}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-tight font-bold cursor-pointer transition-all"
                >
                  Clear Logs
                </button>
              )}
            </div>

            {closedTrades.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-xs border border-dashed border-zinc-800/60 rounded-lg font-mono">
                No closed trades yet.
              </div>
            ) : (
              <div>
                <div className="space-y-2 max-h-[290px] overflow-y-auto pr-0.5 mb-2">
                  {paginatedClosedTrades.map((trade) => {
                    const isGain = trade.pnl >= 0;
                    const isBuy = trade.type === 'BUY';
                    return (
                      <div
                        key={trade.id}
                        className="p-3 bg-zinc-900/40 rounded border border-zinc-800/60 flex items-center justify-between text-xs hover:border-zinc-700/60 transition-colors font-mono"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9px] uppercase font-bold px-1.5 rounded ${
                              isBuy ? 'bg-emerald-950 text-emerald-400 border border-emerald-900/40' : 'bg-rose-950 text-rose-400 border border-rose-900/40'
                            }`}>
                              {trade.type}
                            </span>
                            <span className="font-sans font-semibold text-zinc-200">
                              {trade.symbol.slice(0, 3)}/{trade.symbol.slice(3)}
                            </span>
                            <span className="text-[9px] text-zinc-500">
                              {trade.amount.toFixed(1)}L
                            </span>
                          </div>

                          <div className="text-[10px] text-zinc-400 leading-tight">
                            Entry: <span className="text-zinc-300">{formatPrice(trade.entryPrice, trade.symbol)}</span>
                            <br />
                            Exit: <span className="text-zinc-300">{formatPrice(trade.exitPrice, trade.symbol)}</span>
                          </div>

                          <div className="text-[8px] text-zinc-500 flex items-center gap-1.5">
                            <span>{trade.time}</span>
                            <span>•</span>
                            <span className={`uppercase font-bold ${
                              trade.closeReason === 'Manual' ? 'text-zinc-400' :
                              trade.closeReason === 'SL Hit' ? 'text-rose-400' : 'text-emerald-400'
                            }`}>
                              {trade.closeReason}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className={`font-bold text-sm leading-none ${
                            isGain ? 'text-emerald-400' : 'text-rose-500'
                          }`}>
                            {isGain ? '+' : ''}${trade.pnl.toFixed(2)}
                          </div>
                          <span className="text-[9px] text-zinc-500 block mt-1">
                            Realized PnL
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {closedTrades.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-zinc-850 pt-2.5 mt-2">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-500">Show:</span>
                        {[4, 8, 12].map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => {
                              setHistoryPageSize(size);
                              setHistoryPage(1);
                            }}
                            className={`px-1.5 py-0.5 rounded transition-all cursor-pointer font-bold ${
                              historyPageSize === size
                                ? 'bg-zinc-855 bg-emerald-600/20 text-emerald-400 border border-emerald-900/30'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>

                      {totalPages > 1 && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                            disabled={historyPage === 1}
                            className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer hover:bg-zinc-850"
                          >
                            Prev
                          </button>
                          <span className="text-zinc-400 font-semibold">
                            Page {historyPage} of {totalPages}
                          </span>
                          <button
                            type="button"
                            onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
                            disabled={historyPage === totalPages}
                            className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer hover:bg-zinc-850"
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
