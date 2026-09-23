# Deployment and data cutover — 2026-09-23

This guide supersedes older deployment claims in the historical review/fix notes. **No real Supabase project, paid provider, Redis deployment, Docker image, or Vercel deployment was operated as part of the local implementation verification.** Follow the gates below rather than treating passing fixtures as a production approval. See [Tiingo / Forex Factory integration and setup](TIINGO-FOREXFACTORY.md) for the new preferred data sources.

## 1. Runtime and build boundaries

Use Node **24 LTS**. The package engine, `.nvmrc`, CI and Docker are aligned.

```bash
npm ci --include=dev
npm run verify
NODE_ENV=production npm start
```

The locked clean install/build was checked locally. Review npm install-script and deprecated tooling notices during upgrades; the point-in-time advisory audit is not a support or supply-chain guarantee.

The Node process listens on `0.0.0.0:$PORT` (default 3000). Serve only `dist/client/` as static content. The server bundle/map live one directory higher and must not be exposed by an nginx/CDN directory root. The Node app also denies their former public paths.

`server/start.ts` owns process startup/shutdown. Do not run `tsx server.ts` expecting a listener: importing that module is deliberately side-effect-free with respect to listening, timers and provider connections. `npm run dev` starts Express plus Vite. `MARKET_DATA_MODE=offline` disables primary quote/history/background-feed activity; it is not a universal network kill switch for Auth/AI/optional proxies. The smoke script also blanks provider/budget keys. `npm run preview` is frontend-only.

Development previews: `VITE_ALLOWED_HOSTS=.e2b.app` (or the exact trusted host). API requests use same-origin relative URLs. Development can be embedded; production keeps frame-denying headers/CSP. Never use blanket development host/origin allowances as a production access-control mechanism.

### Persistent Node

Use a process supervisor/reverse proxy that supports HTTP upgrades at `/ws`. Configure `APP_URL` / `ALLOWED_ORIGINS` with the public HTTPS origin. Terminate TLS at the trusted edge; forward the client IP consistently for both token POSTs and WS upgrades.

Choose `TRUST_PROXY` for the actual network topology. The default trusts private/loopback/CGNAT peers; this is **not** safe against an untrusted co-tenant that can reach the port over a private network. Use an explicit trusted range/hop policy or `TRUST_PROXY=0`. Do not expose a trust-all origin server directly.

Use one process or sticky routing for the current in-memory, one-use WS nonce store. Multi-replica seamless WS needs shared atomic nonce consumption and shared fan-out; Redis paid budgets alone do not solve that. Slow clients, payload size, heartbeat, per-IP/global connection counts and connection lifetime are bounded.

### Vercel

`vercel.json` builds the client into `dist/client/` and sends `/api/*` to `api/index.ts`. Its install command explicitly includes build tools. Select Node 24 in project settings too. Vite public Supabase values are **build-time**, not just runtime configuration.

Current capabilities advertise `websocket: false`, and token minting is disabled on this deployment. Vercel's native WebSocket **Beta** is a platform option, not an implemented transport in this HTTP adapter. Before adopting it, test upgrade routing, function duration/reconnect, replica-local versus shared state, data-provider licensing and connection quotas.

Tiingo/legacy quote-history caches and single-flight work are **instance-local**. The Forex Factory calendar is different: Vercel requires a shared Redis snapshot and atomic hourly refresh lease, including failed attempts. Cold replicas can perform duplicate reads; shared paid budgets cap paid reservations, but do not create a shared cache or improve feed completeness. Do not assume the persistent Node streaming cadence applies to serverless polling.

Static and API security headers have different owners (`vercel.json` versus Express). Verify both, especially your Supabase host/custom domain in CSP. Do not put server keys in build-time `VITE_*` variables.

### Docker

```bash
docker build -t apexfx \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" .
docker run --rm -p 3000:3000 --env-file .env -e NODE_ENV=production apexfx
```

Those two build arguments are public browser configuration, **never a service-role key**. The image uses Node 24 and a non-root runtime. The Docker healthcheck calls `/api/live`. Docker validation is configured in CI but was not run locally (no Docker executable).

## 2. Data providers and paid services: configure before enabling

### Tiingo and the weekly calendar

Set server-only `TIINGO_API_KEY` with verified FX permissions. The adapter batches timestamped bid/ask TOP snapshots and requests OHLC history; `W` is our Monday-UTC aggregation of **daily** bars, not a claimed native Tiingo weekly endpoint. The simulator uses midpoint observations, not executable bid/ask broker fills. Check metal coverage with your plan; missing/failed instruments are not invented.

Default fallback order is Tiingo → configured Twelve Data → Yahoo. Set `MARKET_ALLOW_FALLBACKS=false` to keep unsupported/stale data unavailable instead. Actual source/kind/time is retained throughout; Yahoo silver futures remain display-only. The Node browser WebSocket broadcasts these cached snapshots, **not** upstream Tiingo ticks. A configured Tiingo key suppresses the old Twelve Data upstream stream.

