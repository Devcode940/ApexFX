import crypto from 'node:crypto';
import { fetchWithTimeout, fetchJsonWithTimeout } from '../lib/fetch';
import { singleFlight } from '../lib/singleFlight';
import { CALENDAR_REFRESH_MS, CALENDAR_MAX_AGE_MS, calendarResponse, calendarSourceTimestamp, isCalendarEvent, type CalendarEvent, type CalendarSnapshot, type WeeklyCalendarResponse, type CalendarImpact } from '../../shared/calendar';

export const FOREX_FACTORY_FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const text = (value: unknown, limit = 120): string | null => (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) && String(value).trim() ? String(value).trim().slice(0, limit) : null;
export class CalendarError extends Error {
  constructor(message: string, readonly code = 'CALENDAR_UNAVAILABLE', readonly retryAfterSeconds = 60) { super(message); }
}
/** Parse the public weekly export, not site HTML. Missing actuals/times remain unknown. */
export function parseForexFactoryEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value) || value.length > 2000) throw new CalendarError('Invalid Forex Factory calendar export.');
  const events = new Map<string, CalendarEvent>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || !raw.title.trim() || typeof raw.country !== 'string') throw new CalendarError('Invalid Forex Factory event.');
    const title = raw.title.trim().slice(0, 300);
    const currency = raw.country.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new CalendarError('Invalid Forex Factory event currency.');
    const label = String(raw.impact ?? '').toUpperCase();
    const impact: CalendarImpact = ['HIGH', 'MEDIUM', 'LOW', 'HOLIDAY'].includes(label) ? label as CalendarImpact : 'UNKNOWN';
    const sourceDate = text(raw.date, 80);
    const datedAt = calendarSourceTimestamp(sourceDate);
    const rawTime = String(raw.time ?? '').toLowerCase();
    const timing = impact === 'HOLIDAY' || rawTime.includes('all day') ? 'all-day' : rawTime.includes('tentative') ? 'tentative' : /tba|to be announced/.test(rawTime) || datedAt === null ? 'unknown' : 'scheduled';
    const scheduledAt = timing === 'scheduled' ? datedAt : null;
    const id = crypto.createHash('sha256').update(JSON.stringify([title, currency, sourceDate, timing])).digest('hex').slice(0, 24);
    events.set(id, { id, title, currency, impact, scheduledAt, sourceDate, timing, forecast: text(raw.forecast), previous: text(raw.previous), actual: text(raw.actual) });
  }
  return [...events.values()].sort((a, b) => (a.scheduledAt ?? Infinity) - (b.scheduledAt ?? Infinity) || a.currency.localeCompare(b.currency) || a.title.localeCompare(b.title));
}
function snapshotFrom(value: unknown): CalendarSnapshot | null {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new CalendarError('Calendar cache contains invalid JSON.'); } }
  if (value === null) return null;
  const s = value as CalendarSnapshot;
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.fetchedAt) || s.fetchedAt <= 0 || s.fetchedAt > Date.now() + 5000 || !Array.isArray(s.events) || s.events.length > 2000 || !s.events.every(isCalendarEvent)) throw new CalendarError('Calendar cache is invalid.');
  return s;
}
export interface CalendarStore {
  read(): Promise<CalendarSnapshot | null>;
  /** Atomic across replicas. Includes failures: do not delete this hourly lease after an error. */
  claimRefresh(until: number): Promise<boolean>;
  save(snapshot: CalendarSnapshot): Promise<void>;
  postponeRefresh(until: number): Promise<void>;
}
const CACHE_KEY = '{apexfx:forexfactory}:thisweek:v1';
const LEASE_KEY = '{apexfx:forexfactory}:refresh:v1';
async function redis(command: (string | number)[]) {
  const data = await fetchJsonWithTimeout(process.env.UPSTASH_REDIS_REST_URL!, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), timeoutMs: 2500, maxBytes: 1024 * 1024,
  });
  if (data?.error || data?.result === undefined) throw new CalendarError('Shared calendar cache unavailable.');
  return data.result;
}
export function redisCalendarStore(): CalendarStore | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return {
    read: async () => snapshotFrom(await redis(['GET', CACHE_KEY])),
    claimRefresh: async until => (await redis(['SET', LEASE_KEY, String(until), 'NX', 'PX', Math.max(1000, until - Date.now())])) === 'OK',
    save: async snapshot => { if (await redis(['SET', CACHE_KEY, JSON.stringify(snapshot), 'PX', CALENDAR_MAX_AGE_MS]) !== 'OK') throw new CalendarError('Could not save shared calendar cache.'); },
    postponeRefresh: async until => { await redis(['EVAL', "local old = tonumber(redis.call('GET', KEYS[1]) or '0'); if tonumber(ARGV[1]) > old then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]); end; return 1", 1, LEASE_KEY, until, Math.max(1000, until - Date.now())]); },
  };
}
/** One hourly request on a persistent Node process, or one atomic lease across serverless replicas.
 * Failed/HTML/throttled fetches keep last-known-good data and do NOT trigger rapid retries.
 */
