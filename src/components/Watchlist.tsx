import React from 'react';
import { useTrading } from '../context/TradingContext';
import { TrendingUp, TrendingDown, ArrowRightLeft, PanelLeftClose } from 'lucide-react';
import { formatPrice } from '../utils/forexData';

interface WatchlistProps {
  onCollapseOverride?: () => void;
}

export const Watchlist = React.memo<WatchlistProps>(({ onCollapseOverride }) => {
  const {
    watchlistItems: items,
    selectedSymbol,
    setSelectedSymbol,
    tickStates,
    setLeftSidebarOpen,
    startTransition,
    mobileTab,
    setMobileTab,
  } = useTrading();

  const onSelectSymbol = (sym: string) => {
    startTransition(() => {
      setSelectedSymbol(sym);
    });
    if (mobileTab === 'watchlist') {
      setMobileTab('chart');
    }
  };

  const onCollapse = onCollapseOverride || (() => setLeftSidebarOpen(false));

  return (
    <div className="flex flex-col h-full bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden" id="watchlist_component">
      {/* Header */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onCollapse ? (
            <button
              onClick={onCollapse}
              className="text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer mr-1"
              title="Collapse Watchlist"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          ) : (
            <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
          )}
          <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200">
            Live FX Pairs
          </h2>
        </div>
        <span className="text-[10px] bg-zinc-800 text-zinc-400 font-mono px-1.5 py-0.5 rounded font-semibold animate-pulse uppercase">
          Ticking Live
        </span>
      </div>

      {/* Grid List */}
      <div className="divide-y divide-zinc-800/60 overflow-y-auto flex-1 text-xs">
        {items.map((item) => {
          const isSelected = item.symbol === selectedSymbol;
          const isPositive = item.change >= 0;
          const tick = tickStates[item.symbol];

          let flashClass = '';
          if (tick === 'up') flashClass = 'tick-green-flash';
          if (tick === 'down') flashClass = 'tick-red-flash';

          return (
            <button
              key={item.symbol}
              onClick={() => onSelectSymbol(item.symbol)}
              className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors outline-none cursor-pointer hover:bg-zinc-900 ${
                isSelected ? 'bg-zinc-900/90 border-l-2 border-emerald-500' : ''
              } ${flashClass}`}
              id={`watchlist_btn_${item.symbol}`}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-zinc-100 font-mono tracking-tight text-sm">
                    {item.symbol.slice(0, 3)}/{item.symbol.slice(3)}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {item.spread.toFixed(1)} pip
                  </span>
                </div>
                <div className="text-[10px] text-zinc-400 uppercase truncate max-w-[120px]">
                  {item.name}
                </div>
              </div>

              <div className="text-right space-y-0.5">
                <div className="font-mono font-bold text-sm tracking-tight text-zinc-100">
                  {formatPrice(item.price, item.symbol)}
                </div>
                <div
                  className={`inline-flex items-center gap-0.5 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isPositive ? 'bg-emerald-950/40 text-emerald-400' : 'bg-red-950/40 text-red-400'
                  }`}
                >
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isPositive ? '+' : ''}
                  {item.change.toFixed(2)}%
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Mini details summary */}
      <div className="p-3 bg-zinc-900/45 border-t border-zinc-800 text-[11px] text-zinc-500 space-y-1 font-mono">
        <div className="flex justify-between">
          <span>Global Latency:</span>
          <span>~12ms</span>
        </div>
        <div className="flex justify-between">
          <span>Spread Cost:</span>
          <span>Competitive</span>
        </div>
      </div>
    </div>
  );
});
