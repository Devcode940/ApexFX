import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, AlertTriangle, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import { useTrading } from '../context/TradingContext';
import { useWeeklyCalendar } from '../hooks/useWeeklyCalendar';
import { calendarEventAffects, calendarResponse, calendarSourceDay, CALENDAR_SOURCE_URL, type CalendarImpact, type CalendarEvent } from '../../shared/calendar';

const impactStyle: Record<CalendarImpact, string> = {
  HIGH: 'border-rose-900 bg-rose-950/50 text-rose-300', MEDIUM: 'border-amber-900 bg-amber-950/40 text-amber-300',
  LOW: 'border-sky-900 bg-sky-950/30 text-sky-300', HOLIDAY: 'border-zinc-700 bg-zinc-800 text-zinc-300', UNKNOWN: 'border-zinc-700 text-zinc-400',
};
export const WeeklyCalendar: React.FC = React.memo(() => {
  const { selectedSymbol } = useTrading();
  const { data, loading, error, retry, retryAt } = useWeeklyCalendar();
  const [currencies, setCurrencies] = useState<'pair' | 'all'>('pair');
  const [highOnly, setHighOnly] = useState(false);
  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const [utc, setUtc] = useState(false);
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const zone = useMemo(() => utc ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', [utc]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }), [zone]);
  const sourceDayFormat = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }), []);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit' }), [zone]);
  const current = useMemo(() => data ? calendarResponse({ version: 1, fetchedAt: data.fetchedAt, events: data.events }, now, data.warning) : null, [data, now]);
  const events = useMemo(() => (data?.events ?? []).filter(event =>
    (currencies === 'all' || calendarEventAffects(event, selectedSymbol)) && (!highOnly || event.impact === 'HIGH') &&
    (!upcomingOnly || event.scheduledAt === null || event.scheduledAt >= now)), [data, currencies, selectedSymbol, highOnly, upcomingOnly, now]);
  useEffect(() => setPage(1), [selectedSymbol, currencies, highOnly, upcomingOnly, data?.fetchedAt]);
  const totalPages = Math.max(1, Math.ceil(events.length / 6));
  const shownPage = Math.min(page, totalPages);
  const shown = events.slice((shownPage - 1) * 6, shownPage * 6);
  const eventDate = (event: CalendarEvent) => {
    if (event.scheduledAt !== null) return dateFormat.format(event.scheduledAt);
    const day = calendarSourceDay(event.sourceDate);
    return day ? sourceDayFormat.format(Date.parse(`${day}T00:00:00Z`)) : 'Date unavailable';
  };
  const button = 'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:text-white disabled:opacity-40';
  return <section id="weekly_calendar_component" className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
    <div className="flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><CalendarDays size={16} className="text-emerald-400" />Weekly Economic Calendar</h2>
      <span className="text-[10px] uppercase text-zinc-400">{loading ? 'Loading' : error ? 'Update failed' : current?.stale ? 'Cached / stale' : data ? 'Weekly export' : 'Unavailable'}</span>
    </div>
    <div className="space-y-2 border-b border-zinc-800 px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a className="inline-flex items-center gap-1 text-emerald-400" href={CALENDAR_SOURCE_URL} target="_blank" rel="noopener noreferrer">Forex Factory <ExternalLink size={12} /></a>
        <button className={button} onClick={retry} disabled={loading || retryAt > now} title={retryAt > now ? `Retry after ${timeFormat.format(retryAt)} ${zone}` : 'Revalidate the cached weekly export'} aria-label="Refresh weekly calendar">{loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button>
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-zinc-300">
        <label className="flex items-center gap-1">Currencies
          <select className="rounded bg-zinc-900 p-1" value={currencies} onChange={e => setCurrencies(e.target.value as 'pair' | 'all')}>
            <option value="pair">{selectedSymbol.slice(0, 3)}/{selectedSymbol.slice(3)}</option><option value="all">All currencies</option>
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={highOnly} onChange={e => setHighOnly(e.target.checked)} />High impact</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={upcomingOnly} onChange={e => setUpcomingOnly(e.target.checked)} />Upcoming / untimed</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={utc} onChange={e => setUtc(e.target.checked)} />UTC</label>
      </div>
      <p className="text-[10px] text-zinc-500">Times: {zone}; untimed events keep the source date. Source week starts Sunday in New York; chart W candles use Monday UTC.</p>
      {current && <p className="text-[10px] text-zinc-500">Retrieved {dateFormat.format(current.fetchedAt)} {timeFormat.format(current.fetchedAt)} · {current.coverageStart && current.coverageEnd ? `${dateFormat.format(current.coverageStart)} – ${dateFormat.format(current.coverageEnd)}` : 'Coverage timestamps unavailable'}</p>}
      <p className="text-[10px] text-zinc-500">Hourly cached export, not a live release feed. Actual/forecast/previous values are shown only when supplied; impact is the provider’s rating.</p>
    </div>
    {(error || current?.warning) && <div role="status" className="mx-4 mt-3 flex gap-2 rounded border border-amber-900 bg-amber-950/20 p-2 text-[11px] text-amber-200"><AlertTriangle size={14} className="shrink-0" /><span>{error ?? current?.warning}</span></div>}
    <div className="flex-1 space-y-2 overflow-y-auto p-4">
      {!loading && !error && !events.length && <p className="py-5 text-center text-xs text-zinc-500">{data?.events.length ? 'No events match these filters.' : 'No events were supplied in the weekly export.'}</p>}
      {shown.map(event => <article key={event.id} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <div className="flex items-center gap-2"><span className="font-semibold text-zinc-200">{event.currency}</span><span className={`rounded border px-1.5 py-0.5 ${impactStyle[event.impact]}`}>{event.impact}</span></div>
          <span className="text-zinc-400" title={event.sourceDate ?? 'No unambiguous source timestamp'}>{eventDate(event)} · {event.timing === 'all-day' ? 'All day' : event.timing === 'tentative' ? 'Tentative' : event.scheduledAt ? timeFormat.format(event.scheduledAt) : 'Time TBA'}</span>
        </div>
        <h3 className="text-xs font-medium text-zinc-200">{event.title}</h3>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-zinc-400">
          <div><dt>Actual</dt><dd className="break-words font-mono text-zinc-200">{event.actual ?? '—'}</dd></div>
          <div><dt>Forecast</dt><dd className="break-words font-mono text-zinc-200">{event.forecast ?? '—'}</dd></div>
          <div><dt>Previous</dt><dd className="break-words font-mono text-zinc-200">{event.previous ?? '—'}</dd></div>
        </dl>
        {event.scheduledAt !== null && event.scheduledAt < now && event.timing === 'scheduled' && <p className="mt-2 text-[9px] text-zinc-500">Scheduled time passed · check the source for release/revision details.</p>}
      </article>)}
      {events.length > 0 && <nav aria-label="Weekly calendar pages" className="flex items-center justify-between pt-2">
        <button className={button} disabled={shownPage === 1} onClick={() => setPage(shownPage - 1)}>Previous</button>
        <span className="text-[10px] text-zinc-500">{events.length} events · {shownPage}/{totalPages}</span>
        <button className={button} disabled={shownPage === totalPages} onClick={() => setPage(shownPage + 1)}>Next</button>
      </nav>}
    </div>
  </section>;
});