Configure `TIINGO_POLL_MS` (default 90 seconds) and `TIINGO_HISTORY_CACHE_MS` (default 10 minutes) against the actual plan. Original cached history receipt times remain unchanged. Requests/UTC-day are capped by separate `TIINGO_DAILY_REQUESTS` / `TIINGO_DAILY_UNITS` (default 900 each). Even the TOP-only theoretical load is ~960 attempts/day at 90 seconds if the Node service runs continuously; the lower safety cap intentionally prevents that full load. History requests, new symbols/periods, and cold replicas add to it. **Do not treat defaults as uninterrupted starter-tier coverage**: provision the right plan, configure the budget/cadence and alert on exhaustion. Provider hourly limits are separate; honor their 429/Retry-After. See the integration guide before enabling a paid token.

Forex Factory uses the public **current-week JSON export**, not the website HTML, not arbitrary past/future weeks, and not a live actual-results API. The server attempts a refresh at most hourly, including failures. Filters/pagination happen in the browser. Missing forecast/previous/actual values stay null; ambiguous times stay unknown; source offsets are honored. The source-week check is Sunday/New York, distinct from chart Monday/UTC. Stale snapshots and week rollover are labeled.

Use the same `UPSTASH_REDIS_REST_*` pair for the shared calendar snapshot/refresh lease. It is mandatory on Vercel; also set `FOREX_FACTORY_REQUIRE_SHARED=true` on replicated Node deployments. A single persistent Node can run with a local cache, but restart loses its snapshot/cooldown. Shared caching is recommended even there. `FOREX_FACTORY_ENABLED=false` disables it. Do not rotate hosts/formats/proxies to bypass an export denial. Review both providers’ reuse/redistribution terms before exposing the public market/calendar routes.

### Optional AI

See `.env.example` for all settings. Supply an explicit, currently supported **text** model. If both provider keys exist, OpenRouter wins. There is no automatic alternate-model retry; Gemini SDK attempts are explicitly limited to one (the SDK otherwise defaults to multiple attempts).

AI requires a Supabase Bearer session verified with the same project's Auth service. `AI_ALLOW_GUESTS=true` is an explicit opt-in to small guest quotas, not an accidental unauthenticated path. WS optionally uses the same verified identity when `WS_REQUIRE_AUTH=true` or `WS_SHARED_SECRET` is set; a service client may supply `x-ws-secret`. **Never send that shared secret from browser code or put it in a query string.** The upgrade URL contains only a short-lived, one-use nonce; redact query nonces in reverse-proxy logs as well.

### Shared quotas

Set both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Paid work fails closed if the configured store is down, returns invalid data, or denies the reservation. Atomic EVAL reserves account/global daily counters and concurrency leases in a shared Redis hash slot.

| Default | AI | Tiingo REST | Other paid market providers |
|---|---:|---:|---:|
| Global requests / UTC day | 100 | 900 | 500 |
| Account requests / day | 20; guests 3/IP | shared provider budget | shared provider budget |
| Global work units / day | 200,000 | 900 | 800 |
| Account work units / day | 40,000; guests 15,000 | shared provider budget | shared provider budget |
| App concurrency | 4 global, 1/account | 4/provider | 4/provider |
| Lease expiry | 120 seconds | 60 seconds | 60 seconds |

AI units reserve UTF-8 input bytes, 8,192 units per image, and the output-token ceiling. Market requests use configured conservative work units (Tiingo TOP/history attempt: 1; full TD batch/subscription: 8; historical request: 1). **These are not actual invoice-dollar accounting or an entitlement guarantee.** Set provider-side project credit/spend caps, alerts, and appropriate model/provider permissions too. Redis errors never downgrade paid work to memory. Unknown AI completion after abort/error retains its concurrency lease until expiry; daily reservations are never refunded merely because a request failed.

Local development has a bounded in-process adapter. `PAID_BUDGET_MODE=single-process` explicitly permits it for one persistent production process only; restart resets those counters. It is disallowed on Vercel, including previews. Do not use it with PM2 clustering, multiple containers, or replicas.

The cheaper per-IP API rate limiter has a different purpose and can fall back to bounded memory if Redis is unavailable. It is **not** the paid-spend control. Market reads/WS are public by default; optional socket auth does not make HTTP quotes private. Add market-wide authentication/entitlement checks if your data redistribution agreement requires them.

### Input and timeout contract

Chat: at most 12 messages, 4,000 characters/message, 12,000 total characters, one PNG/JPEG/WebP image of at most 256,000 decoded bytes, 512 output tokens, and 8,000 returned text characters. JSON bodies are capped at 384 KiB. The server deadline is 25s; provider transport is also bounded. Older images are not repeatedly uploaded from chat history.

Cancellation is propagated to fetch/the SDK. It does **not** guarantee a provider stopped processing or stopped billing an already accepted request. Gemini's SDK documents this explicitly; retained reservations/leases are intentional. The generic proxy helper limits complete response bodies as well as headers; the Gemini path additionally depends on SDK/provider compliance with its configured limits. Validate the selected paid model against its real endpoint before rollout.

## 3. Data migration and retirement of unsafe old writers

**Do not wipe books, reinterpret all old `profit` fields as USD, or rerun the legacy `supabase-schema.sql` repair blocks.** That file is retained as a historical schema/archive reference.

