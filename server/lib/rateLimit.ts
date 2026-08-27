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

export function isRateLimitedSync(
  key: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS
): boolean {
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
