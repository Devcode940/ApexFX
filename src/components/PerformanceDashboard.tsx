import React, { useState, useMemo } from 'react';
import { useTrading } from '../context/TradingContext';
import { ClosedTrade, TradePosition } from '../types';
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  PieChart,
  BarChart2,
  Activity,
  Zap,
  Filter,
  CheckCircle2,
  XCircle,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  RotateCcw,
  ShieldAlert,
  Layers
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
  Cell
} from 'recharts';

// Helper to format duration in human-readable units
export const formatDuration = (ms: number): string => {
  if (!ms || isNaN(ms) || ms <= 0) return '0m';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  if (hours > 0) {
    const remMins = minutes % 60;
    return `${hours}h ${remMins}m`;
  }
  if (minutes > 0) {
    const remSecs = seconds % 60;
    return `${minutes}m ${remSecs}s`;
  }
  return `${seconds}s`;
};

export const PerformanceDashboard: React.FC = () => {
  const {
    positions,
    closedTrades,
    theme,
    selectedSymbol,
    handleOpenPosition,
    handleClosePosition
  } = useTrading();

  // Filters state
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [symbolFilter, setSymbolFilter] = useState<string>('all');
  const [tradeScope, setTradeScope] = useState<'closed' | 'combined' | 'open'>('closed');

  // Filtered dataset computation
  const filteredClosedTrades = useMemo(() => {
    let list = [...closedTrades];

    if (symbolFilter !== 'all') {
      list = list.filter((t) => t.symbol === symbolFilter);
    }

    if (timeFilter !== 'all') {
      const now = Date.now();
      const oneDay = 86400000;
      if (timeFilter === 'today') {
        list = list.filter((t) => (t.closedAt ? now - t.closedAt <= oneDay : true));
      } else if (timeFilter === 'week') {
        list = list.filter((t) => (t.closedAt ? now - t.closedAt <= oneDay * 7 : true));
      } else if (timeFilter === 'month') {
        list = list.filter((t) => (t.closedAt ? now - t.closedAt <= oneDay * 30 : true));
      }
    }

    return list;
  }, [closedTrades, symbolFilter, timeFilter]);

  const filteredPositions = useMemo(() => {
    let list = [...positions];
    if (symbolFilter !== 'all') {
      list = list.filter((p) => p.symbol === symbolFilter);
    }
    return list;
  }, [positions, symbolFilter]);

  // Comprehensive Metrics Calculations
  const metrics = useMemo(() => {
    // Determine list of trades based on scope
    const useClosed = tradeScope === 'closed' || tradeScope === 'combined';
    const useOpen = tradeScope === 'open' || tradeScope === 'combined';

    const closedList = useClosed ? filteredClosedTrades : [];
    const openList = useOpen ? filteredPositions : [];

    // Realized P&L
    const realizedPnl = closedList.reduce((acc, t) => acc + (t.pnl || 0), 0);
    // Unrealized P&L
    const unrealizedPnl = openList.reduce((acc, p) => acc + (p.pnl || 0), 0);
    // Total Net P&L
    const totalNetPnl = realizedPnl + unrealizedPnl;

    // Counts
    const closedCount = closedList.length;
    const openCount = openList.length;

    // Win/Loss Breakdown for Closed Trades
    let winningClosed = 0;
    let losingClosed = 0;
    let breakevenClosed = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let bestTrade = -Infinity;
    let worstTrade = Infinity;

    closedList.forEach((t) => {
      if (t.pnl > 0) {
        winningClosed++;
        grossProfit += t.pnl;
      } else if (t.pnl < 0) {
        losingClosed++;
        grossLoss += Math.abs(t.pnl);
      } else {
        breakevenClosed++;
      }

      if (t.pnl > bestTrade) bestTrade = t.pnl;
      if (t.pnl < worstTrade) worstTrade = t.pnl;
    });

    if (bestTrade === -Infinity) bestTrade = 0;
    if (worstTrade === Infinity) worstTrade = 0;

    // Open positions win/loss
    let winningOpen = 0;
    let losingOpen = 0;
    openList.forEach((p) => {
      if (p.pnl > 0) winningOpen++;
      else if (p.pnl < 0) losingOpen++;
    });

    const totalWinning = winningClosed + (useOpen ? winningOpen : 0);
    const totalLosing = losingClosed + (useOpen ? losingOpen : 0);
    const totalEvaluated = closedCount + (useOpen ? openCount : 0);

    // Win Rate %
    const winRate = totalEvaluated > 0 ? (totalWinning / totalEvaluated) * 100 : 0;
    const lossRate = totalEvaluated > 0 ? (totalLosing / totalEvaluated) * 100 : 0;

    // Profit Factor
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;

    // Average Win vs Average Loss
    const avgWin = winningClosed > 0 ? grossProfit / winningClosed : 0;
    const avgLoss = losingClosed > 0 ? grossLoss / losingClosed : 0;
    const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 99.9 : 0;

    // Holding Durations (ms)
    let totalDurationMs = 0;
    let winningDurationMs = 0;
    let losingDurationMs = 0;
    let shortestMs = Infinity;
    let longestMs = 0;
    let durationCount = 0;
    let winningDurationCount = 0;
    let losingDurationCount = 0;

    // Durations by trade type
    let scalpCount = 0; // < 15 mins
    let dayCount = 0; // 15 mins to 4 hours
    let swingCount = 0; // > 4 hours

    closedList.forEach((t) => {
      let dur = t.durationMs;
      if (!dur && t.openedAt && t.closedAt) {
        dur = t.closedAt - t.openedAt;
      }
      if (!dur) dur = 3600000; // default 1 hr fallback

      totalDurationMs += dur;
      durationCount++;

      if (dur < shortestMs) shortestMs = dur;
      if (dur > longestMs) longestMs = dur;

      if (dur < 15 * 60 * 1000) scalpCount++;
      else if (dur <= 4 * 3600 * 1000) dayCount++;
      else swingCount++;

      if (t.pnl > 0) {
        winningDurationMs += dur;
        winningDurationCount++;
      } else if (t.pnl < 0) {
        losingDurationMs += dur;
        losingDurationCount++;
      }
    });

    // Also factor in current duration of open positions if viewing open/combined
    if (useOpen) {
      const now = Date.now();
      openList.forEach((p) => {
        const dur = p.openedAt ? now - p.openedAt : 1800000;
        totalDurationMs += dur;
        durationCount++;
        if (dur < shortestMs) shortestMs = dur;
        if (dur > longestMs) longestMs = dur;
      });
    }

    if (shortestMs === Infinity) shortestMs = 0;

    const avgHoldingMs = durationCount > 0 ? totalDurationMs / durationCount : 0;
    const avgWinningHoldingMs = winningDurationCount > 0 ? winningDurationMs / winningDurationCount : 0;
    const avgLosingHoldingMs = losingDurationCount > 0 ? losingDurationMs / losingDurationCount : 0;

    // Symbol Performance Breakdown
    const symbolMap: Record<
      string,
      { count: number; wins: number; losses: number; pnl: number; totalDur: number }
    > = {};

    closedList.forEach((t) => {
      if (!symbolMap[t.symbol]) {
        symbolMap[t.symbol] = { count: 0, wins: 0, losses: 0, pnl: 0, totalDur: 0 };
      }
      const item = symbolMap[t.symbol];
      item.count++;
      if (t.pnl > 0) item.wins++;
      else if (t.pnl < 0) item.losses++;
      item.pnl += t.pnl;
      item.totalDur += t.durationMs || 3600000;
    });

    const symbolBreakdown = Object.entries(symbolMap).map(([sym, val]) => ({
      symbol: sym,
      count: val.count,
      winRate: val.count > 0 ? (val.wins / val.count) * 100 : 0,
      pnl: parseFloat(val.pnl.toFixed(2)),
      avgDur: val.count > 0 ? val.totalDur / val.count : 0
    }));

    // Long vs Short Performance
    let buyWins = 0,
      buyCount = 0,
      buyPnl = 0;
    let sellWins = 0,
      sellCount = 0,
      sellPnl = 0;

    closedList.forEach((t) => {
      if (t.type === 'BUY') {
        buyCount++;
        if (t.pnl > 0) buyWins++;
        buyPnl += t.pnl;
      } else {
        sellCount++;
        if (t.pnl > 0) sellWins++;
        sellPnl += t.pnl;
      }
    });

    const buyWinRate = buyCount > 0 ? (buyWins / buyCount) * 100 : 0;
    const sellWinRate = sellCount > 0 ? (sellWins / sellCount) * 100 : 0;

    return {
      realizedPnl,
      unrealizedPnl,
      totalNetPnl,
      closedCount,
      openCount,
      totalEvaluated,
      totalWinning,
      totalLosing,
      breakevenClosed,
      winRate,
      lossRate,
      profitFactor,
      grossProfit,
      grossLoss,
      avgWin,
      avgLoss,
      winLossRatio,
      bestTrade,
      worstTrade,
      avgHoldingMs,
      avgWinningHoldingMs,
      avgLosingHoldingMs,
      shortestMs,
      longestMs,
      scalpCount,
      dayCount,
      swingCount,
      symbolBreakdown,
      buyCount,
      buyWinRate,
      buyPnl,
      sellCount,
      sellWinRate,
      sellPnl
    };
  }, [filteredClosedTrades, filteredPositions, tradeScope]);

  // Cumulative Equity Chart Data points
  const equityCurveData = useMemo(() => {
    const list = [...filteredClosedTrades].sort(
      (a, b) => (a.closedAt || 0) - (b.closedAt || 0)
    );

    let cumulative = 0;
    const initialPoint = { index: 0, label: 'Start', pnl: 0, cumulative: 0, trade: 'Initial' };

    const points = list.map((t, idx) => {
      cumulative += t.pnl;
      return {
        index: idx + 1,
        label: t.time || `#${idx + 1}`,
        symbol: t.symbol,
        type: t.type,
        pnl: t.pnl,
        cumulative: parseFloat(cumulative.toFixed(2))
      };
    });

    return [initialPoint, ...points];
  }, [filteredClosedTrades]);

  const handleExportCSV = () => {
    const headers = ['Trade ID', 'Symbol', 'Type', 'Entry Price', 'Exit Price', 'Amount', 'PnL ($)', 'Time', 'Duration'];
    const rows = filteredClosedTrades.map((t) => [
      t.id,
      t.symbol,
      t.type,
      t.entryPrice,
      t.exitPrice,
      t.amount,
      t.pnl,
      t.time,
      formatDuration(t.durationMs || 3600000)
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `apex_fx_performance_report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className={`p-4 md:p-6 rounded-2xl border ${
        theme === 'dark' ? 'bg-zinc-950 border-zinc-800/90 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
      } space-y-6 shadow-2xl transition-all`}
      id="performance_dashboard_container"
    >
      {/* 1. DASHBOARD HEADER & FILTER CONTROLS */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-zinc-800/70">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-lg shadow-emerald-950/30">
            <Trophy className="w-6 h-6 text-emerald-400 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display font-black text-lg md:text-xl tracking-tight text-white flex items-center gap-2">
                Performance Dashboard
              </h2>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800/80">
                Live Analytics
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">
              Calculated real-time win rate, P&amp;L stats, and holding duration telemetry.
            </p>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs w-full lg:w-auto">
          {/* Time Scope filter */}
          <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
            {(['all', 'today', 'week', 'month'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeFilter(tf)}
                className={`px-2.5 py-1 rounded-md capitalize font-bold transition-all cursor-pointer ${
                  timeFilter === tf
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                {tf === 'all' ? 'All Time' : tf}
              </button>
            ))}
          </div>

          {/* Symbol Selector */}
          <select
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className={`p-1.5 rounded-lg border font-mono text-xs font-bold cursor-pointer outline-none ${
              theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200' : 'bg-zinc-100 border-zinc-200 text-zinc-800'
            }`}
          >
            <option value="all">All Pairs</option>
            <option value="EURUSD">EUR/USD</option>
            <option value="GBPUSD">GBP/USD</option>
            <option value="USDJPY">USD/JPY</option>
            <option value="AUDUSD">AUD/USD</option>
            <option value="USDCAD">USD/CAD</option>
            <option value="GBPJPY">GBP/JPY</option>
            <option value="XAUUSD">XAU/USD (Gold)</option>
            <option value="XAGUSD">XAG/USD (Silver)</option>
          </select>

          {/* Trade Scope selector */}
          <select
            value={tradeScope}
            onChange={(e) => setTradeScope(e.target.value as any)}
            className={`p-1.5 rounded-lg border font-mono text-xs font-bold cursor-pointer outline-none ${
              theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200' : 'bg-zinc-100 border-zinc-200 text-zinc-800'
            }`}
          >
            <option value="closed">Closed Trades Only</option>
            <option value="open">Open Positions Only</option>
            <option value="combined">Combined (Realized + Unrealized)</option>
          </select>

          {/* Export & Reset buttons */}
          <button
            onClick={handleExportCSV}
            className="p-1.5 px-2.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Export Performance CSV Report"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>

      {/* 2. THREE PRIMARY METRIC CARDS (SUCCESS RATE, TOTAL P&L, AVG HOLDING TIME) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CARD 1: TRADE SUCCESS RATE (WIN RATE) */}
        <div
          className={`p-4 rounded-xl border relative overflow-hidden flex flex-col justify-between ${
            theme === 'dark'
              ? 'bg-zinc-900/80 border-zinc-800 shadow-xl'
              : 'bg-zinc-50 border-zinc-200 shadow-sm'
          }`}
          id="metric_card_success_rate"
        >
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">
                Trade Success Rate
              </span>
            </div>
            <span
              className={`text-[10px] font-mono font-extrabold px-1.5 py-0.5 rounded ${
                metrics.winRate >= 50
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-900/60'
                  : 'bg-rose-950 text-rose-400 border border-rose-900/60'
              }`}
            >
              {metrics.winRate >= 50 ? 'HIGH ACCURACY' : 'ATTENTION'}
            </span>
          </div>

          <div className="my-3 flex items-baseline justify-between">
            <div>
              <span className="text-3xl lg:text-4xl font-display font-black text-white tracking-tight">
                {metrics.winRate.toFixed(1)}%
              </span>
              <span className="text-xs font-mono text-zinc-400 block mt-1">
                {metrics.totalWinning} Wins / {metrics.totalEvaluated} Total Trades
              </span>
            </div>
            <div className="text-right font-mono">
              <span className="text-[10px] text-zinc-500 uppercase block">Profit Factor</span>
              <span className="text-sm font-extrabold text-emerald-400">
                {metrics.profitFactor > 50 ? '> 50x' : `${metrics.profitFactor.toFixed(2)}x`}
              </span>
            </div>
          </div>

          {/* Win / Loss Visual Bar Ratio */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] font-mono text-zinc-400 font-bold">
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Win Rate: {metrics.winRate.toFixed(0)}% ({metrics.totalWinning})
              </span>
              <span className="text-rose-400 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> Loss Rate: {metrics.lossRate.toFixed(0)}% ({metrics.totalLosing})
              </span>
            </div>
            <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden flex border border-zinc-800">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${metrics.winRate}%` }}
              />
              <div
                className="h-full bg-rose-500 transition-all duration-500"
                style={{ width: `${metrics.lossRate}%` }}
              />
            </div>
          </div>
        </div>

        {/* CARD 2: TOTAL PROFIT / LOSS (P&L) */}
        <div
          className={`p-4 rounded-xl border relative overflow-hidden flex flex-col justify-between ${
            theme === 'dark'
              ? 'bg-zinc-900/80 border-zinc-800 shadow-xl'
              : 'bg-zinc-50 border-zinc-200 shadow-sm'
          }`}
          id="metric_card_total_pnl"
        >
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">
                Total Profit / Loss
              </span>
            </div>
            <span
              className={`text-[10px] font-mono font-extrabold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                metrics.totalNetPnl >= 0
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-900/60'
                  : 'bg-rose-950 text-rose-400 border border-rose-900/60'
              }`}
            >
              {metrics.totalNetPnl >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {metrics.totalNetPnl >= 0 ? 'NET GAIN' : 'NET LOSS'}
            </span>
          </div>

          <div className="my-3 flex items-baseline justify-between">
            <div>
              <span
                className={`text-3xl lg:text-4xl font-display font-black tracking-tight ${
                  metrics.totalNetPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {metrics.totalNetPnl >= 0 ? '+' : ''}
                ${metrics.totalNetPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-xs font-mono text-zinc-400 block mt-1">
                Realized: ${metrics.realizedPnl.toFixed(2)} | Unrealized: ${metrics.unrealizedPnl.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Gross Profit vs Gross Loss Breakdown */}
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-zinc-950/60 p-2 rounded-lg border border-zinc-800/50">
            <div>
              <span className="text-zinc-500 uppercase block">Gross Profit</span>
              <span className="text-emerald-400 font-bold">+${metrics.grossProfit.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-zinc-500 uppercase block">Gross Loss</span>
              <span className="text-rose-400 font-bold">-${metrics.grossLoss.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* CARD 3: AVERAGE HOLDING TIME */}
        <div
          className={`p-4 rounded-xl border relative overflow-hidden flex flex-col justify-between ${
            theme === 'dark'
              ? 'bg-zinc-900/80 border-zinc-800 shadow-xl'
              : 'bg-zinc-50 border-zinc-200 shadow-sm'
          }`}
          id="metric_card_avg_holding_time"
        >
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">
                Average Holding Time
              </span>
            </div>
            <span className="text-[10px] font-mono font-extrabold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-900/60">
              TELEMETRY
            </span>
          </div>

          <div className="my-3 flex items-baseline justify-between">
            <div>
              <span className="text-3xl lg:text-4xl font-display font-black text-cyan-400 tracking-tight">
                {formatDuration(metrics.avgHoldingMs)}
              </span>
              <span className="text-xs font-mono text-zinc-400 block mt-1">
                Average position holding duration
              </span>
            </div>
          </div>

          {/* Winners vs Losers Holding Duration Breakdown */}
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-zinc-950/60 p-2 rounded-lg border border-zinc-800/50">
            <div>
              <span className="text-zinc-500 uppercase block">Avg Win Duration</span>
              <span className="text-emerald-400 font-bold">{formatDuration(metrics.avgWinningHoldingMs)}</span>
            </div>
            <div>
              <span className="text-zinc-500 uppercase block">Avg Loss Duration</span>
              <span className="text-amber-400 font-bold">{formatDuration(metrics.avgLosingHoldingMs)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CUMULATIVE P&L / EQUITY CURVE GRAPH */}
      <div
        className={`p-4 rounded-xl border ${
          theme === 'dark' ? 'bg-zinc-900/60 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
        } space-y-3`}
        id="performance_equity_curve_section"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            <h3 className="font-display font-bold text-xs uppercase tracking-wider text-zinc-200">
              Cumulative Equity &amp; P&amp;L Growth Curve
            </h3>
          </div>
          <span className="text-[10px] font-mono text-zinc-400">
            {equityCurveData.length - 1} Closed Trades Visualized
          </span>
        </div>

        <div className="h-56 w-full pt-2">
          {equityCurveData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityCurveData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGreenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  stroke="#52525b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#27272a' }}
                />
                <YAxis
                  stroke="#52525b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#27272a' }}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-zinc-900/95 border border-zinc-800 p-2.5 rounded-lg shadow-2xl font-mono text-xs space-y-1">
                          <div className="font-bold text-zinc-200 border-b border-zinc-800 pb-1 flex items-center justify-between gap-2">
                            <span>{data.symbol ? `${data.symbol} (${data.type})` : 'Start'}</span>
                            <span className="text-[10px] text-zinc-400">{data.label}</span>
                          </div>
                          {data.pnl !== undefined && (
                            <div className="flex justify-between gap-4 text-[11px]">
                              <span className="text-zinc-400">Trade P&amp;L:</span>
                              <span className={`font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between gap-4 text-[11px] pt-1 border-t border-zinc-800/80">
                            <span className="text-zinc-400">Cumulative Net:</span>
                            <span className="font-bold text-emerald-400">
                              ${data.cumulative.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#pnlGreenGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 font-mono text-xs border border-dashed border-zinc-800 rounded-lg p-6">
              <Activity className="w-8 h-8 text-zinc-600 mb-2 animate-pulse" />
              <span>No trade execution history available for current filters.</span>
              <span className="text-[10px] text-zinc-600 mt-1">Open and close positions to populate the equity curve.</span>
            </div>
          )}
        </div>
      </div>

      {/* 4. SECONDARY PERFORMANCE METRICS MATRIX */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Symbol Performance Breakdown */}
        <div
          className={`p-4 rounded-xl border ${
            theme === 'dark' ? 'bg-zinc-900/60 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
          } space-y-3`}
        >
          <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Layers className="w-4 h-4" /> Performance by Currency Pair
            </span>
            <span className="text-[10px] font-mono text-zinc-400">{metrics.symbolBreakdown.length} Pairs Traded</span>
          </div>

          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {metrics.symbolBreakdown.length > 0 ? (
              metrics.symbolBreakdown.map((item) => (
                <div
                  key={item.symbol}
                  className={`p-2.5 rounded-lg border flex items-center justify-between text-xs font-mono ${
                    theme === 'dark' ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-zinc-200'
                  }`}
                >
                  <div>
                    <span className="font-extrabold text-zinc-200 block">{item.symbol}</span>
                    <span className="text-[10px] text-zinc-400">
                      {item.count} Trades | Win Rate: <strong className="text-emerald-400">{item.winRate.toFixed(0)}%</strong>
                    </span>
                  </div>

                  <div className="text-right">
                    <span
                      className={`font-bold block ${
                        item.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {item.pnl >= 0 ? '+' : ''}${item.pnl.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      Avg Dur: {formatDuration(item.avgDur)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-zinc-500 font-mono text-xs">
                No symbol execution data yet.
              </div>
            )}
          </div>
        </div>

        {/* Detailed Statistical Ratios & Trade Classification */}
        <div
          className={`p-4 rounded-xl border ${
            theme === 'dark' ? 'bg-zinc-900/60 border-zinc-800' : 'bg-zinc-50 border-zinc-200'
          } space-y-3`}
        >
          <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
              <Activity className="w-4 h-4" /> Execution Telemetry &amp; Ratios
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className={`p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-zinc-200'}`}>
              <span className="text-[10px] text-zinc-500 uppercase block">Average Win</span>
              <span className="text-emerald-400 font-bold">+${metrics.avgWin.toFixed(2)}</span>
            </div>

            <div className={`p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-zinc-200'}`}>
              <span className="text-[10px] text-zinc-500 uppercase block">Average Loss</span>
              <span className="text-rose-400 font-bold">-${metrics.avgLoss.toFixed(2)}</span>
            </div>

            <div className={`p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-zinc-200'}`}>
              <span className="text-[10px] text-zinc-500 uppercase block">Largest Win</span>
              <span className="text-emerald-400 font-bold">+${metrics.bestTrade.toFixed(2)}</span>
            </div>

            <div className={`p-2.5 rounded-lg border ${theme === 'dark' ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-zinc-200'}`}>
              <span className="text-[10px] text-zinc-500 uppercase block">Largest Loss</span>
              <span className="text-rose-400 font-bold">${metrics.worstTrade.toFixed(2)}</span>
            </div>

            <div className={`p-2.5 rounded-lg border col-span-2 ${theme === 'dark' ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-zinc-200'} flex justify-between items-center`}>
              <div>
                <span className="text-[10px] text-zinc-500 uppercase block">BUY (Longs) Win Rate</span>
                <span className="text-zinc-200 font-bold">{metrics.buyWinRate.toFixed(1)}% ({metrics.buyCount} Trades)</span>
              </div>
              <span className={`font-bold ${metrics.buyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {metrics.buyPnl >= 0 ? '+' : ''}${metrics.buyPnl.toFixed(2)}
              </span>
            </div>

            <div className={`p-2.5 rounded-lg border col-span-2 ${theme === 'dark' ? 'bg-zinc-950/60 border-zinc-800' : 'bg-white border-zinc-200'} flex justify-between items-center`}>
              <div>
                <span className="text-[10px] text-zinc-500 uppercase block">SELL (Shorts) Win Rate</span>
                <span className="text-zinc-200 font-bold">{metrics.sellWinRate.toFixed(1)}% ({metrics.sellCount} Trades)</span>
              </div>
              <span className={`font-bold ${metrics.sellPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {metrics.sellPnl >= 0 ? '+' : ''}${metrics.sellPnl.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
