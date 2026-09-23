import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { INSTRUMENTS, isExecutableQuote } from '../shared/market';
import { rawCalendarEvents } from '../src/test/calendarFixtures';
import { CHAT_MAX_OUTPUT_TOKENS } from '../shared/chat';
import { clearAllBuckets } from './lib/rateLimit';
import { priceCache, historyCache } from './lib/cache';
import { serverWatchlist, createInitialWatchlist, setTdRestCooldown, getYahooFailureStreak, TD_SYMBOLS } from './services/market';

const sdk = vi.hoisted(() => ({ generate: vi.fn(), options: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { constructor(options: unknown) { sdk.options(options); } models = { generateContent: sdk.generate }; }, MediaResolution: { MEDIA_RESOLUTION_LOW: 'MEDIA_RESOLUTION_LOW' } }));
const nativeFetch = globalThis.fetch;
let base = '';
let server: (typeof import('../server'))['httpServer'];
let stop: (typeof import('../server'))['stopServer'];
let account = 0;
let redisOk = true;
let yahooOk = true;
let tdOk = true;
let verifyOk = true;
let tiingoOk = true;
let tiingoSymbols = Object.keys(INSTRUMENTS);
let providerFetch: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const prices: Record<string, number> = { EURUSD: 1.1, GBPUSD: 1.3, USDJPY: 150, AUDUSD: .7, USDCAD: 1.35, GBPJPY: 195, XAUUSD: 2500, XAGUSD: 30 };
beforeAll(async () => {
  const imported = await import('../server'); server = imported.httpServer; stop = imported.stopServer;
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await stop(); });
beforeEach(() => {
  clearAllBuckets(); priceCache.clear(); historyCache.clear(); setTdRestCooldown(-1); account++;
  createInitialWatchlist().forEach((item, index) => Object.assign(serverWatchlist[index], item));
  redisOk = true; yahooOk = true; tdOk = true; tiingoOk = true; tiingoSymbols = Object.keys(INSTRUMENTS); verifyOk = true; sdk.generate.mockReset(); sdk.options.mockClear(); sdk.generate.mockResolvedValue({ text: 'Fixture educational analysis.' });
  for (const key of ['TIINGO_API_KEY', 'TIINGO_POLL_MS', 'TIINGO_HISTORY_CACHE_MS', 'MARKET_ALLOW_FALLBACKS', 'FOREX_FACTORY_ENABLED', 'FOREX_FACTORY_REQUIRE_SHARED', 'VERCEL', 'TWELVEDATA_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'WS_SHARED_SECRET', 'WS_REQUIRE_AUTH', 'AI_ALLOW_GUESTS', 'MARKET_DATA_MODE', 'PAID_BUDGET_MODE']) vi.stubEnv(key, '');
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('ALLOWED_ORIGINS', 'https://terminal.example');
  vi.stubEnv('SUPABASE_URL', 'https://auth.fixture'); vi.stubEnv('SUPABASE_ANON_KEY', 'fixture-public'); vi.stubEnv('GEMINI_MODEL', 'fixture-text-model');
  providerFetch = vi.fn(async (url: string) => {
    if (url.startsWith('https://budget.fixture')) return json({ result: 1 }, redisOk ? 200 : 503);
    if (url.startsWith('https://auth.fixture/auth/v1/user')) return json(verifyOk ? { id: `00000000-0000-4000-8000-${String(account).padStart(12, '0')}` } : { error: 'Invalid token' }, verifyOk ? 200 : 401);
    if (url.startsWith('https://api.tiingo.com/tiingo/fx/top')) return json(tiingoOk ? tiingoSymbols.map(symbol => ({ ticker: symbol.toLowerCase(), quoteTimestamp: new Date().toISOString(), bidPrice: prices[symbol] - .0001, askPrice: prices[symbol] + .0001 })) : { detail: 'Fixture entitlement denied.' }, tiingoOk ? 200 : 403);
    if (url.startsWith('https://api.tiingo.com/tiingo/fx/') && url.includes('/prices?')) return json(tiingoOk ? [
      { ticker: 'eurusd', date: '2026-09-14T00:00:00Z', open: 1.1, high: 1.2, low: 1, close: 1.12 },
      { ticker: 'eurusd', date: '2026-09-15T00:00:00Z', open: 1.12, high: 1.3, low: 1.1, close: 1.25 },
    ] : { detail: 'Fixture entitlement denied.' }, tiingoOk ? 200 : 403);
    if (url === 'https://nfs.faireconomy.media/ff_calendar_thisweek.json') return json(rawCalendarEvents.map(event => ({ ...event, date: new Date().toISOString() })));
    if (url.startsWith('https://api.twelvedata.com/quote')) return json(tdOk ? Object.fromEntries(Object.keys(INSTRUMENTS).map(symbol => [TD_SYMBOLS[symbol], { close: String(prices[symbol]), timestamp: Math.floor(Date.now() / 1000) }])) : { status: 'error', code: 403 });
    if (url.includes('finance.yahoo.com/v8/finance/chart/')) {
      const path = decodeURIComponent(new URL(url).pathname); const symbol = Object.keys(INSTRUMENTS).find(s => path.includes(s)) ?? 'XAGUSD';
      if (new URL(url).searchParams.get('interval') === '1d') return json({ chart: { result: [{
        timestamp: [Date.parse('2026-09-14T00:00:00Z') / 1000, Date.parse('2026-09-15T00:00:00Z') / 1000],
        indicators: { quote: [{ open: [1.1, 1.12], high: [1.2, 1.3], low: [1, 1.1], close: [1.12, 1.25] }] },
      }] } });
      return json(yahooOk ? { chart: { result: [{ meta: { regularMarketPrice: prices[symbol], regularMarketTime: Math.floor(Date.now() / 1000) }, timestamp: [], indicators: { quote: [{}] } }] } } : { error: 'provider down' }, yahooOk ? 200 : 503);
    }
    throw new Error(`Unexpected external fixture URL: ${url.split('?')[0]}`);
  });
  vi.stubGlobal('fetch', providerFetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (path: string, init?: RequestInit) => nativeFetch(`${base}${path}`, init);
const chat = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => request('/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ messages: [{ sender: 'user', text: 'Explain pip value.' }], ...extra }),
});
const bearer = { Authorization: 'Bearer fixture-token-long-enough-for-verification' };
function durableStore() { vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://budget.fixture'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fixture'); }

describe('real Express API, fixture-only upstreams', () => {
  it('separates provider-independent liveness from honest market readiness', async () => {
    expect((await request('/api/live')).status).toBe(200);
    expect((await request('/api/ready')).status).toBe(503);
    expect((await (await request('/api/health')).json()).status).toBe('degraded'); expect(providerFetch).not.toHaveBeenCalled();
  });
  it('coalesces five paid quote misses into one provider request', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'fixture-key');
    const responses = await Promise.all(Array.from({ length: 5 }, () => request('/api/market/quote?symbol=EURUSD')));
    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(providerFetch.mock.calls.filter(([url]) => String(url).includes('twelvedata.com/quote'))).toHaveLength(1);
  });
  it('uses the configured primary on Vercel too, with truthful per-instrument metadata', async () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('TWELVEDATA_API_KEY', 'fixture-key'); durableStore();
    const body = await (await request('/api/market/prices')).json();
    expect(body.success).toBe(true); expect(body.source).toBe('twelvedata'); expect(body.rates.USDJPY.providerSymbol).toBe('USD/JPY');
    expect(body.rates.USDJPY.asOf).toBeLessThanOrEqual(body.rates.USDJPY.receivedAt); expect(isExecutableQuote(body.rates.USDJPY)).toBe(true);
    expect((await (await request('/api/capabilities')).json()).websocket).toBe(false);
  });
  it('labels actual Yahoo fallback and silver futures; missing budget never spends a primary request', async () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('TWELVEDATA_API_KEY', 'fixture-key');
    const body = await (await request('/api/market/prices')).json();
    expect(body.source).toBe('yahoo'); expect(body.rates.XAGUSD.instrumentKind).toBe('futures'); expect(body.rates.XAGUSD.providerSymbol).toBe('SI=F');
    expect(isExecutableQuote(body.rates.XAGUSD)).toBe(false);
    expect(providerFetch.mock.calls.some(([url]) => String(url).includes('twelvedata'))).toBe(false);
  });
  it('counts HTTP 503 Yahoo failures and does not advertise an empty watchlist as success', async () => {
    yahooOk = false; const before = getYahooFailureStreak(); const response = await request('/api/market/prices'); const body = await response.json();
    expect(response.status).toBe(503); expect(body.success).toBe(false); expect(body.source).toBeNull();
    expect(getYahooFailureStreak()).toBe(before + 1);
    expect(providerFetch.mock.calls.filter(([url]) => String(url).includes('yahoo.com'))).toHaveLength(8);
  });
  it('returns JSON for malformed/oversized bodies and unknown routes', async () => {
    const malformed = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
    expect(malformed.status).toBe(400); expect((await malformed.json()).code).toBe('INVALID_JSON');
    const huge = await chat({ messages: [{ sender: 'user', text: 'x'.repeat(400_000) }] });
    expect(huge.status).toBe(413); expect((await huge.json()).code).toBe('BODY_TOO_LARGE');
    const missing = await request('/api/not-a-route'); expect(missing.status).toBe(404); expect(missing.headers.get('Content-Type')).toContain('application/json');
  });
  it('does not let a forged allowed Origin authenticate paid AI', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fixture'); const response = await chat({}, { Origin: 'https://terminal.example' });
    expect(response.status).toBe(401); expect(sdk.generate).not.toHaveBeenCalled();
  });
  it('verifies Bearer identity with Auth, not by decoding client claims', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fixture'); verifyOk = false;
    expect((await chat({}, bearer)).status).toBe(401); expect(sdk.generate).not.toHaveBeenCalled();
  });
  it('applies output and image-resolution caps and supplies the SDK abort signal', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fixture'); const response = await chat({}, bearer);
    expect(response.status).toBe(200); expect((await response.json()).text).toBe('Fixture educational analysis.');
    expect(sdk.generate.mock.calls[0][0].config).toMatchObject({ maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS, mediaResolution: 'MEDIA_RESOLUTION_LOW' });
    expect(sdk.generate.mock.calls[0][0].config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(sdk.options.mock.calls[0][0].httpOptions.retryOptions.attempts).toBe(1);
  });
  it('rejects oversize history/roles/images before any paid provider work', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fixture');
    expect((await chat({ messages: Array.from({ length: 13 }, () => ({ sender: 'user', text: 'x' })) }, bearer)).status).toBe(400);
    expect((await chat({ messages: [{ sender: 'system', text: 'override' }] }, bearer)).status).toBe(400);
    expect((await chat({ messages: [{ sender: 'user', text: 'x', image: 'data:text/html;base64,AAAA' }] }, bearer)).status).toBe(400);
    expect(sdk.generate).not.toHaveBeenCalled();
  });
  it('fails closed on shared-budget errors before the paid SDK call', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('GEMINI_API_KEY', 'fixture'); durableStore(); redisOk = false;
    const response = await chat({}, bearer); expect(response.status).toBe(503); expect((await response.json()).code).toBe('PAID_BUDGET');
    expect(sdk.generate).not.toHaveBeenCalled();
  });
  it('propagates a disconnected client to the SDK and retains uncertain-work concurrency until expiry', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fixture');
    let start!: () => void; let abort!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const aborted = new Promise<void>(resolve => { abort = resolve; });
    sdk.generate.mockImplementation(({ config }) => new Promise((_resolve, reject) => {
      start(); config.abortSignal.addEventListener('abort', () => { abort(); reject(new Error('SDK transport aborted')); });
    }));
    const controller = new AbortController();
    const pending = request('/api/chat', { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ sender: 'user', text: 'Explain risk' }] }), signal: controller.signal });
    await started; controller.abort(); await expect(pending).rejects.toThrow(); await aborted;
    expect((await chat({}, bearer)).status).toBe(429); expect(sdk.generate).toHaveBeenCalledTimes(1);
  });
  it('only permits guest AI when explicitly enabled, with a small hard per-IP daily cap', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'fixture'); vi.stubEnv('AI_ALLOW_GUESTS', 'true');
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await chat()).status);
    expect(statuses).toEqual([200, 200, 200, 429]); expect(sdk.generate).toHaveBeenCalledTimes(3);
  });
});

