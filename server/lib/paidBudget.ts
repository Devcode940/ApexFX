import crypto from 'node:crypto';
import { fetchJsonWithTimeout } from './fetch';

export interface BudgetLimits {
  globalRequests: number; accountRequests: number; globalUnits: number; accountUnits: number;
  concurrent: number; accountConcurrent: number; leaseMs: number;
}
export class BudgetError extends Error {
  constructor(message: string, readonly status: 429 | 503 = 429) { super(message); }
}
export interface BudgetLease { release: () => Promise<void> }
interface Counter { requests: number; units: number }
interface MemoryState { day: string; global: Counter; accounts: Map<string, Counter>; leases: Map<string, { principal: string; expires: number }> }
/** Deterministic local/development adapter. Production replicas must share the Redis transaction below. */
export class MemoryPaidBudget {
  private scopes = new Map<string, MemoryState>();
  reserve(scope: string, principal: string, units: number, limits: BudgetLimits, now = Date.now()): BudgetLease {
    const day = new Date(now).toISOString().slice(0, 10);
    let state = this.scopes.get(scope);
    if (!state) { state = { day, global: { requests: 0, units: 0 }, accounts: new Map(), leases: new Map() }; this.scopes.set(scope, state); }
    if (state.day !== day) { state.day = day; state.global = { requests: 0, units: 0 }; state.accounts.clear(); }
    for (const [key, lease] of state.leases) if (lease.expires <= now) state.leases.delete(key);
    const account = state.accounts.get(principal) ?? { requests: 0, units: 0 };
    if (!Number.isSafeInteger(units) || units < 1 || state.global.requests + 1 > limits.globalRequests || state.global.units + units > limits.globalUnits ||
        account.requests + 1 > limits.accountRequests || account.units + units > limits.accountUnits) throw new BudgetError('Daily paid-service budget exhausted.');
    if (state.leases.size >= limits.concurrent || [...state.leases.values()].filter(l => l.principal === principal).length >= limits.accountConcurrent) throw new BudgetError('Paid service is busy; retry later.');
    if (state.accounts.size >= 2000 && !state.accounts.has(principal)) throw new BudgetError('Paid-service budget capacity reached.', 503);
    state.global.requests++; state.global.units += units; account.requests++; account.units += units;
    state.accounts.set(principal, account);
    const id = crypto.randomUUID(); state.leases.set(id, { principal, expires: now + limits.leaseMs });
    return { release: async () => { state!.leases.delete(id); } };
  }
}
const local = new MemoryPaidBudget();
// One atomic operation checks/reserves BOTH daily counters and BOTH concurrency leases.
// Reservations are deliberately NOT refunded on failures: providers may have accepted billable work.
export const RESERVE_LUA = `
local now = tonumber(ARGV[1]); local lease = tonumber(ARGV[2]); local id = ARGV[3]; local units = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now); redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now)
local gr = tonumber(redis.call('HGET', KEYS[1], 'requests') or '0'); local gu = tonumber(redis.call('HGET', KEYS[1], 'units') or '0')
local ar = tonumber(redis.call('HGET', KEYS[2], 'requests') or '0'); local au = tonumber(redis.call('HGET', KEYS[2], 'units') or '0')
if gr + 1 > tonumber(ARGV[5]) or ar + 1 > tonumber(ARGV[6]) or gu + units > tonumber(ARGV[7]) or au + units > tonumber(ARGV[8]) then return 0 end
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[9]) or redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[10]) then return -1 end
for i = 1, 2 do redis.call('HINCRBY', KEYS[i], 'requests', 1); redis.call('HINCRBY', KEYS[i], 'units', units); redis.call('EXPIRE', KEYS[i], 172800) end
for i = 3, 4 do redis.call('ZADD', KEYS[i], now + lease, id); redis.call('PEXPIRE', KEYS[i], lease + 60000) end
return 1`;
const integer = (name: string, fallback: number, cap = 10_000_000) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, cap) : fallback;
};
async function redis(command: (string | number)[]) {
  const result = await fetchJsonWithTimeout(process.env.UPSTASH_REDIS_REST_URL!, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), timeoutMs: 2500, maxBytes: 16_000,
  });
  if (result?.error || result?.result === undefined) throw new Error('Invalid budget-store response');
  return result.result;
}
export async function reservePaidBudget(scope: string, principal: string, units: number, limits: BudgetLimits): Promise<BudgetLease> {
  if (!Number.isSafeInteger(units) || units < 1) throw new BudgetError('Invalid cost reservation.', 503);
  const configured = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!configured) {
    const localAllowed = !process.env.VERCEL && (process.env.NODE_ENV !== 'production' || process.env.PAID_BUDGET_MODE === 'single-process');
    if (!localAllowed) throw new BudgetError('Shared paid-service budgets are not configured. Paid work is disabled.', 503);
    return local.reserve(scope, principal, units, limits);
  }
  const prefix = `{apexfx:budget:${scope}}`; // one Redis Cluster hash slot for the atomic multi-key EVAL
  const day = new Date().toISOString().slice(0, 10);
  const hash = crypto.createHash('sha256').update(principal).digest('hex').slice(0, 32);
  const keys = [`${prefix}:day:${day}`, `${prefix}:day:${day}:${hash}`, `${prefix}:leases`, `${prefix}:leases:${hash}`];
  const id = crypto.randomUUID();
  let result: unknown;
  try {
    result = await redis(['EVAL', RESERVE_LUA, 4, ...keys, Date.now(), limits.leaseMs, id, units,
      limits.globalRequests, limits.accountRequests, limits.globalUnits, limits.accountUnits, limits.concurrent, limits.accountConcurrent]);
  } catch { throw new BudgetError('Paid-service budget store unavailable; no upstream work was started.', 503); }
  if (result === 0) throw new BudgetError('Daily paid-service budget exhausted.');
  if (result === -1) throw new BudgetError('Paid service is busy; retry later.');
  if (result !== 1) throw new BudgetError('Invalid budget-store reservation; paid work disabled.', 503);
  return { release: async () => {
    // Failure keeps a bounded expiring lease; it must never refund the daily spend reservation.
    try { await redis(['EVAL', "return redis.call('ZREM', KEYS[1], ARGV[1]) + redis.call('ZREM', KEYS[2], ARGV[1])", 2, keys[2], keys[3], id]); }
    catch { /* expiry recovers the slot */ }
  } };
}
export function reserveAiBudget(principal: string, units: number): Promise<BudgetLease> {
  const guest = principal.startsWith('guest:');
  return reservePaidBudget('ai', principal, units, {
    globalRequests: integer('AI_GLOBAL_DAILY_REQUESTS', 100), accountRequests: guest ? 3 : integer('AI_ACCOUNT_DAILY_REQUESTS', 20),
    globalUnits: integer('AI_GLOBAL_DAILY_UNITS', 200_000), accountUnits: guest ? 15_000 : integer('AI_ACCOUNT_DAILY_UNITS', 40_000),
    concurrent: integer('AI_MAX_CONCURRENT', 4, 16), accountConcurrent: 1, leaseMs: 120_000,
  });
}
export function reserveMarketBudget(provider: string, units = 1): Promise<BudgetLease> {
  const requests = provider === 'tiingo' ? integer('TIINGO_DAILY_REQUESTS', 900) : integer('MARKET_DAILY_REQUESTS', 500);
  const maximum = provider === 'tiingo' ? integer('TIINGO_DAILY_UNITS', 900) : integer('MARKET_DAILY_UNITS', 800);
  return reservePaidBudget(`market:${provider}`, 'shared', units, {
    globalRequests: requests, accountRequests: requests, globalUnits: maximum, accountUnits: maximum,
    concurrent: 4, accountConcurrent: 4, leaseMs: 60_000,
  });
}
