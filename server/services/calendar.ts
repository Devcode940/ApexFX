import { fetchWithTimeout } from '../lib/fetch';
import { log, warn } from '../lib/logger';

export interface CalendarEvent {
  title: string;
  country: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
}

let cachedCalendar: CalendarEvent[] = [];
let lastFetchedAt = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min TTL

export async function fetchEconomicCalendar(): Promise<CalendarEvent[]> {
  const now = Date.now();
  if (cachedCalendar.length > 0 && now - lastFetchedAt < CACHE_TTL_MS) {
    return cachedCalendar;
  }

  try {
    const res = await fetchWithTimeout('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      timeoutMs: 7000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`ForexFactory HTTP ${res.status}`);
    }

    const data = (await res.json()) as any[];
    if (Array.isArray(data)) {
      cachedCalendar = data.map((ev) => ({
        title: String(ev.title || 'Economic Event'),
        country: String(ev.country || 'USD').toUpperCase(),
        date: String(ev.date || new Date().toISOString()),
        impact: (['High', 'Medium', 'Low', 'Holiday'].includes(ev.impact) ? ev.impact : 'Low') as any,
        forecast: String(ev.forecast || '—'),
        previous: String(ev.previous || '—'),
      }));
      lastFetchedAt = now;
      log(`[Calendar] Refreshed ${cachedCalendar.length} economic events from ForexFactory`);
    }
    return cachedCalendar;
  } catch (err: any) {
    warn('[Calendar] ForexFactory feed unavailable:', err.message);
    // Return existing valid cached events if available; never fabricate synthetic economic prints
    if (cachedCalendar.length > 0) {
      return cachedCalendar;
    }
    return [];
  }
}
