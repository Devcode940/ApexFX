#!/usr/bin/env node
/**
 * Operator onboarding check. Verifies everything that can be inspected offline
 * and prints an honest checklist for what still needs live cloud access.
 * `--strict` turns warnings into exit code 1 (CI use); provisioning items are
 * ALWAYS reminders (doctor cannot create cloud accounts) except in strict mode.
 */
import process from 'node:process';
import console from 'node:console';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

const strict = process.argv.includes('--strict');
let failures = 0; let warnings = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => { warnings++; console.log(`  ⚠ ${msg}`); };
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const env = dotenv.config({ quiet: true }).parsed ?? {};
try {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 24 && major < 25) ok(`node ${process.versions.node} matches engines (>=24 <25)`);
  else fail(`node ${process.versions.node} outside engines range >=24 <25 — use nvm/volta`);
} catch (error) { fail(`node version check threw: ${error.message}`); }
try {
  if (existsSync('node_modules')) {
    execSync('node -e "require.resolve(\'@playwright/test\')"', { stdio: 'pipe' });
    ok('node_modules installed (npm ci state OK)');
  } else fail('node_modules missing — run `npm ci`');
} catch { fail('@playwright/test missing — run `npm ci` (it is a devDependency now)'); }
if (existsSync('.env')) ok('.env present (gitignored)'); else warn('.env missing — `cp .env.example .env` then fill it in');
const key = (env.TIINGO_API_KEY ?? process.env.TIINGO_API_KEY ?? '').trim();
if (key) ok('TIINGO_API_KEY set — first live check: curl -sf -H "Authorization: Token $TIINGO_API_KEY" "$APEX_URL/api/health" then open /api/market/prices');
else warn('TIINGO_API_KEY empty — prices/history run degraded by design. Provision a key at tiingo.com/tiingo_user/api_keys, then verify entitlements incl. XAUUSD/XAGUSD (documented in TIINGO-FOREXFACTORY.md).');
if (env.MARKET_DATA_MODE === 'offline' || process.env.MARKET_DATA_MODE === 'offline') warn('MARKET_DATA_MODE=offline — providers are intentionally disabled');
else ok('MARKET_DATA_MODE allows live providers');
if ((env.TIINGO_WS_ENABLED ?? '') === 'true') {
  if (key) ok('TIINGO_WS_ENABLED=true — upstream FX stream will connect when the server runs (needs websocket-entitled plan)');
  else fail('TIINGO_WS_ENABLED=true without TIINGO_API_KEY — the stream cannot authenticate');
} else ok('Tiingo WS stream off by default (opt in with TIINGO_WS_ENABLED=true after verifying entitlement)');
for (const [name, value] of [['UPSTASH_REDIS_REST_URL', 'redis distributed rate limit/budgets/calendar lease'], ['CRON_SECRET', 'Vercel cron → /api/cron/calendar auth']]) {
  if ((env[name] ?? process.env[name] ?? '').trim()) ok(`${name} set (${value})`);
  else warn(`${name} unset — ${value} runs single-instance/local only`);
}
const supabase = (env.SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
if (supabase) {
  ok('SUPABASE_URL set — verify migrations with: supabase db push --dry-run, or run supabase/migrations/0001_init.sql in the dashboard SQL editor');
} else warn('SUPABASE_URL unset — cloud account sync disabled (migrations prepared at supabase/migrations/, unapplied)');
try {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const server = readFileSync('server.ts', 'utf8');
  for (const cron of vercel.crons ?? []) {
    if (server.includes(`'${cron.path}'`)) ok(`vercel.json cron ${cron.schedule} → ${cron.path} exists`);
    else fail(`vercel.json cron points at missing route ${cron.path}`);
  }
  const staticCsp = JSON.stringify(vercel).includes('Content-Security-Policy');
  if (staticCsp) fail('vercel.json still ships a static CSP; Express securityHeadersMiddleware is the single source');
  else ok('CSP is emitted by Express only (no drifting static copy)');
} catch (error) { fail(`vercel.json/doctor check failed: ${error.message}`); }
if ((env.VITE_ALLOWED_HOSTS ?? process.env.VITE_ALLOWED_HOSTS ?? '').trim()) ok('VITE_ALLOWED_HOSTS configured (sandbox/preview hosts)');
else warn('VITE_ALLOWED_HOSTS empty — needed only when fronting via a proxy host (e.g. sandboxes)');
if (strict && (warnings > 0 || failures > 0)) { console.log(`\nstrict: ${failures} error(s), ${warnings} warning(s)`); process.exit(1); }
if (failures > 0) { console.log(`\n${failures} blocking error(s) — fix before deploying`); process.exit(1); }
console.log(`\n${warnings} advisory warning(s); live-provider verification still requires a real key/cloud project (see README).`);
