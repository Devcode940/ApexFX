# Tiingo prices + Forex Factory weekly calendar

Implemented 2026-09-23. Scope: **both weekly price candles and the weekly economic calendar**. This extends the earlier [fixes checkpoint](IMPLEMENTATION-2026-09-23.md); account-bound books, USD valuation, quote eligibility and paid-service safeguards remain in place.

## What changed

- **Tiingo REST is the preferred price/history source** on Node and the request-driven Vercel path. Quotes batch the eight catalog tickers. Every result retains its actual provider, provider symbol, instrument kind, observation and receipt times.
- **W** is available in all three chart timeframe selectors. Canonical weekly history is aggregated from available **daily OHLC**, Monday 00:00 UTC to the next Monday. No synthetic missing weeks or volume. Current and incomplete first weeks are provisional; a later matching quote can extend/seed an explicitly provisional observed bar. Intraday session shading is disabled for D/W.
- The default fundamentals panel is now **Weekly Economic Calendar**, using Forex Factory’s current-week JSON export. Currency, high-impact, upcoming/untimed, local/UTC and pagination controls filter one cached dataset. They do not trigger a provider request per symbol/filter.
- Calendar events are not prices or automatic trading signals. Missing actual/forecast/previous values remain null/“—”. A passed scheduled time does **not** prove a release occurred. Holidays/TBA do not acquire invented scheduled times, and untimed events retain their source date.
- The calendar source-week check uses **Sunday in America/New_York**; chart W uses **Monday UTC**. Scheduled instants display in the browser timezone (including Africa/Nairobi) or UTC. The UI explicitly explains the difference.

## Enable it

Use Node 24. Keep existing private configuration; create `.env` from `.env.example` only if you do not already have one.

1. Put your **Tiingo FX-enabled token in server-only `TIINGO_API_KEY`**. Never use a `VITE_` variable, paste it into chat, or put it in a client URL. REST authentication uses the `Authorization: Token …` header.
2. Check your account’s FX/history permissions, metal coverage and redistribution agreement. `xauusd`/`xagusd` are requested but their availability is **not** assumed. This implementation has not made an authenticated Tiingo request.
3. Configure both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` before enabling paid production work. They also provide the shared calendar snapshot and refresh lease. Vercel always requires shared calendar caching; replicated Node deployments should set `FOREX_FACTORY_REQUIRE_SHARED=true`.
4. Leave `FOREX_FACTORY_ENABLED=true`. Forex Factory’s public weekly export needs **no source API key**. Keep `MARKET_ALLOW_FALLBACKS=true` for Tiingo → configured Twelve Data → Yahoo, or set it to `false` for Tiingo-only behavior.
5. Set provider budgets/cadence for the actual plan, restart the server after configuration changes, and verify the actual returned sources—not just HTTP 200. See [deployment](DEPLOYMENT.md) for production runtime, Auth, security and existing cloud migration requirements.

```bash
npm ci
npm run dev
```

The server binds `0.0.0.0:3000`; browser requests use relative `/api/...` routes. Arena/tunnel previews need the trusted host configured, for example `VITE_ALLOWED_HOSTS=.e2b.app`.

### Main settings

| Setting | Default / behavior |
|---|---|
| `TIINGO_API_KEY` | Unset; server-only FX token |
| `TIINGO_POLL_MS` | 90,000 ms TOP cache; clamped to 10,000–120,000 ms |
| `TIINGO_HISTORY_CACHE_MS` | 600,000 ms OHLC cache; clamped to 60,000–3,600,000 ms |
| `TIINGO_DAILY_REQUESTS`, `TIINGO_DAILY_UNITS` | 900 each per UTC day; one request + one unit reserved per REST attempt |
| `MARKET_ALLOW_FALLBACKS` | Enabled unless exactly `false`; unavailable Tiingo-only data stays unavailable |
| `FOREX_FACTORY_ENABLED` | Enabled unless exactly `false`; also disabled by offline mode |
| `FOREX_FACTORY_REQUIRE_SHARED` | Opt-in on Node; always required on Vercel |
| `UPSTASH_REDIS_REST_*` | Shared paid budgets and calendar cache/lease; server-only credentials |

**Defaults are safety limits, not a 24/7 entitlement promise.** At 90-second intervals, continuously polling TOP alone would theoretically use about 960 requests/day. The lower 900-reservation default intentionally caps that load. One continually viewed history adds roughly 144/day at the default ten-minute cache; additional symbols/timeframes and cold replicas add more. A chart still revalidates the app API every minute, but cached Tiingo OHLC is not refetched every minute. Tune the provider plan, budgets and cadence together, and alert on exhaustion. The app’s daily counters do not replace provider hourly limits, spend caps or licensing rules.

The production `PAID_BUDGET_MODE=single-process` exception remains available **only** for one persistent non-Vercel process; its counters reset on restart. Prefer shared Redis. Market HTTP data is public by default: optional WebSocket authentication alone does not make those endpoints private or establish redistribution rights.

## Data and transport rules

### Tiingo

Implemented upstream paths:

- `GET https://api.tiingo.com/tiingo/fx/top?tickers=…`
- `GET https://api.tiingo.com/tiingo/fx/<ticker>/prices?startDate=…&resampleFreq=…`

TOP quotes require positive, uncrossed bid/ask and a provider timestamp. The app calculates **midpoint**, rather than trusting a history close or manufacturing a receipt-time quote. TOP does not supply the daily-change statistics this UI previously expected, so Tiingo daily change is explicitly unavailable.