1. **Back up first.** Obtain a project/database backup and export each browser's unscoped `forexinsight_positions`, `forexinsight_closed_trades` and relevant drawings. Existing v2 books have a JSON export; raw corrupt storage can also be exported. Shared-browser guest data has no provable account owner.
2. Apply **`supabase/migrations/20260923_paper_books.sql`** to the intended project. It creates `paper_books_v2`, enables own-row RLS, forbids direct authenticated writes, and grants the account-bound CAS RPC. It does not migrate/delete/reprice the old tables. It also removes the unsafe earlier two-argument draft RPC signature if present.
3. With two real authenticated users **A and B**, verify: A cannot read B's row; direct writes and anonymous RPC calls fail; B cannot save a payload with `expected_user_id=A`; two writes at the same expected revision yield one conflict; dropping tombstones is rejected. Use normal public-client credentials/session tokens, not a service-role client that bypasses RLS.
4. Deploy the new frontend and backend together. Wire quote/history metadata changed, the WS-token route is now POST, and cloud v2 requires the new RPC. A missing migration is a visible error; there is **no** fallback to global-ID legacy upserts.
5. Retire/refresh old browser tabs and apply **`supabase/migrations/20260923_freeze_legacy_books.sql`** at cutover. This separate step revokes anonymous/authenticated legacy journal **writes**, leaving rows and existing read policies/grants untouched. It prevents an obsolete client from continuing the old mixed-account upload path. Coordinate with any other legitimate writers first.
6. In the current book's account panel, explicitly confirm ownership before importing unscoped legacy **local** data. Originals remain in place. Legacy USD-quoted and USD-base amounts can be reconstructed algebraically; a JPY cross without historical conversion stays **USD unknown**. Do not fill it with today's USDJPY. Unknown silver instrument identity, invalid protective levels and unlinked historic closes need manual reconciliation.
7. The legacy **cloud** export is scoped and paginated (500 rows/page, explicit 100,000-row browser cap). It is an archive, not an automatic schema translator or a transactionally consistent database backup. Preserve it, review ownership/currency/linkage, and transform/reconcile into validated v2 records deliberately. The v2 restore control does not blindly import old snake-case table rows.
8. Restore/repair accepts validated v2 backups under 8 MB. A wrapped backup's owner must match. Valid local records/tombstones merge with the backup; a corrupt original is copied to the account's `:recovery-original` key **before** replacement. If storage cannot preserve/write data, the UI reports failure/memory-only state. Keep external backups.

Cloud limit: 2 MiB JSON document and 5,000-row collection bounds; the client also bounds live positions plus closure identities/history. There is no automatic tombstone compaction. Export/archive with old devices retired before an administrative reset; simply dropping tombstones permits stale-device resurrection.

Account namespaces prevent accidental presentation/upload mixups; they are not encryption. Signing out does not erase the local account book. One active trading tab per local book is the supported usage: localStorage is not a cross-tab transaction log. Closed-app/inactive-account books do not execute stops in the background.

## 4. Rollout checks still required

- Real Supabase Auth/PostgREST/RLS with two identities; initial session, logout/relogin, account switching during network delay, and storage quota failures. Local PGlite tests execute real SQL/roles, but stub `auth.uid()` and do not exercise your deployed JWT gateway.
- Authenticated Tiingo TOP/history, symbol/metal entitlements, timestamp/market-session behavior, plan quotas and allowed redistribution. Fixtures do not prove a live account works. Forex Factory availability/week rollover/timezones and shared calendar leases also need deployed verification.
- Actual Redis EVAL behavior, failure/timeout, counters across two replicas, lease expiry/crashed clients, and provider billing/entitlements. Local tests exercise reservation policy and HTTP protocol/fail-closed behavior, not a live Redis service.
- Real browser: chart zoom/crosshair, RSI/MACD, marker detachment, drawings across symbols/accounts, hidden/resumed tabs, touch/rebound simulation, keyboard/mobile layout, focus/contrast, snapshot size and chart-image analysis. jsdom/SDK fixtures are not a graphics or accessibility certification.
- Deployed Vercel routing/CSP/build variables and cold starts; current polling-only capability. A native Beta WS rollout is a separate change.
- Docker build/health checks and full browser performance profiling. The entry bundle warning and oversized brand image remain optimization opportunities, not hidden by increasing Vite's warning limit.

Use `/api/live` for process health/restarts. `/api/ready` returns 503 when `REQUIRED_MARKET_SYMBOLS` lack fresh executable spot quotes, including closed markets. Empty configuration requires all eight, so keyless Yahoo (display-only silver) will not satisfy full spot readiness. `/api/health` returns 200 diagnostics with honest `degraded` status and per-instrument provenance. Do not restart a healthy process repeatedly because a provider is closed/unavailable.

### Rollback posture

Keep v2 and original backups. Disable paid keys/guest AI or serve read-only while investigating; do not restore unsafe legacy writes merely to hide a sync error. A rollback to older code does not understand v2 books and can reintroduce the original account/execution defects. No production SQL, deployment, commit or push was performed by the local verification commands.
