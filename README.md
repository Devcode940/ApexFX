# ApexFX Terminal

A React/TypeScript market-analysis workstation with a **paper-trading journal**, charts, and an optional AI assistant. No order is routed to a broker. Market availability, provider entitlements, and data freshness must be evaluated separately from whether the app is running.

**Start here:** [Tiingo & weekly calendar setup](TIINGO-FOREXFACTORY.md) · [Deployment and migration](DEPLOYMENT.md) · [Implemented fixes, evidence, and alternatives](IMPLEMENTATION-2026-09-23.md) · [Baseline review](REVIEW-2026-09-22.md)

## Current behavior

- **Honest market data:** Tiingo REST is the preferred quotes/history provider on both Node and request-driven Vercel. Unavailable instruments can fall back to configured Twelve Data, then Yahoo; `MARKET_ALLOW_FALLBACKS=false` makes the app Tiingo-only. Quotes carry provider, provider symbol, instrument kind, observation time, and receipt time. Positive prices without valid provenance/freshness cannot execute orders. No random positive prices or demo trades are generated; automated tests use fixtures.
- **Tiingo midpoint, not broker fills:** timestamped bid/ask TOP snapshots produce an explicitly labeled midpoint. Missing daily change is shown as unavailable. The browser Node WebSocket may deliver these **polled** snapshots; there is no upstream Tiingo streaming implementation.
- **Spot execution only:** Yahoo's silver `SI=F` is a continuous **futures proxy**, displayed and labeled, not an executable `XAG/USD` spot quote. Frankfurter is daily working-day reference data, never a trading feed. Historical display fallback does not enable the order ticket.
- **USD journal:** quote-currency P&L is retained alongside nullable USD P&L and conversion provenance. USD-base pairs use their exit/mark rate; JPY crosses need a fresh USD/JPY conversion. Realized conversion is frozen. Unknown legacy conversion/marks are shown as unavailable and excluded from known-USD statistics, not silently counted as dollars or zero.
- **Ordered simulation:** every accepted quote event reaches the atomic book before React presentation. Touch/rebound events are not discarded by a UI throttle. Stops fill at the adverse observed gap price; targets at the configured target. Closures link to stable position IDs. This does **not** simulate spread, fees, margin, unseen intrapoll paths, or execution while a book is inactive/the app is closed.
- **Demo preview mode:** `APEX_DEMO_FEED=true` (development only) serves deterministic synthetic quotes, history and calendar events — every one labelled `demo`, with reference quality so the paper engine refuses to trade on them. Production builds ignore the flag.
- **Weekly data:** `W` candles aggregate available daily OHLC into Monday–Sunday UTC buckets, preserving gaps and marking current/incomplete first weeks. The default fundamentals panel is the Forex Factory **current-week economic calendar**, cached hourly, with currency/impact/upcoming filters and local/UTC time. Missing release values remain “—”; the calendar never supplies prices, trade signals or fills.
- **Charts:** abortable/retryable history, sparse provisional UTC quote buckets, authoritative reconciliation, retained indicators and marker plugin, and account/symbol-scoped drawings. Quotes only merge into history with the same provider, provider symbol and instrument kind. Cached-history reconciliation retains later observed extrema. Non-UTC provider-session bars stay intact and use history refresh rather than incompatible quote aggregation.
- **Heuristics, not probabilities:** candle confluence is a causal ranking, not a calibrated win rate. Ledger win rate/profit factor describe simulated observations in the selected scope, not future accuracy. No-loss profit factor is displayed explicitly, not as a made-up `99.9`.
- **Optional cloud journal:** one versioned JSON book per account with compare-and-swap revisions, closure/deletion tombstones, and an account-bound save RPC. Guest and each account are separate. Legacy data is never automatically assigned/uploaded; original storage and old cloud tables are preserved for explicit review/export.
- **Optional paid AI:** verified Supabase account by default, or explicitly enabled small guest quotas. Bounded text/image/output, account/global daily budgets, concurrency leases, cancellation and one Gemini SDK attempt. Production paid work fails closed without its shared budget store. The assistant does not have live market/news tools; provide a snapshot or relevant data when asking about a chart.

## Run locally

Use **Node 24 LTS** (`.nvmrc`, package engine, CI and Docker agree).

```bash
nvm use
npm ci
cp .env.example .env
npm run dev
```

Express and Vite share port 3000 and bind `0.0.0.0`. Browser API calls are relative `/api/...` URLs. For an Arena/tunnel development preview, add its host suffix, for example `VITE_ALLOWED_HOSTS=.e2b.app`; do not hardcode a sandbox localhost URL in browser code.