The paper engine continues its observed-single-price policy: **Tiingo fills use midpoint, not spread-aware broker bid/ask fills**. A quote still needs current provenance/freshness (120-second age window); history or calendar data cannot enable orders. Yahoo `SI=F` remains a labeled, non-executable silver-futures proxy.

Tiingo uses bounded, coalesced, cached REST requests, eight-second/2 MiB upstream limits, negative cooldowns, Retry-After and the existing fail-closed paid budget layer. Health exposes a sanitized failure category and retry time, never a token. Cached history retains its original `fetchedAt`, so a repeated cached snapshot does not erase newer observed extrema.

A quote only merges into chart history when **provider, provider symbol and instrument kind all match**. A provider switch drops incompatible local extrema; mismatches are shown and cannot silently supply automatic SL/TP suggestions.

This is **not an upstream Tiingo WebSocket implementation**. The Node browser WebSocket can broadcast polled snapshots. A configured Tiingo token suppresses the older upstream Twelve Data stream. Higher-frequency upstream streaming would need separate connection, entitlement, quota, reconnect and deployment work.

### Forex Factory

The fixed source is `https://nfs.faireconomy.media/ff_calendar_thisweek.json`, attributed to `https://www.forexfactory.com/calendar` in the UI. Only the current export is supported; arbitrary past/next-week parameters are rejected.

- At most one attempted upstream refresh/hour per cache coordinator, **including failed/HTML responses**. Longer Retry-After values are honored. ETag validation is used when supplied.
- Last-known-good data survives failures with a visible warning. Snapshots from another source week are marked stale even if just retrieved. The server stops serving snapshots older than eight days.
- A single persistent Node process can use a local cache. Restart loses that local cache/cooldown; it is not a cross-process guarantee.
- With Redis, replicas use a shared snapshot and an atomic `SET NX PX` hourly refresh lease. The lease remains after failure; a losing replica waits for the shared result rather than hitting the source. Cache read failures do not authorize bypassing the shared lease.
- Vercel refuses direct source fetching without that shared cache. Use the same shared store for replicated Node servers; actual deployed Redis behavior still needs verification.
- The browser has a 15-second request/body abort deadline, hourly revalidation, hidden-tab handling, last-good-data preservation and Retry-After protection, including manual refreshes.

No website HTML scraping, alternate-format/proxy bypass, random sentiment, invented release values or live-release-feed claim. If you need complete actuals, revisions, historical calendars or release-time latency/SLA, choose a provider/contract that explicitly supplies them rather than treating this weekly export as that service. The AI assistant has not gained live calendar tools from this UI integration.

## Verify after configuration

These are app routes; do not put the Tiingo token in them:

```text
GET /api/health
GET /api/market/prices
GET /api/market/history?symbol=EURUSD&timeframe=W
GET /api/market/calendar?week=this
```

Inspect:

- `feed.tiingo.configured`, `lastFailure`, `retryAt`, and actual per-instrument source/quality in health. “Configured” only means a key is present, not that the account authenticated successfully.
- Quote `provider: "tiingo"`, `priceBasis: "mid"`, and valid `asOf`. Check each required pair/metal separately.
- History `source: "tiingo"`, correct `providerSymbol`, Monday weekly timestamps and provisional flags. A successful Yahoo fallback is still **Yahoo**, not proof of Tiingo access.
- Calendar `source: "forexfactory"`, `fetchedAt`, `stale`, `currentWeek`, event coverage, original offset dates and nullable values.
- On Vercel/two replicas: shared calendar refresh ownership, actual Redis failures/expiry, paid counters and cold-start load. Do not repeatedly force source downloads to test availability.

Use `/api/live` for process health, not `/api/ready` during closed/stale markets. None of these changes deploy the app, create accounts, purchase a plan or apply SQL to a real project.

## Verification completed in this workspace

- Clean locked install on Node 24 / npm 11.
- `npm run verify`: typecheck, zero-warning lint, **327 tests in 33 files**, production build and offline built-server smoke **passed**.
- `npm audit`: **0 reported vulnerabilities** at this checkpoint.
- Diff whitespace checks, main documentation links and a tracked/new nonignored credential-pattern scan passed. The built client contains no Tiingo REST endpoint/key identifier or Redis secret identifier.
- Permanent tests cover Tiingo normalization/header secrecy/batching/budgets/fallback, daily-to-weekly aggregation, Monday/Sunday/year boundaries, source-consistent reconciliation, Forex Factory parsing/hourly and shared cache behavior, HTML/429 handling, React cancellation/StrictMode, local filtering/pagination and Nairobi/UTC/all-day timezone behavior.
- API regressions use real local HTTP/WebSocket servers with **fixture upstreams**, not paid/live Tiingo calls. The smoke test explicitly disables provider/calendar fetching.
- One public Forex Factory export was retrieved during schema research. That is not an uptime/SLA guarantee or live Redis/deployment verification. **Authenticated Tiingo, real Redis, real-browser visuals, Docker and deployed Vercel remain unverified.**

The build still reports the pre-existing >500 kB entry-chunk warning: the current entry is approximately 545.74 kB / 156.34 kB gzip. The 338.32 kB logo remains an optimization opportunity. Neither warning is hidden by relaxing thresholds.

Protocol references used during implementation: https://www.tiingo.com/documentation/forex, https://www.tiingo.com/documentation/general/connecting, https://www.tiingo.com/products/forex-api. Recheck current permissions, quotas and reuse terms before deployment.