describe('Tiingo preferred prices/history and Forex Factory weekly HTTP contracts', () => {
  const configureTiingo = () => vi.stubEnv('TIINGO_API_KEY', `api-fixture-tiingo-${account}`);
  it('uses Tiingo on request-driven Vercel, consumes shared reservations and keeps credentials server-side', async () => {
    configureTiingo(); vi.stubEnv('VERCEL', '1'); vi.stubEnv('NODE_ENV', 'production'); durableStore();
    const response = await request('/api/market/prices'); const body = await response.json();
    expect(response.status).toBe(200); expect(body.source).toBe('tiingo');
    expect(body.rates.XAGUSD).toMatchObject({ provider: 'tiingo', providerSymbol: 'xagusd', instrumentKind: 'spot', priceBasis: 'mid', dayStatsAvailable: false });
    expect(isExecutableQuote(body.rates.XAGUSD)).toBe(true);
    expect(providerFetch.mock.calls.filter(([url]) => String(url).includes('api.tiingo.com'))).toHaveLength(1);
    expect(providerFetch.mock.calls.some(([url]) => String(url).includes('budget.fixture'))).toBe(true);
    expect(providerFetch.mock.calls.some(([url]) => /yahoo|twelvedata/.test(String(url)))).toBe(false);
    expect(JSON.stringify(body)).not.toContain(process.env.TIINGO_API_KEY);
    const health = await (await request('/api/health')).json(); expect(health.feed.tiingo.configured).toBe(true);
    const capabilities = await (await request('/api/capabilities')).json(); expect(capabilities.timeframes).toContain('W'); expect(capabilities.calendar).toBe('forexfactory-weekly');
  });
  it('protects fresh Tiingo symbols while applying honestly labeled Yahoo fallback only to missing symbols', async () => {
    configureTiingo(); tiingoSymbols = ['EURUSD'];
    const body = await (await request('/api/market/prices')).json();
    expect(body.source).toBe('mixed'); expect(body.rates.EURUSD.provider).toBe('tiingo');
    expect(body.rates.GBPUSD.provider).toBe('yahoo'); expect(body.rates.XAGUSD.instrumentKind).toBe('futures'); expect(isExecutableQuote(body.rates.XAGUSD)).toBe(false);
    const yahoo = providerFetch.mock.calls.filter(([url]) => String(url).includes('yahoo.com'));
    expect(yahoo).toHaveLength(7); expect(yahoo.every(([url]) => !String(url).includes('EURUSD'))).toBe(true);
  });
  it('requests the Twelve Data fallback subset, not a second full paid batch over covered Tiingo symbols', async () => {
    configureTiingo(); tiingoSymbols = ['EURUSD']; vi.stubEnv('TWELVEDATA_API_KEY', 'fixture-secondary');
    const body = await (await request('/api/market/prices')).json(); expect(body.rates.EURUSD.provider).toBe('tiingo'); expect(body.rates.GBPUSD.provider).toBe('twelvedata');
    const td = providerFetch.mock.calls.find(([url]) => String(url).includes('twelvedata.com/quote'))!;
    const symbols = new URL(String(td[0])).searchParams.get('symbol')!.split(','); expect(symbols).toHaveLength(7); expect(symbols).not.toContain('EUR/USD');
  });
  it('Tiingo-only mode fails unavailable instead of silently returning another provider', async () => {
    configureTiingo(); tiingoOk = false; vi.stubEnv('MARKET_ALLOW_FALLBACKS', 'false');
    const response = await request('/api/market/prices'); const body = await response.json();
    expect(response.status).toBe(503); expect(body.success).toBe(false); expect(body.source).toBeNull();
    const history = await request('/api/market/history?symbol=EURUSD&timeframe=W'); expect(history.status).toBe(502);
    expect(providerFetch.mock.calls).toHaveLength(1);
  });
  it('returns real W metadata and aggregated daily OHLC through the actual history route, without fabricated volume', async () => {
    configureTiingo(); const response = await request('/api/market/history?symbol=EURUSD&timeframe=W'); const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ timeframe: 'W', source: 'tiingo', providerSymbol: 'eurusd', instrumentKind: 'spot' });
    expect(body.data).toHaveLength(1); expect(body.data[0]).toMatchObject({ open: 1.1, high: 1.3, low: 1, close: 1.25 }); expect(body.data[0]).not.toHaveProperty('volume');
    expect(body.fetchedAt).toBeGreaterThan(0); expect(new Date(body.data[0].time * 1000).getUTCDay()).toBe(1);
    expect((await request('/api/market/history?symbol=EURUSD&timeframe=constructor')).status).toBe(400);
  });
  it('labels Yahoo weekly fallback as Yahoo, not Tiingo, and also aggregates daily bars', async () => {
    configureTiingo(); tiingoOk = false;
    const response = await request('/api/market/history?symbol=EURUSD&timeframe=W'); const body = await response.json();
    expect(response.status).toBe(200); expect(body.source).toBe('yahoo'); expect(body.data).toHaveLength(1); expect(body.data[0].high).toBe(1.3);
    expect(body.data[0]).not.toHaveProperty('volume');
    const yahoo = providerFetch.mock.calls.find(([url]) => String(url).includes('yahoo.com'))!;
    expect(new URL(String(yahoo[0])).searchParams.get('interval')).toBe('1d');
  });
  it('serves a cached current-week economic calendar, not executable quotes, with no per-symbol upstream requests', async () => {
    const responses = await Promise.all([request('/api/market/calendar?week=this'), request('/api/market/calendar')]);
    const body = await responses[0].json(); expect(responses[0].status).toBe(200);
    expect(body.source).toBe('forexfactory'); expect(body.events).toHaveLength(3); expect(body.events.every((e: Record<string, unknown>) => e.actual === null && !('price' in e))).toBe(true);
    expect(responses[0].headers.get('Cache-Control')).toContain('s-maxage=300'); expect(responses[0].headers.get('X-RateLimit-Policy')).toContain('calendar');
    expect(providerFetch.mock.calls.filter(([url]) => String(url).includes('ff_calendar_thisweek.json'))).toHaveLength(1);
    expect((await request('/api/market/calendar?week=next')).status).toBe(400);
    expect((await request('/api/market/calendar?week=../../private')).status).toBe(400);
  });
  it('fails the calendar closed without Vercel shared caching and supplies a useful Retry-After', async () => {
    vi.stubEnv('VERCEL', '1');
    const response = await request('/api/market/calendar'); const body = await response.json();
    expect(response.status).toBe(503); expect(body.code).toBe('CALENDAR_CACHE_NOT_CONFIGURED'); expect(response.headers.get('Retry-After')).toBe('3600');
    expect(providerFetch).not.toHaveBeenCalled();
  });
  it('allows the operator to disable calendar fetching, including offline smoke tests', async () => {
    vi.stubEnv('FOREX_FACTORY_ENABLED', 'false');
    const response = await request('/api/market/calendar'); expect(response.status).toBe(503); expect((await response.json()).code).toBe('CALENDAR_DISABLED'); expect(providerFetch).not.toHaveBeenCalled();
  });
});

