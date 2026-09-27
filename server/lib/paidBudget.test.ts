import { afterEach, describe, it, expect, vi } from 'vitest';
import { MemoryPaidBudget, reservePaidBudget, reserveMarketBudget, type BudgetLimits, RESERVE_LUA } from './paidBudget';
const limits: BudgetLimits = { globalRequests: 4, accountRequests: 2, globalUnits: 100, accountUnits: 50, concurrent: 2, accountConcurrent: 1, leaseMs: 1000 };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('paid reservation policy, local adapter', () => {
  it('enforces per-account concurrency and shares global concurrency across accounts', async () => {
    const budget = new MemoryPaidBudget(); const a = budget.reserve('ai', 'a', 10, limits, 1000);
    expect(() => budget.reserve('ai', 'a', 10, limits, 1001)).toThrow('busy');
    const b = budget.reserve('ai', 'b', 10, limits, 1001);
    expect(() => budget.reserve('ai', 'c', 10, limits, 1002)).toThrow('busy');
    await a.release(); expect(budget.reserve('ai', 'c', 10, limits, 1003)).toBeTruthy(); await b.release();
  });
  it('never refunds a potentially billed failed request', async () => {
    const budget = new MemoryPaidBudget();
    for (let i = 0; i < 2; i++) await budget.reserve('ai', 'a', 10, limits, 1000).release();
    expect(() => budget.reserve('ai', 'a', 10, limits, 1000)).toThrow('Daily');
  });
  it('bounds global units even when account identities rotate', async () => {
    const budget = new MemoryPaidBudget();
    await budget.reserve('ai', 'a', 50, limits, 1000).release(); await budget.reserve('ai', 'b', 50, limits, 1000).release();
    expect(() => budget.reserve('ai', 'c', 1, limits, 1000)).toThrow('Daily');
  });
  it('recovers expiring concurrency leases after a crashed request', () => {
    const budget = new MemoryPaidBudget(); budget.reserve('ai', 'a', 10, limits, 1000);
    expect(budget.reserve('ai', 'a', 10, limits, 2001)).toBeTruthy();
  });
  it('uses UTC daily counters but keeps active concurrency across midnight', async () => {
    const budget = new MemoryPaidBudget(); const before = Date.UTC(2026, 8, 23, 23, 59, 59, 900);
    const lease = budget.reserve('ai', 'a', 50, limits, before);
    expect(() => budget.reserve('ai', 'a', 10, limits, before + 200)).toThrow('busy');
    await lease.release(); expect(budget.reserve('ai', 'a', 50, limits, before + 201)).toBeTruthy();
  });
});
describe('durable budget boundary', () => {
  it('fails closed in production without a shared store', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PAID_BUDGET_MODE', ''); vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    await expect(reservePaidBudget('ai', 'a', 1, limits)).rejects.toMatchObject({ status: 503 });
  });
  it('forbids the single-process override on a Vercel production replica', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL', '1'); vi.stubEnv('PAID_BUDGET_MODE', 'single-process'); vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    await expect(reservePaidBudget('ai', 'a', 1, limits)).rejects.toMatchObject({ status: 503 });
  });
  it('does not silently downgrade to memory if the configured shared budget store fails', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PAID_BUDGET_MODE', 'single-process');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://budget.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fixture');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(reservePaidBudget('ai', 'a', 1, limits)).rejects.toMatchObject({ status: 503 });
  });
  it('sends one atomic EVAL with account/global daily and lease keys; release only removes leases', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://budget.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fixture');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"result":1}'));
    const lease = await reservePaidBudget('ai', 'private-user-id', 20, limits);
    const command = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(command.slice(0, 3)).toEqual(['EVAL', RESERVE_LUA, 4]); expect(command.slice(3, 7).join(',')).not.toContain('private-user-id');
    await lease.release(); const release = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    expect(release[1]).toContain('ZREM'); expect(release[1]).not.toContain('HINCRBY');
  });
  it('reserves one Tiingo unit per HTTP request with separate provider daily defaults', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://budget.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fixture');
    vi.stubEnv('TIINGO_DAILY_REQUESTS', ''); vi.stubEnv('TIINGO_DAILY_UNITS', '');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"result":1}'));
    const lease = await reserveMarketBudget('tiingo'); const command = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(command[3]).toContain('{apexfx:budget:market:tiingo}'); expect(command.slice(10)).toEqual([1, 900, 900, 900, 900, 4, 4]);
    await lease.release();
  });

});
