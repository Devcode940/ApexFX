import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';

// Deterministic: no provider accounts, Redis, browser, or live market availability required.
const port = Number(process.env.SMOKE_PORT || 3999);
const child = spawn(process.execPath, ['dist/server.cjs'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...process.env, PORT: String(port), NODE_ENV: 'production', MARKET_DATA_MODE: 'offline', LOG_LEVEL: 'info',
  TIINGO_API_KEY: '', TWELVEDATA_API_KEY: '', FOREX_FACTORY_ENABLED: 'false', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', FINNHUB_API_KEY: '', FOREXRATE_API_KEY: '',
  UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', VERCEL: '', WS_DISABLED: 'true',
} });
let output = '';
const exited = once(child, 'exit');
let timer;
try {
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Startup timeout\n${output}`)), 15_000);
    child.stdout.on('data', data => { output += data; if (output.includes('[Server] Listening on')) resolve(); });
    child.stderr.on('data', data => { output += data; });
    child.once('error', reject); child.once('exit', code => reject(new Error(`Server exited (${code})\n${output}`)));
  });
  clearTimeout(timer);
  const request = (path, init) => globalThis.fetch(`http://127.0.0.1:${port}${path}`, init);
  assert.equal((await (await request('/api/live')).json()).status, 'alive');
  assert.equal((await request('/api/ready')).status, 503);
  assert.equal((await (await request('/api/health')).json()).status, 'degraded');
  const capabilities = await (await request('/api/capabilities')).json();
  assert.equal(capabilities.websocket, false); assert.ok(capabilities.timeframes.includes('W')); assert.equal(capabilities.calendar, 'forexfactory-weekly');
  const calendar = await request('/api/market/calendar?week=this'); assert.equal(calendar.status, 503); assert.equal((await calendar.json()).code, 'CALENDAR_DISABLED');
  assert.equal((await request('/api/market/history?symbol=EURUSD&timeframe=W')).status, 503);
  const page = await request('/'); assert.equal(page.status, 200); const html = await page.text();
  const asset = html.match(/\/assets\/[^"\s]+\.js/)?.[0]; assert.ok(asset, 'built index must reference its JS asset');
  const js = await request(asset, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(js.status, 200); assert.equal(js.headers.get('content-encoding'), 'gzip'); assert.ok((await js.text()).length > 100);
  const missing = await request('/api/does-not-exist'); assert.equal(missing.status, 404); assert.match(missing.headers.get('content-type'), /application\/json/);
  const prices = await request('/api/market/prices'); assert.equal(prices.status, 503); assert.equal((await prices.json()).success, false);
  for (const privatePath of ['/server.cjs', '/server.cjs.map', '/server.js', '/server.ts', '/.env', '/.git/config', '/server/server.cjs']) {
    assert.ok([403, 404].includes((await request(privatePath)).status), `${privatePath} must not be publicly served`);
  }
  const malformed = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).code, 'INVALID_JSON');
  console.log('Production smoke passed: boot, SPA, gzip, JSON errors, liveness/readiness, weekly capabilities/disabled calendar, private artifact denial. Offline mode.');
} finally {
  clearTimeout(timer);
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5000); force.unref();
  await exited; clearTimeout(force);
}
