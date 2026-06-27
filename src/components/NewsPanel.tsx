import React, { useEffect, useState } from 'react';
import { NewsItem } from '../types';
import { Globe, HeartHandshake, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { CURRENT_NEWS } from '../utils/forexData';

import { useTrading } from '../context/TradingContext';

interface NewsPanelProps {}

export const NewsPanel: React.FC<NewsPanelProps> = React.memo(() => {
  const { selectedSymbol } = useTrading();
  const [news, setNews] = useState<NewsItem[]>(CURRENT_NEWS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 4;

  useEffect(() => {
    const fetchNews = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/market/news?category=forex');
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch news');
        }

        if (Array.isArray(data) && data.length > 0) {
          // Map Finnhub news format to our NewsItem type
          const formattedNews: NewsItem[] = data.slice(0, 15).map((item: any) => {
            const date = new Date(item.datetime * 1000);
            
            // Generate some plausible affected pairs from text
            const text = `${item.headline} ${item.summary}`.toUpperCase();
            const pairs = [];
            if (text.includes('USD') || text.includes('FED')) pairs.push('USD');
            if (text.includes('EUR') || text.includes('ECB')) pairs.push('EUR');
            if (text.includes('GBP') || text.includes('BOE')) pairs.push('GBP');
            if (text.includes('JPY') || text.includes('BOJ')) pairs.push('JPY');
            if (pairs.length === 0) pairs.push('GLOBAL');

            return {
              id: String(item.id),
              title: item.headline,
              source: item.source || 'Finnhub',
              time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              impact: 'MEDIUM', // Finnhub free doesn't easily give impact rating
              affectedPairs: pairs,
              sentiment: 'neutral', // default, could be analyzed with AI if we had time
              summary: item.summary
            };
          });
          setNews(formattedNews);
        }
      } catch (err: any) {
        console.warn("Using mock news data:", err.message);
        setError("Using mock data. " + (err.message || 'Configure FINNHUB_API_KEY in secrets to see live news.'));
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, [selectedSymbol]);

  // Sort or highlight news that explicitly affects the active selected symbol
  const sortedNews = [...news].sort((a, b) => {
    const aAffects = a.affectedPairs.some(pair => selectedSymbol.includes(pair) || pair.includes(selectedSymbol));
    const bAffects = b.affectedPairs.some(pair => selectedSymbol.includes(pair) || pair.includes(selectedSymbol));
    if (aAffects && !bAffects) return -1;
    if (!aAffects && bAffects) return 1;
    return 0;
  });

  const totalPages = Math.ceil(sortedNews.length / itemsPerPage);
  const paginatedNews = sortedNews.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset to page 1 if symbol or news list updates
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSymbol, news]);

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden h-full" id="news_panel_component">
      {/* Header */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-emerald-400" />
          <h2 className="font-display font-semibold text-sm tracking-wide uppercase text-zinc-200">
            Fundamental News Stream
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />}
          <span className="text-[10px] bg-zinc-800 text-zinc-400 font-mono px-2 py-0.5 rounded font-semibold uppercase">
            {error ? 'Simulated Feed' : 'Live Feed'}
          </span>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-2 bg-rose-950/40 border border-rose-900/50 rounded flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 text-rose-500 mt-0.5 flex-shrink-0" />
          <p className="text-[9px] font-mono text-rose-400/80 leading-relaxed">
            {error}
          </p>
        </div>
      )}

      {/* News Stream List */}
      <div className="p-4 flex-1 overflow-y-auto space-y-3">
        {paginatedNews.map((item) => {
          const affectsSymbol = item.affectedPairs.some(
            (p) => selectedSymbol.includes(p) || p.includes(selectedSymbol)
          );
          const isHighImpact = item.impact === 'HIGH';
          const isMediumImpact = item.impact === 'MEDIUM';

          return (
            <div
              key={item.id}
              className={`p-3 rounded-lg border transition-all ${
                affectsSymbol
                  ? 'bg-zinc-900/60 border-zinc-700'
                  : 'bg-zinc-900/10 border-zinc-800/60'
              }`}
            >
              <div className="flex items-center justify-between font-mono text-[9px] mb-1.5">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded font-bold ${
                    isHighImpact
                      ? 'bg-red-950/60 text-red-400 border border-red-900/45'
                      : isMediumImpact
                      ? 'bg-amber-950/60 text-amber-500 border border-amber-900/40'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {item.impact} IMPACT
                  </span>
                  <span className="text-zinc-500">{item.time}</span>
                </div>
                <span className="text-zinc-500 font-medium font-mono uppercase">{item.source}</span>
              </div>

              <h4 className="font-sans font-semibold text-xs text-zinc-200 leading-snug hover:text-white transition-colors">
                {item.title}
              </h4>

              <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono mt-2 pt-1.5 border-t border-zinc-800/40">
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500">Pairs:</span>
                  <div className="flex gap-1">
                    {item.affectedPairs.map((p) => (
                      <span
                        key={p}
                        className={`px-1 rounded text-[9px] ${
                          p === selectedSymbol
                            ? 'bg-emerald-950 text-emerald-400 font-bold'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>

                <span className={`uppercase text-[9px] font-bold ${
                  item.sentiment === 'bullish'
                    ? 'text-emerald-400'
                    : item.sentiment === 'bearish'
                    ? 'text-rose-500'
                    : 'text-zinc-400'
                }`}>
                  {item.sentiment}
                </span>
              </div>
            </div>
          );
        })}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-800/60 pt-3 mt-4 text-[10px] font-mono">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer hover:bg-zinc-800"
            >
              Previous
            </button>
            <span className="text-zinc-400 font-semibold">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer hover:bg-zinc-800"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
