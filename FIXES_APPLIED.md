# Fixes Applied — ApexFX Review

All issues from REVIEW.md have been addressed.

## P0 Critical

### 1. Secured `/api/ws/token`
- Added `WS_SHARED_SECRET` env var support: if set, requires `x-ws-secret` header or `?secret=` query to match.
- In production without secret, requires Origin to be in `ALLOWED_ORIGINS`.
- Added rate limiting (10 req/min per IP) on token issuance.
- Added periodic cleanup of expired tokens (60s interval).
- Updated `useWatchlistFeed` to fetch token first, fallback to polling if 403.

### 2. Fixed Dockerfile
- Multi-stage build: builder stage does `npm ci` with devDeps and `npm run build`, production stage does `npm ci --only=production` and copies `dist` + `server` folder.
- Added non-root user `nodejs`.
- Added HEALTHCHECK using `/api/health`.

### 3. Fetch timeouts
- Created `server/lib/fetch.ts` with `fetchWithTimeout` (AbortController, default 8s) and `fetchJsonWithTimeout`.
- All upstream calls (Yahoo, Twelve Data, Frankfurter, Finnhub, ForexRate, OpenRouter, Gemini) now use timeouts 6-15s.
- Frontend `NewsPanel` and `AiAssistant` also use AbortController (7s and 50s).

### 4. Rate limit memory leak
- Created `server/lib/rateLimit.ts` with sliding window + cleanup every 5 min (unref'd).
- Supports optional Upstash Redis distributed limiting via `UPSTASH_REDIS_REST_URL`/`TOKEN`.
- Added `clearAllBuckets`, `getBucketStats`.

## P1 High

### 5. Split server.ts into modules
- `server/lib/logger.ts` — safe logging with redaction
- `server/lib/fetch.ts` — timeout wrapper
- `server/lib/rateLimit.ts` — improved limiter
- `server/lib/security.ts` — CORS, security headers (HSTS, CSP, X-Frame-Options, etc), symbol validation
- `server/lib/cache.ts` — LRU cache with TTL for history (60s) and prices (4s)
- `server/services/market.ts` — watchlist, Twelve Data quotes, Yahoo prices, cooldown logic, env validation for intervals
- `server/services/yahoo.ts` — history fetching with query1→query2 fallback, Twelve Data history, caching
- `server.ts` now imports these modules, reduced from 1056 to ~600 lines, still entry point for Vercel.

### 6. Distributed rate limiting
- Upstash Redis support added (optional). Falls back to in-memory if not configured.

### 7. History caching
- `historyCache` 60s TTL, `priceCache` 4-30s TTL for Frankfurter and watchlist.
- Prevents hammering Yahoo on timeframe switches.

### 8. Split TradingContext god object
- Created hooks:
  - `useTheme.ts` — theme with system preference detection
  - `useClock.ts` — UTC clock
  - `useWatchlistFeed.ts` — WS + polling, tick flashes, initial rates, token handling
  - `useChartHistory.ts` — lazy history loading per symbol/timeframe
  - `usePaperTrading.ts` — positions/closedTrades with debounced localStorage sync (300ms) and throttled PnL
- `TradingContext.tsx` now composes these hooks, keeps same public API but implementation is modular.
- Added guard to avoid replacing chartData when price unchanged (prevents chart teardown).

### 9. AiAssistant history wipe fix
- Greeting initialized only once on mount via lazy state.
- Context update only once via ref guard, doesn't wipe history if user already chatted.
- Added "New Chat" button (RotateCcw) to explicitly reset.
- Added disclaimer about heuristic win rates.

### 10. ESLint + CI
- Added `eslint`, `@typescript-eslint`, `react-hooks` to devDeps.
- Added `.eslintrc.json`.
- Added `.github/workflows/ci.yml` (typecheck, test, build, docker build).
- Updated `package.json` scripts: `lint:eslint`, `typecheck`.

## P2 Nice to have

### 11. Chart live update optimization
- `useChartCore` refactored: main chart creation only on symbol/timeframe/theme/height/indicator changes, NOT on drawings.
- Separate effects for `data` (setData) and markers/drawings (priceLines) without full teardown.
- Uses refs for drawings, sessionBlocks, trades to avoid dep churn.
- Fixed `syncTimeScales` feedback loop risk by cleaning up properly.

### 12. Memoized drawings
- Drawings synced via dedicated effect that removes/creates priceLines without recreating chart.

### 13. Health endpoint
- Added `/api/health` returning status, uptime, watchlist size, wsClients, env.

### 14. Security headers
- Added via `securityHeadersMiddleware`: HSTS in prod, CSP, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, etc.

### 15. Heuristic disclaimer
- Added to `generateSignal` return (`disclaimer` field) and UI footer in SignalPanel, PatternPanel, AiAssistant templates.
- Pattern win rates now labeled "Est. Win Rate" and disclaimer in footer.

### 16. PerformanceDashboard robustness
- Fixed `closedAt` fallback to `openedAt` for legacy localStorage data.
- Equity curve sort now uses `closedAt ?? openedAt`.

### Additional improvements
- `getQuoteSyncMs`/`getPollMs` now validate min/max bounds (10s-1h and 5s-2m).
- `PORT` parsing validates range.
- Symbol validation adds length limit (max 20 chars).
- `express.json` limit set to 1mb.
- Vite production serving now ignores `/api/*` for 404 instead of serving index.html.
- `.env.example` updated with `WS_SHARED_SECRET`, `UPSTASH_*`.
- `DEPLOYMENT.md` updated with new env vars, health check, docker-compose example, multi-stage Dockerfile.
- `forexData.ts` now returns structured `breakdown` array for sentiment, avoiding brittle string parsing.
- `SignalPanel` now uses structured breakdown if available, with legacy fallback.

## Verification
- `tsc --noEmit` passes
- `vitest run` 13 tests pass
- `npm run build` succeeds (vite + esbuild)
- `/api/health` returns ok when server runs
