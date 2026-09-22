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

// Cleanup every 5 minutes: remove buckets with no recent hits
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const cutoff = now - DEFAULT_WINDOW_MS * 2;
    for (const [key, hits] of buckets) {
      const filtered = hits.filter((t) => t > cutoff);
      if (filtered.length === 0) buckets.delete(key);
      else buckets.set(key, filtered);
    }
    const chatCutoff = now - CHAT_WINDOW_MS * 2;
    for (const [key, hits] of CHAT_BUCKETS) {
      const filtered = hits.filter((t) => t > chatCutoff);
      if (filtered.length === 0) CHAT_BUCKETS.delete(key);
      else CHAT_BUCKETS.set(key, filtered);
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent process exit
  if (cleanupTimer && typeof (cleanupTimer as any).unref === 'function') {
    (cleanupTimer as any).unref();
  }
}

startCleanup();

function isRateLimitedMemory(
  map: Map<string, Bucket>,
  key: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
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

  // Use fixed window counter via INCR + EXPIRE
  // Key format: ratelimit:<key>:<window>
  const windowId = Math.floor(Date.now() / windowMs);
  const redisKey = `ratelimit:${key}:${windowId}`;

  try {
    const res = await fetch(`${url}/incr/${encodeURIComponent(redisKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { result: number };
    const count = data.result || 0;

    if (count === 1) {
      // Set expiry to windowMs in seconds
      await fetch(`${url}/expire/${encodeURIComponent(redisKey)}/${Math.ceil(windowMs / 1000)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000),
      });
    }

    return count > max;
  } catch {
    // On Upstash failure, fallback to allow (fail open) to avoid blocking
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
  { match: (p) => p === '/api/health' || p === '/healthz', max: 120, windowMs: 60_000, label: 'health' },
  { match: (p) => p.startsWith('/api/market/prices'), max: 60, windowMs: 60_000, label: 'prices' },
  { match: (p) => p.startsWith('/api/market/history'), max: 20, windowMs: 60_000, label: 'history' },
  // Spends upstream API credits: throttle hardest.
  { match: (p) => p.startsWith('/api/market/quote'), max: 10, windowMs: 60_000, label: 'quote' },
  { match: (p) => p.startsWith('/api/market/forexrate'), max: 10, windowMs: 60_000, label: 'forexrate' },
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
