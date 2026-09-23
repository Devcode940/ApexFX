import React, { useState, useEffect } from 'react';
import { Trash2, TrendingUp, TrendingDown, ClipboardList, ShoppingCart, PlusCircle, AlertCircle, History, Calculator, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { formatPrice } from '../utils/forexData';
import { MAX_LOTS, ORDER_REJECTION_TEXT, validateOrder } from '../utils/paperTrading';
import { levelToPips, pipValueUsd, priceOf, usdJpyFrom, usdPerQuoteRate } from '../utils/pips';

import { useTrading } from '../context/TradingContext';

import { hasAccountPnl, formatPnl } from '../utils/money';
import { downloadTradesCsv } from '../utils/csv';
import { isExecutableQuote, quoteQuality } from '../../shared/market';
import { PerformanceDashboard } from './PerformanceDashboard';

function safePreference(key: string) { try { return localStorage.getItem(key); } catch { return null; } }

export const PositionsPanel: React.FC = () => {
  const {
    positions,
    closedTrades,
    handleClearHistory: onClearHistory,
    selectedSymbol,
    currentPrice,
    activeSignal,
    handleOpenPosition: onOpenPosition,
    handleClosePosition: onClosePosition,
    watchlistItems,
    canTrade,
    storageError,
    account,
    historyMeta,
    liveQuote,
  } = useTrading();
  const [activeTab, setActiveTab] = useState<'positions' | 'history' | 'analytics'>('positions');
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
    const cached = safePreference('forexinsight_calc_balance');
    const parsed = cached ? parseFloat(cached) : NaN;
    return !isNaN(parsed) ? parsed : 10000;
  });
  const [riskPercent, setRiskPercent] = useState<number>(() => {
    const cached = safePreference('forexinsight_calc_risk_percent');
    const parsed = cached ? parseFloat(cached) : NaN;
    return !isNaN(parsed) ? parsed : 1.0;
  });
  const [manualSlPips, setManualSlPips] = useState<number>(() => {
    const cached = safePreference('forexinsight_calc_manual_sl_pips');
    const parsed = cached ? parseInt(cached) : NaN;
    return !isNaN(parsed) ? parsed : 50;
  });

  // --- Sync Calculator settings to LocalStorage ---
  useEffect(() => {
    try { localStorage.setItem('forexinsight_calc_balance', balance.toString()); } catch { /* non-critical preference */ }
  }, [balance]);

  useEffect(() => {
    try { localStorage.setItem('forexinsight_calc_risk_percent', riskPercent.toString()); } catch { /* non-critical preference */ }
  }, [riskPercent]);

  useEffect(() => {
    try { localStorage.setItem('forexinsight_calc_manual_sl_pips', manualSlPips.toString()); } catch { /* non-critical preference */ }
  }, [manualSlPips]);

  // Pip size and pip value now come from utils/pips, which derives both from PAIRS_CONFIG +
  // CONTRACT_SIZE. They used to be two hand-written tables in this file (a multiplier of
  // 100/10000 and a per-lot value of 1.0/5.0/6.5/10.0) which disagreed with each other for silver:
  // pips were counted at 0.0001 while a pip was valued at $5 (the 0.001-pip convention), so the
  // risk sizing below under-sized XAG positions by 10x. Changing the convention in ONE place
  // (PAIRS_CONFIG.pipDecimal) now changes both consistently.
  const freshQuotes = watchlistItems.filter(q => isExecutableQuote(q));
  const usdJpy = usdJpyFrom(freshQuotes);
  const usdPerQuote = usdPerQuoteRate(selectedSymbol, priceOf(selectedSymbol, freshQuotes), usdJpy);

  /**
   * Levels to inherit from the signal when the operator left the inputs empty.
   *
   * A NEUTRAL signal is not "a signal with no direction", it is the placeholder the scanner returns
   * while there is no data: generateSignal() sets sl/tp to `currentPrice`, which for an empty chart is
   * `data[data.length - 1]?.close || 1.0` — i.e. 1.0 for EUR/USD. Inheriting those produced two bad
   * states: a position whose exits sit exactly on the entry (which the validator now rejects, so the
   * order died with a confusing message), and — before that — one that silently could never trigger.
   * The panel already refused to *auto-fill* a NEUTRAL signal; the fallback path just never got the memo.
   */
  const usableLevels = activeSignal && activeSignal.type !== 'NEUTRAL' && historyMeta?.instrumentKind === liveQuote?.instrumentKind && historyMeta?.provider === liveQuote?.source && historyMeta?.providerSymbol === liveQuote?.providerSymbol && canTrade;
  const suggestedSl = usableLevels && activeSignal.sl > 0 ? activeSignal.sl : undefined;
  const suggestedTp = usableLevels && activeSignal.tp > 0 ? activeSignal.tp : undefined;

  const getActiveSlPips = () => {
    if (useSltp) {
      const slParsed = parseFloat(customSl);
      const activeSl = !isNaN(slParsed) && slParsed > 0 ? slParsed : (suggestedSl ?? 0);
      if (activeSl > 0) {
        const calculatedPips = levelToPips(selectedSymbol, currentPrice, activeSl);
        if (calculatedPips > 0) {
          return { pips: calculatedPips, isAuto: true };
        }
      }
    }
    return { pips: manualSlPips, isAuto: false };
  };

  const activeSlInfo = getActiveSlPips();
  const riskAmount = (balance * riskPercent) / 100;
  // Only fresh conversion quotes may produce a USD risk/lot-size suggestion.
  const pipValue = pipValueUsd(selectedSymbol, 1, { usdPerQuote });
  const suggestedLotSizeRaw = activeSlInfo.pips > 0 && pipValue !== null ? (riskAmount / (activeSlInfo.pips * pipValue)) : 0;
  const suggestedLotSize = Number.isFinite(suggestedLotSizeRaw) && suggestedLotSizeRaw >= 0.01 ? Math.floor(Math.min(MAX_LOTS, suggestedLotSizeRaw) * 100) / 100 : null;

  useEffect(() => {
    if (positions.length === 0) {
      setPnlHistory((prev) => prev.length === 0 ? prev : []);
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const fullTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    if (positions.some(p => !hasAccountPnl(p))) return; // no unknown mark/FX coerced into an equity sample
    const currentTotal = parseFloat(positions.filter(hasAccountPnl).reduce((acc, pos) => acc + pos.pnl, 0).toFixed(2));

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

  // A price of 0 means the feed has not filled yet. TradingContext/usePaperTrading now refuse
  // the order too, but the panel must say so: previously a click here booked an entry at 0.00 and
  // P&L then rendered as (livePrice - 0) * lots * contractSize — ~+$108k of phantom profit for
  // one EUR/USD lot.
  const hasLivePrice = canTrade;

  const handleOpenMarketOrder = (type: 'BUY' | 'SELL') => {
    setErrorText('');

    if (!hasLivePrice) {
      setErrorText('Waiting for a live market price — orders are disabled until the feed fills.');
      return;
    }

    const pre = validateOrder({ price: currentPrice, amount, maxLots: MAX_LOTS });
    if (!pre.ok) {
      setErrorText(
        pre.reason === 'NO_PRICE'
          ? 'Waiting for a live market price — orders are disabled until the feed fills.'
          : `Lot size must be between 0.01 and ${MAX_LOTS}.`
      );
      return;
    }

    let slValue: number | undefined = undefined;
    let tpValue: number | undefined = undefined;

    if (useSltp) {
      // Parse custom inputs or default to the current active signal recommendation
      const slParsed = parseFloat(customSl);
      const tpParsed = parseFloat(customTp);

      slValue = !isNaN(slParsed) && slParsed > 0 ? slParsed : suggestedSl;
      tpValue = !isNaN(tpParsed) && tpParsed > 0 ? tpParsed : suggestedTp;

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

    const result = onOpenPosition(type, amount, slValue, tpValue);
    if (!result.ok) {
      // Message text lives next to the validator so panel and hook can never disagree.
      setErrorText(ORDER_REJECTION_TEXT[result.reason]);
      return;
    }

    // Clear inputs
    setCustomSl('');
    setCustomTp('');
  };

  // Pre-fill fields with signal suggestions
  const handleAutoFill = () => {
    if (!usableLevels) {
      setErrorText('No directional signal to copy yet — set SL/TP manually.');
      return;
    }
    setCustomSl(String(activeSignal.sl));
    setCustomTp(String(activeSignal.tp));
    setUseSltp(true);
    setErrorText('');
  };

  const handleExportCSV = () => downloadTradesCsv(closedTrades, `apexfx_trade_history_${new Date().toISOString().slice(0, 10)}.csv`);

  const totalPnL = positions.filter(hasAccountPnl).reduce((acc, pos) => acc + pos.pnl, 0);

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
          Known USD PnL: {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
        </span>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-4">
        <p className="text-[11px] text-zinc-400">{account.session ? 'Account' : 'Guest'} book · observed-quote simulator. Tiingo fills use midpoint (not bid/ask). Stops fill at the observed adverse gap price; targets at their limit. No spread, fees, or closed-app execution.</p>
        {storageError && <p role="alert" className="text-xs text-amber-400">{storageError}</p>}
        {positions.some(p => !hasAccountPnl(p)) && <p role="status" className="text-xs text-amber-400">USD totals exclude positions with unavailable marks or currency conversion. Their quote-currency P&amp;L is shown separately.</p>}
        {!canTrade && <p role="status" className="text-xs text-amber-400">Orders require a loaded book and a fresh, timestamped spot quote. History/reference/futures-proxy prices cannot execute.</p>}
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
                max={MAX_LOTS}
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full bg-zinc-950 text-xs font-mono border border-zinc-800 focus:border-zinc-700 outline-none rounded p-2 text-zinc-200 font-medium"
              />
            </div>

            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={handleAutoFill}
                disabled={!usableLevels}
                title={usableLevels ? 'Copy the active signal levels into SL/TP' : 'Waiting for a directional signal'}
                className="w-full py-2 px-1.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:text-white rounded text-[10px] font-mono tracking-tight uppercase transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Copy heuristic levels
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
                    placeholder={suggestedSl ? `e.g. ${suggestedSl}` : 'stop price (optional)'}
                    value={customSl}
                    onChange={(e) => setCustomSl(e.target.value)}
                    className="w-full bg-zinc-950 text-xs font-mono border border-zinc-800 outline-none rounded p-1.5 text-zinc-200"
                  />
                </div>
                <div>
                  <span className="text-[9px] text-zinc-500 font-mono uppercase block mb-1">Take Profit (TP)</span>
                  <input
                    type="text"
                    placeholder={suggestedTp ? `e.g. ${suggestedTp}` : 'target price (optional)'}
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
                      {suggestedLotSize === null ? 'Unavailable — check fresh FX / risk' : `${suggestedLotSize} Lots`}
                    </span>
                    <p className="text-[9px] text-zinc-500">
                      Risk: <span className="text-red-400 font-medium">${riskAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> ({riskPercent}%)
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={suggestedLotSize === null}
                    onClick={() => {
                      if (suggestedLotSize !== null) setAmount(suggestedLotSize);
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
              disabled={!canTrade}
              title={canTrade ? 'Open a market buy at the live price' : 'Waiting for live market data'}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded py-2 transition-colors cursor-pointer flex items-center justify-center gap-1.5 uppercase font-display disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
            >
              <TrendingUp className="w-4 h-4" />
              Buy / Long
            </button>
            <button
              onClick={() => handleOpenMarketOrder('SELL')}
              disabled={!canTrade}
              title={canTrade ? 'Open a market sell at the live price' : 'Waiting for live market data'}
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
            className={`flex-1 py-1 text-[10px] font-mono font-bold uppercase rounded transition-all cursor-pointer ${
              activeTab === 'positions'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm shadow-black/20'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Active ({positions.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-1 text-[10px] font-mono font-bold uppercase rounded transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm shadow-black/20'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            History ({closedTrades.length})
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex-1 py-1 text-[10px] font-mono font-bold uppercase rounded transition-all cursor-pointer flex items-center justify-center gap-1 ${
              activeTab === 'analytics'
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-950/40'
                : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30'
            }`}
          >
            <span>Analytics</span>
          </button>
        </div>

        {activeTab === 'analytics' ? (
          <div className="space-y-4">
            <PerformanceDashboard />
          </div>
        ) : activeTab === 'positions' ? (
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
                    const isGain = hasAccountPnl(pos) && pos.pnl >= 0;
                    
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
                              {formatPnl(pos)}
                            </div>
                            <span className="text-[9px] text-zinc-500 font-mono leading-none">
                              Last mark · {pos.markAsOf ? quoteQuality(watchlistItems.find(q => q.symbol === pos.symbol)) : 'unavailable'}
                            </span>
                          </div>

                          <button
                            onClick={() => { const result = onClosePosition(pos.id); if (!result.ok) setErrorText(ORDER_REJECTION_TEXT[result.reason]); }}
                            aria-label={`Close ${pos.symbol} position`}
                            disabled={!isExecutableQuote(watchlistItems.find(q => q.symbol === pos.symbol))}
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
              <div className="flex items-center gap-2">
                {closedTrades.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 uppercase tracking-tight font-bold cursor-pointer transition-all flex items-center gap-1 bg-emerald-950/40 hover:bg-emerald-900/50 px-2 py-0.5 rounded border border-emerald-900/50 shadow-sm"
                    title="Export trade history to CSV file"
                    id="export_csv_btn"
                  >
                    <Download className="w-3 h-3" />
                    <span>Export CSV</span>
                  </button>
                )}
                {closedTrades.length > 0 && onClearHistory && (
                  <button
                    type="button"
                    onClick={onClearHistory}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-tight font-bold cursor-pointer transition-all"
                  >
                    Clear Logs
                  </button>
                )}
              </div>
            </div>

            {closedTrades.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-xs border border-dashed border-zinc-800/60 rounded-lg font-mono">
                No closed trades yet.
              </div>
            ) : (
              <div>
                <div className="space-y-2 max-h-[290px] overflow-y-auto pr-0.5 mb-2">
                  {paginatedClosedTrades.map((trade) => {
                    const isGain = hasAccountPnl(trade) && trade.pnl >= 0;
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
                            {formatPnl(trade)}
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
                            className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer hover:bg-zinc-800"
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
                            className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer hover:bg-zinc-800"
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