async function openSocket(token: string | null, ip = '203.0.113.1') {
  return new Promise<number>(resolve => {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws${token ? `?token=${token}` : ''}`, { headers: { Origin: 'https://terminal.example', 'X-Forwarded-For': ip } });
    ws.on('error', () => {});
    ws.on('unexpected-response', (_req, res) => { res.resume(); ws.terminate(); resolve(res.statusCode!); });
    ws.on('open', () => { ws.close(); resolve(101); });
  });
}
describe('browser POST token and authenticate-before-upgrade contract', () => {
  it('mints a same-origin-style POST token, binds it to IP/origin, and consumes it once', async () => {
    const response = await request('/api/ws/token', { method: 'POST', headers: { Origin: 'https://terminal.example', 'X-Forwarded-For': '203.0.113.1' } });
    expect(response.status).toBe(200); const { token } = await response.json();
    expect(await openSocket(token, '203.0.113.2')).toBe(401);
    expect(await openSocket(token)).toBe(101); expect(await openSocket(token)).toBe(401);
    expect(await openSocket(null)).toBe(401); // rejected as HTTP, not accepted then closed as WS
  });
  it('never accepts a shared secret in the query string; browsers can use verified Bearer identity', async () => {
    vi.stubEnv('WS_SHARED_SECRET', 'fixture-shared');
    const denied = await request('/api/ws/token?secret=fixture-shared', { method: 'POST', headers: { Origin: 'https://terminal.example' } });
    expect(denied.status).toBe(401);
    expect((await request('/api/ws/token', { method: 'POST', headers: { Origin: 'https://terminal.example', ...bearer } })).status).toBe(200);
    expect((await request('/api/ws/token', { method: 'POST', headers: { 'x-ws-secret': 'fixture-shared' } })).status).toBe(200);
  });
});