export class ForexFactoryCalendar {
  private snapshot: CalendarSnapshot | null = null;
  private notBefore = 0;
  private sharedCheckedAt = 0;
  private warning: string | null = null;
  constructor(private readonly fetchExport: typeof fetchWithTimeout = fetchWithTimeout, private readonly namespace = crypto.randomUUID()) {}
  async get(store: CalendarStore | null, requireShared = false): Promise<WeeklyCalendarResponse> {
    return singleFlight(`forexfactory:${this.namespace}`, async () => {
      if (requireShared && !store) throw new CalendarError('Configure the required shared Redis cache for the weekly calendar.', 'CALENDAR_CACHE_NOT_CONFIGURED', 3600);
      const now = Date.now();
      const usable = () => this.snapshot && Date.now() - this.snapshot.fetchedAt < CALENDAR_MAX_AGE_MS;
      const respond = () => calendarResponse(this.snapshot!, Date.now(), this.warning);
      if (usable() && now - this.snapshot!.fetchedAt < CALENDAR_REFRESH_MS) return respond();
      try {
        // Bound Redis reads during failures too, without treating a failed cache as permission to fetch.
        if (store && now - this.sharedCheckedAt >= 30_000) {
          this.sharedCheckedAt = now; const saved = await store.read();
          if (saved && (!this.snapshot || saved.fetchedAt > this.snapshot.fetchedAt)) { this.snapshot = saved; this.warning = null; }
          if (usable() && now - this.snapshot!.fetchedAt < CALENDAR_REFRESH_MS) return respond();
        }
        if (now < this.notBefore) {
          if (usable()) return respond();
          throw new CalendarError('Calendar unavailable; waiting before another export request.', 'CALENDAR_COOLDOWN', Math.max(1, Math.ceil((this.notBefore - now) / 1000)));
        }
        this.notBefore = now + CALENDAR_REFRESH_MS;
        if (store && !await store.claimRefresh(this.notBefore)) {
          this.notBefore = now + 60_000; // re-read the shared result later; never bypass the source lease
          if (usable()) { this.warning = 'Using cached calendar while a shared refresh is pending or cooling down.'; return respond(); }
          throw new CalendarError('Weekly calendar refresh is pending or cooling down. Retry later.');
        }
        const old = this.snapshot;
        const etag = typeof old?.etag === 'string' && old.etag.length < 200 && !/[\r\n]/.test(old.etag) ? old.etag : null;
        const response = await this.fetchExport(FOREX_FACTORY_FEED, { timeoutMs: 8000, maxBytes: 512_000,
          headers: { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) } });
        let next: CalendarSnapshot;
        if (response.status === 304 && old) next = { ...old, fetchedAt: Date.now() };
        else {
          if (!response.ok) {
            const retry = response.headers.get('Retry-After'); const seconds = Number(retry);
            const delay = retry ? Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now() : 0;
            this.notBefore = Math.max(this.notBefore, Date.now() + (Number.isFinite(delay) ? delay : 0));
            if (store) await store.postponeRefresh(this.notBefore);
            throw new CalendarError('Forex Factory export is unavailable or rate-limited.');
          }
          if ((response.headers.get('content-type') ?? '').includes('text/html')) throw new CalendarError('Forex Factory returned an HTML page instead of its calendar export.');
          let raw: unknown;
          try { raw = await response.json(); } catch { throw new CalendarError('Forex Factory returned an invalid calendar export.'); }
          next = { version: 1, fetchedAt: Date.now(), events: parseForexFactoryEvents(raw), etag: response.headers.get('etag') ?? undefined };
        }
        this.snapshot = next; this.warning = null;
        if (store) await store.save(next);
        return respond();
      } catch (error) {
        if (this.notBefore <= now) this.notBefore = now + 60_000;
        this.warning = error instanceof CalendarError ? error.message : 'Weekly calendar update failed; cached data may be out of date.';
        if (usable()) return respond();
        throw new CalendarError(this.warning, error instanceof CalendarError ? error.code : 'CALENDAR_UNAVAILABLE',
          Math.max(1, Math.ceil((this.notBefore - Date.now()) / 1000), error instanceof CalendarError ? error.retryAfterSeconds : 60));
      }
    });
  }
}
const calendar = new ForexFactoryCalendar();
export async function getWeeklyCalendar(): Promise<WeeklyCalendarResponse> {
  if (process.env.MARKET_DATA_MODE === 'offline' || process.env.FOREX_FACTORY_ENABLED === 'false') throw new CalendarError('Weekly calendar disabled by the operator.', 'CALENDAR_DISABLED', 3600);
  return calendar.get(redisCalendarStore(), !!process.env.VERCEL || process.env.FOREX_FACTORY_REQUIRE_SHARED === 'true');
}
