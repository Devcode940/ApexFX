export const CALENDAR_SOURCE_URL = 'https://www.forexfactory.com/calendar';
export const CALENDAR_REFRESH_MS = 3_600_000;
export const CALENDAR_MAX_AGE_MS = 8 * 86400_000;
export const CALENDAR_IMPACTS = ['HIGH', 'MEDIUM', 'LOW', 'HOLIDAY', 'UNKNOWN'] as const;
export type CalendarImpact = typeof CALENDAR_IMPACTS[number];
export interface CalendarEvent {
  id: string; title: string; currency: string; impact: CalendarImpact;
  scheduledAt: number | null; sourceDate: string | null;
  timing: 'scheduled' | 'all-day' | 'tentative' | 'unknown';
  forecast: string | null; previous: string | null; actual: string | null;
}
export interface CalendarSnapshot { version: 1; fetchedAt: number; events: CalendarEvent[]; etag?: string }
export interface WeeklyCalendarResponse {
  success: true; source: 'forexfactory'; sourceUrl: string; fetchedAt: number; expiresAt: number;
  stale: boolean; currentWeek: boolean | null; weekStart: string; coverageStart: number | null; coverageEnd: number | null;
  events: CalendarEvent[]; warning: string | null;
}
const sourceDateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Preserve a valid source civil date without assigning a timezone or an exact release time. */
export function calendarSourceDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const day = value.slice(0, 10); const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day ? day : null;
}
/** An explicit source offset is required. Ambiguous local/date-only times are never assumed UTC. */
export function calendarSourceTimestamp(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return calendarSourceDay(value) !== null && Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}
/** Forex Factory's source-week convention, independent of the viewer's local timezone. */
export function forexFactoryWeekStart(time: number): string {
  const parts = sourceDateFormat.formatToParts(time);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  const date = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}
export function calendarEventAffects(event: CalendarEvent, symbol: string): boolean {
  return event.currency === 'ALL' || [symbol.slice(0, 3), symbol.slice(3)].includes(event.currency);
}
export function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as CalendarEvent;
  return typeof row.id === 'string' && /^[a-f0-9]{24}$/.test(row.id) && typeof row.title === 'string' && row.title.length > 0 && row.title.length <= 300 &&
    typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) && CALENDAR_IMPACTS.includes(row.impact) &&
    (row.scheduledAt === null || (Number.isSafeInteger(row.scheduledAt) && row.scheduledAt > 0 && row.scheduledAt < 8640000000000000)) &&
    (row.sourceDate === null || (typeof row.sourceDate === 'string' && row.sourceDate.length <= 80)) &&
    ['scheduled', 'all-day', 'tentative', 'unknown'].includes(row.timing) &&
    (row.timing === 'scheduled' ? row.scheduledAt !== null : row.scheduledAt === null) &&
    [row.forecast, row.previous, row.actual].every(v => v === null || (typeof v === 'string' && v.length <= 120));
}
export function calendarResponse(snapshot: CalendarSnapshot, now = Date.now(), warning: string | null = null): WeeklyCalendarResponse {
  const weekStart = forexFactoryWeekStart(now);
  const dates = snapshot.events.flatMap(e => { const date = e.scheduledAt ?? calendarSourceTimestamp(e.sourceDate); return date === null ? [] : [date]; });
  const weeks = new Set(dates.map(forexFactoryWeekStart));
  const currentWeek = dates.length ? weeks.size === 1 && weeks.has(weekStart) : null;
  const stale = now - snapshot.fetchedAt >= CALENDAR_REFRESH_MS || currentWeek === false;
  return { success: true, source: 'forexfactory', sourceUrl: CALENDAR_SOURCE_URL, fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.fetchedAt + CALENDAR_REFRESH_MS, stale, currentWeek, weekStart,
    coverageStart: dates.length ? Math.min(...dates) : null, coverageEnd: dates.length ? Math.max(...dates) : null,
    events: snapshot.events, warning: warning ?? (currentWeek === false ? 'The exported events are not for the current source week. Check Forex Factory for the latest schedule.' : stale ? 'Showing an older calendar snapshot.' : null) };
}
