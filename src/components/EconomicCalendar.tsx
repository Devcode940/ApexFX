import React, { useState, useEffect } from 'react';
import { Calendar, Clock, AlertTriangle, Filter, RefreshCw, Zap } from 'lucide-react';

export interface CalendarEvent {
  title: string;
  country: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
}

interface EconomicCalendarProps {
  selectedSymbol?: string;
}

export function EconomicCalendar({ selectedSymbol = 'EURUSD' }: EconomicCalendarProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [impactFilter, setImpactFilter] = useState<'all' | 'high' | 'med_high'>('all');
  const [pairFilterOnly, setPairFilterOnly] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const baseCurrency = selectedSymbol.slice(0, 3).toUpperCase();
  const quoteCurrency = selectedSymbol.slice(3, 6).toUpperCase();

  const fetchCalendar = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/market/calendar');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setEvents(json.data);
        setLastRefreshed(new Date());
      }
    } catch (e) {
      console.warn('Failed to fetch economic calendar:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendar();
    const interval = setInterval(fetchCalendar, 5 * 60 * 1000); // 5 min
    return () => clearInterval(interval);
  }, []);

  const filteredEvents = events.filter((ev) => {
    if (impactFilter === 'high' && ev.impact !== 'High') return false;
    if (impactFilter === 'med_high' && ev.impact !== 'High' && ev.impact !== 'Medium') return false;
    if (pairFilterOnly && ev.country !== baseCurrency && ev.country !== quoteCurrency) return false;
    return true;
  });

  const getImpactBadge = (impact: string) => {
    switch (impact) {
      case 'High':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            HIGH
          </span>
        );
      case 'Medium':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            MED
          </span>
        );
      case 'Holiday':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
            HOLIDAY
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
            LOW
          </span>
        );
    }
  };

  // Find next upcoming high-impact event
  const nextHighImpact = events.find((e) => e.impact === 'High');

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold font-mono tracking-tight text-zinc-100 flex items-center gap-1.5">
              ForexFactory Economic Calendar
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-emerald-400 font-mono">LIVE FEED</span>
            </h2>
            <p className="text-[10px] text-zinc-400 font-sans">
              High-volatility central bank decisions & macro releases
            </p>
          </div>
        </div>

        <button
          onClick={fetchCalendar}
          disabled={loading}
          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          title="Refresh economic calendar"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Next Upcoming Highlight Banner */}
      {nextHighImpact && (
        <div className="bg-gradient-to-r from-rose-950/40 via-zinc-900 to-zinc-900 border border-rose-500/30 rounded-lg p-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <div className="text-[10px]">
              <span className="font-bold text-rose-300">Upcoming High Impact:</span>{' '}
              <span className="text-zinc-200">{nextHighImpact.country} - {nextHighImpact.title}</span>
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-400 whitespace-nowrap">
            Fcst: <span className="text-zinc-200 font-bold">{nextHighImpact.forecast}</span>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
          <button
            onClick={() => setImpactFilter('all')}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              impactFilter === 'all' ? 'bg-zinc-800 text-zinc-100 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All Impact
          </button>
          <button
            onClick={() => setImpactFilter('med_high')}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              impactFilter === 'med_high' ? 'bg-amber-950/60 text-amber-300 border border-amber-600/40 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Med+High
          </button>
          <button
            onClick={() => setImpactFilter('high')}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              impactFilter === 'high' ? 'bg-rose-950/60 text-rose-300 border border-rose-600/40 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            High Only
          </button>
        </div>

        <button
          onClick={() => setPairFilterOnly(!pairFilterOnly)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
            pairFilterOnly
              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40 font-bold'
              : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
          }`}
        >
          <Filter className="w-3 h-3" />
          <span>{baseCurrency}/{quoteCurrency} Only</span>
        </button>
      </div>

      {/* Event List Table */}
      <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-zinc-800/80 bg-zinc-950">
        <table className="w-full text-left text-[11px] font-mono">
          <thead className="bg-zinc-900/90 text-zinc-400 text-[9px] uppercase tracking-wider sticky top-0 border-b border-zinc-800">
            <tr>
              <th className="py-2 px-2.5">Time / Date</th>
              <th className="py-2 px-2">Ccy</th>
              <th className="py-2 px-2">Impact</th>
              <th className="py-2 px-3">Event</th>
              <th className="py-2 px-2 text-right">Forecast</th>
              <th className="py-2 px-2 text-right">Prior</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-zinc-500 text-xs">
                  {loading
                    ? 'Fetching ForexFactory feed...'
                    : (events.length === 0
                        ? 'Economic calendar feed currently synchronizing with ForexFactory.'
                        : 'No economic events match current filters.')}
                </td>
              </tr>
            ) : (
              filteredEvents.map((ev, idx) => {
                const dateObj = new Date(ev.date);
                const timeStr = !isNaN(dateObj.getTime())
                  ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
                  : '—';
                const dayStr = !isNaN(dateObj.getTime())
                  ? dateObj.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })
                  : '—';

                const isCurrentPair = ev.country === baseCurrency || ev.country === quoteCurrency;

                return (
                  <tr
                    key={idx}
                    className={`hover:bg-zinc-900/50 transition-colors ${
                      isCurrentPair ? 'bg-emerald-950/10' : ''
                    }`}
                  >
                    <td className="py-2 px-2.5 whitespace-nowrap text-zinc-400 text-[10px]">
                      <span className="font-bold text-zinc-200">{timeStr}</span>
                      <span className="block text-[8px] text-zinc-500">{dayStr}</span>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        isCurrentPair ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-300'
                      }`}>
                        {ev.country}
                      </span>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      {getImpactBadge(ev.impact)}
                    </td>
                    <td className="py-2 px-3 text-zinc-200 font-sans text-xs">
                      {ev.title}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-zinc-200 whitespace-nowrap">
                      {ev.forecast}
                    </td>
                    <td className="py-2 px-2 text-right text-zinc-400 whitespace-nowrap text-[10px]">
                      {ev.previous}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