Set `TIINGO_API_KEY` in the server environment for Tiingo (never in `VITE_*` or chat). Forex Factory requires no source key; Vercel requires shared Redis caching even for the public calendar. No keys are needed to **attempt** Yahoo quotes/history when fallbacks are enabled. This is not an availability guarantee; stale/unavailable data remains visibly unavailable. Configure public Supabase build variables for accounts/cloud, a supported explicit AI model and key for AI, and the shared budget service before enabling paid production integrations. See [.env.example](.env.example); never put a provider or service-role secret in a `VITE_*` variable.

## Verify / build

```bash
npm run verify       # typecheck, zero-warning lint, tests, build, offline production smoke
npm audit
NODE_ENV=production npm start
```

- Static files: `dist/client/`.
- Private Node bundle/map: `dist/server.cjs` and `.map`, outside the static root.
- Node entry: `server/start.ts`; importing `server.ts` does not start background services/listeners.
- `npm run test:smoke` boots the built server offline, checks SPA/gzip/API errors/readiness/private paths, and shuts it down. Build first.
- `npm run probe:live` is a compatibility name for **local fixture and offline smoke checks**, not a paid/live-provider test.
- `npm run preview` is Vite's static-only preview; use the full-stack development or production command for working API routes.

Tests include real React effect/StrictMode lifecycles in jsdom, SDK-boundary chart fixtures, real local HTTP/WebSocket requests with mocked upstreams, and real PostgreSQL SQL/roles/RLS in PGlite. These are **not** real-browser visual tests or deployed Supabase/Redis/Vercel verification.

## Migration required for cloud v2

Read [DEPLOYMENT.md](DEPLOYMENT.md) **before** applying SQL or retiring older clients:

1. Back up local and cloud data.
2. Apply `supabase/migrations/20260923_paper_books.sql` in the intended Supabase project.
3. Verify with two real accounts, deploy the frontend/backend together, then run the separate `20260923_freeze_legacy_books.sql` cutover step to stop obsolete row writers.
4. Review and explicitly import unscoped legacy local data. Export legacy cloud tables for reconciliation; there is no unsafe old-schema write fallback.

The account panel can export a v2/raw backup and validate/restore a v2 backup. Wrong-owner wrapped backups are rejected. Corrupt originals are preserved before repair. Signing out hides an account's book, **not** erases/encrypts its local data.

## API / transport summary

| Route | Purpose |
|---|---|
| `GET /api/live` | Process liveness, no provider or Redis dependency |
| `GET /api/ready` | Required instruments have fresh executable spot quotes; otherwise 503 |
| `GET /api/health` | 200 diagnostic body with `ok`/`degraded`, per-instrument quality and failure streak |
| `GET /api/capabilities` | Explicit transport support; no trial-and-error WS loop on Vercel |
| `GET /api/market/prices` | Timestamped watchlist quotes; 503 if none are executable |
| `GET /api/market/history?symbol=EURUSD&timeframe=W` | Validated weekly OHLC; periods `1m`, `5m`, `15m`, `1H`, `4H`, `D`, `W`, with actual provider metadata |
| `GET /api/market/calendar?week=this` | Forex Factory current-week events, retrieval time, stale flag, coverage and source attribution |
| `GET /api/market/quote?symbol=EURUSD` | A quote from the same watchlist/provider/cache, not another per-tab paid feed |
| `GET /api/forex` | Daily reference rates only |
| `GET /api/market/news`, `/api/market/forexrate` | Optional legacy bounded/cached proxies (not the default calendar panel) |
| `POST /api/ws/token` | Short-lived, single-use, IP/origin-bound nonce; optional verified account / header-only service secret |
| `POST /api/chat` | Authenticated or explicitly capped guest AI request |

On persistent Node, upgrade **`/ws?token=...`** with the issued nonce. The shared secret is never accepted in a query string. Origin checks are a browser boundary, not authentication; read-only HTTP quotes remain public.

Vercel supports WebSockets in Beta, but **this repository's current HTTP function/rewrite is deliberately polling-only**. Native WS routing, lifecycle and shared state would need separate integration and verification, not just removal of a guard.

## Important limits

This remains an educational simulator, not an authoritative broker ledger. Use one active trading tab per local book. LocalStorage is not cross-tab transactional storage or encryption. Cloud books are bounded (5,000 identities/collection limits, 2 MiB SQL document limit); tombstones must not be casually deleted to reclaim space. Concurrent offline closes converge by a documented deterministic policy, not exchange execution order. Tiingo credentials/entitlements, provider hourly/daily limits and data redistribution rights need operator verification; the conservative app budgets are not a 24/7 feed guarantee. See [data-provider setup and limits](TIINGO-FOREXFACTORY.md) and the implementation critique for alternatives and remaining browser/performance/operational work.
