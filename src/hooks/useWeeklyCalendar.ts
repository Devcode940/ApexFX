import { useCallback, useEffect, useRef, useState } from 'react';
import { CALENDAR_REFRESH_MS, calendarResponse, isCalendarEvent, type WeeklyCalendarResponse } from '../../shared/calendar';

/** The browser revalidates ONE weekly export; symbol/impact filters never trigger upstream work. */
export function useWeeklyCalendar() {
  const [data, setData] = useState<WeeklyCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const retryAfter = useRef(0);
  const retry = useCallback(() => { if (Date.now() >= retryAfter.current) setAttempt(n => n + 1); }, []);
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let nextAt = retryAfter.current;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(pollTimer);
      if (!cancelled) pollTimer = setTimeout(() => { if (!document.hidden) void load(); else schedule(); }, Math.min(2_147_000_000, Math.max(60_000, nextAt - Date.now())));
    };
    async function load() {
      if (cancelled || inFlight) return;
      if (Date.now() < retryAfter.current) { nextAt = retryAfter.current; schedule(); return; }
      inFlight = true; controller = new AbortController();
      deadline = setTimeout(() => controller?.abort(), 15_000);
      setLoading(true); setError(null);
      try {
        const response = await fetch('/api/market/calendar?week=this', { signal: controller.signal });
        if (cancelled) return;
        // Respect Retry-After even if an intermediary's error body is not JSON. Manual retry
        // and visibility changes must not reset the deadline the server has just supplied.
        if (!response.ok) {
          const header = response.headers.get('Retry-After'); const seconds = Number(header);
          const minimum = header ? Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now() : 0;
          nextAt = Date.now() + Math.max(60_000, Number.isFinite(minimum) ? minimum : 0);
          retryAfter.current = nextAt; setRetryAt(nextAt);
        }
        let raw: unknown;
        try { raw = await response.json(); } catch { throw new Error('Weekly calendar returned an invalid response.'); }
        if (cancelled) return;
        if (controller.signal.aborted) throw new Error('Calendar request timed out.');
        if (!raw || typeof raw !== 'object') throw new Error('Invalid weekly calendar response.');
        const value = raw as Record<string, unknown>;
        if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error.slice(0, 300) : 'Weekly calendar unavailable.');
        if (!['forexfactory', 'demo'].includes(String(value.source)) || value.success !== true || typeof value.fetchedAt !== 'number' || !Number.isSafeInteger(value.fetchedAt) || value.fetchedAt <= 0 || value.fetchedAt > Date.now() + 5000 || !Array.isArray(value.events) || value.events.length > 2000 || !value.events.every(isCalendarEvent)) throw new Error('Invalid weekly calendar response.');
        const result = calendarResponse({ version: 1, fetchedAt: value.fetchedAt, events: value.events }, Date.now(), typeof value.warning === 'string' ? value.warning.slice(0, 400) : null, value.source === 'demo' ? 'demo' : 'forexfactory');
        setData(result); retryAfter.current = 0; setRetryAt(0);
        nextAt = Date.now() + (result.stale ? 5 * 60_000 : Math.max(60_000, CALENDAR_REFRESH_MS - (Date.now() - result.fetchedAt)));
      } catch (error) {
        if (!cancelled) setError(controller.signal.aborted ? 'Weekly calendar request timed out. Retry later.' : error instanceof Error ? error.message : 'Weekly calendar unavailable.');
        nextAt = Math.max(nextAt, Date.now() + 60_000);
      } finally {
        clearTimeout(deadline); inFlight = false;
        if (!cancelled) { setLoading(false); schedule(); }
      }
    }
    const visible = () => { if (!document.hidden && Date.now() >= nextAt) void load(); };
    document.addEventListener('visibilitychange', visible);
    void load();
    return () => { cancelled = true; controller?.abort(); clearTimeout(deadline); clearTimeout(pollTimer); document.removeEventListener('visibilitychange', visible); };
  }, [attempt]);
  return { data, loading, error, retry, retryAt };
}
