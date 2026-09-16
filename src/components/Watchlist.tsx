import React, { useState, useMemo } from 'react';
import { useTrading } from '../context/TradingContext';
import { TrendingUp, TrendingDown, ArrowRightLeft, PanelLeftClose, Search, Sparkles } from 'lucide-react';
import { formatPrice } from '../utils/forexData';

interface WatchlistProps {
  onCollapseOverride?: () => void;
}

type MarketCategory = 'all' | 'forex' | 'crypto' | 'metals';

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
    wsConnected,
  } = useTrading();

  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<MarketCategory>('all');

  const onSelectSymbol = (sym: string) => {
    startTransition(() => {
      setSelectedSymbol(sym);
    });
    if (mobileTab === 'watchlist') {
      setMobileTab('chart');
    }
  };

  const onCollapse = onCollapseOverride || (() => setLeftSidebarOpen(false));

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const isCrypto = item.symbol.startsWith('BTC') || item.symbol.startsWith('ETH');
      const isMetal = item.symbol.startsWith('XAU') || item.symbol.startsWith('XAG');
      const isForex = !isCrypto && !isMetal;

      if (category === 'forex' && !isForex) return false;
      if (category === 'crypto' && !isCrypto) return false;
      if (category === 'metals' && !isMetal) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase();
      return (
        item.symbol.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q)
      );
    });
  }, [items, category, searchQuery]);

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
            Market Universe
          </h2>
        </div>
        <span className="text-[10px] bg-zinc-800 text-zinc-400 font-mono px-1.5 py-0.5 rounded font-semibold animate-pulse uppercase">
          Ticking Live
        </span>
      </div>

      {/* Search & Filter bar */}
      <div className="p-2.5 border-b border-zinc-800/80 bg-zinc-950 space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pair or asset..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2 text-zinc-500 hover:text-zinc-200 text-xs"
            >
              ×
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
          {(['all', 'forex', 'crypto', 'metals'] as MarketCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`py-1 rounded capitalize text-center transition-colors cursor-pointer ${
                category === cat
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/80 font-bold'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid List */}
      <div className="divide-y divide-zinc-800/60 overflow-y-auto flex-1 text-xs">
        {filteredItems.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 font-mono text-xs">
            No instruments found matching &quot;{searchQuery}&quot;
          </div>
        ) : (
          filteredItems.map((item) => {
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
                className={`w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors outline-none cursor-pointer hover:bg-zinc-900 ${
                  isSelected ? 'bg-zinc-900/90 border-l-2 border-emerald-500' : ''
                } ${flashClass}`}
                id={`watchlist_btn_${item.symbol}`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-zinc-100 font-mono tracking-tight text-sm">
                      {item.symbol.length === 6 ? `${item.symbol.slice(0, 3)}/${item.symbol.slice(3)}` : item.symbol}
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
          })
        )}
      </div>

      {/* Multi-feed status footer */}
      <div className="p-3 bg-zinc-900/60 border-t border-zinc-800 text-[11px] text-zinc-500 space-y-1 font-mono">
        <div className="flex justify-between">
          <span>Feed:</span>
          <span className={wsConnected ? 'text-emerald-400' : 'text-amber-500'}>
            {wsConnected ? 'WebSocket Multi-Stream' : 'HTTP Polling'}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Providers:</span>
          <span className="text-zinc-400">Deriv • Tiingo • Yahoo</span>
        </div>
      </div>
    </div>
  );
});
