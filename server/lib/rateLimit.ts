import { fetchJsonWithTimeout } from './fetch';

/**
 * Improved in-memory sliding window rate limiter with periodic cleanup
 * and optional Upstash Redis fallback for serverless.
 *
 * If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set,
 * it will use Upstash for distributed limiting. Otherwise falls back to memory.
 */

type Bucket = number[];

const buckets = new Map<string, Bucket>();
const CHAT_BUCKETS = new Map<string, Bucket>();

const DEFAULT_MAX = 30;
const DEFAULT_WINDOW_MS = 60_000;

const CHAT_MAX = 10;
const CHAT_WINDOW_MS = 60_000;

// Request-driven pruning: importing the API creates no timer/background work.
let lastPrunedAt = 0;
function prune(now: number) {
  if (now - lastPrunedAt < 60_000 && buckets.size < 10_000 && CHAT_BUCKETS.size < 10_000) return;
  lastPrunedAt = now;
  for (const map of [buckets, CHAT_BUCKETS]) {
    for (const [key, hits] of map) if (!hits.length || hits[hits.length - 1] < now - 120_000) map.delete(key);
  }
}

function isRateLimitedMemory(
  map: Map<string, Bucket>,
  key: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  prune(now);
  if (map.size >= 10_000 && !map.has(key)) return true;
  const cutoff = now - windowMs;
  const existing = map.get(key) || [];
  const hits = existing.filter((t) => t > cutoff);
  if (hits.length >= max) {
    map.set(key, hits);
    return true;
  }
  hits.push(now);
  map.set(key, hits);
  return false;
}

// Optional Upstash distributed limiter
async function isRateLimitedUpstash(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false; // fallback handled by caller

  const windowId = Math.floor(Date.now() / windowMs);
  const redisKey = `ratelimit:${key}:${windowId}`;
  try {
    const data = await fetchJsonWithTimeout(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeoutMs: 2000, maxBytes: 16_000,
      body: JSON.stringify(['EVAL', "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n", 1, redisKey, Math.ceil(windowMs / 1000)]),
    });
    return Number(data?.result) > max;
  } catch {
    // Free/read API protection still has the bounded memory limiter below. PAID work has its own
    // fail-CLOSED transactional budget; it must never use this availability-oriented fallback.
    return false;
  }
}

/**
 * Per-endpoint budgets. A single global 30/min bucket was the wrong shape for this app: the
 * watchlist poll alone is ~24/min per tab, so the fallback feed plus a chart load plus a quote
 * cross-check tipped a *single legitimate browser tab* over the limit, and 429s were then
 * swallowed client-side (prices just froze with no explanation). Cheap/cached endpoints get more
 * headroom; the endpoints that cost real money (Twelve Data credits) get less.
 */
export const RATE_LIMIT_POLICIES: Array<{ match: (path: string) => boolean; max: number; windowMs: number; label: string }> = [
  { match: (p) => ['/api/health', '/api/ready', '/api/live', '/healthz', '/api/capabilities'].includes(p), max: 120, windowMs: 60_000, label: 'health' },
  { match: (p) => p.startsWith('/api/market/prices'), max: 60, windowMs: 60_000, label: 'prices' },
  { match: (p) => p.startsWith('/api/market/history'), max: 20, windowMs: 60_000, label: 'history' },
  // Spends upstream API credits: throttle hardest.
  { match: (p) => p.startsWith('/api/market/quote'), max: 10, windowMs: 60_000, label: 'quote' },
  { match: (p) => p.startsWith('/api/market/forexrate'), max: 10, windowMs: 60_000, label: 'forexrate' },
  { match: (p) => p.startsWith('/api/market/calendar'), max: 12, windowMs: 60_000, label: 'calendar' },
  { match: (p) => p.startsWith('/api/market/news'), max: 15, windowMs: 60_000, label: 'news' },
  { match: (p) => p.startsWith('/api/ws/token'), max: 20, windowMs: 60_000, label: 'ws-token' },
];

/**
 * Resolve the policy for a request. Uses originalUrl, NOT req.path: inside
 * `app.use('/api', mw)` Express rewrites req.path relative to the mount point ('/market/prices'),
 * which made every policy below fall through to the default bucket. Caught by a live probe, not by
 * the pure-function test - a nice argument for both kinds.
 */
export function requestPath(req: { originalUrl?: string; path?: string; baseUrl?: string }): string {
  const raw = req.originalUrl || `${req.baseUrl || ''}${req.path || ''}` || '/';
  return raw.split('?')[0];
}

export function policyForRequest(req: { originalUrl?: string; path?: string; baseUrl?: string }): { max: number; windowMs: number; label: string } {
  return policyForPath(requestPath(req));
}

export function policyForPath(path: string): { max: number; windowMs: number; label: string } {
  const hit = RATE_LIMIT_POLICIES.find((p) => p.match(path));
  return hit ? { max: hit.max, windowMs: hit.windowMs, label: hit.label } : { max: DEFAULT_MAX, windowMs: DEFAULT_WINDOW_MS, label: 'default' };
}

/** Seconds until the window frees up, for Retry-After. */
export function retryAfterSeconds(key: string, windowMs: number): number {
  const hits = buckets.get(key);
  if (!hits || hits.length === 0) return Math.ceil(windowMs / 1000);
  const oldest = hits[0];
  return Math.max(1, Math.ceil((oldest + windowMs - Date.now()) / 1000));
}

export async function isRateLimited(
  key: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS
): Promise<boolean> {
  // Try Upstash first if configured
  if (process.env.UPSTASH_REDIS_REST_URL) {
    const limited = await isRateLimitedUpstash(key, max, windowMs);
    if (limited) return true;
    // Still also track in memory as secondary
  }
  return isRateLimitedMemory(buckets, key, max, windowMs);
}

export function isChatRateLimited(key: string): boolean {
  return isRateLimitedMemory(CHAT_BUCKETS, key, CHAT_MAX, CHAT_WINDOW_MS);
}

// For testing / manual reset
export function clearAllBuckets() {
  buckets.clear();
  CHAT_BUCKETS.clear();
}

export function getBucketStats() {
  return {
    apiBuckets: buckets.size,
    chatBuckets: CHAT_BUCKETS.size,
  };
}
