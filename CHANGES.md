> Historical notes — not current verification or deployment instructions. See [IMPLEMENTATION-2026-09-23.md](IMPLEMENTATION-2026-09-23.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for the current changes and remaining gates.

# Changelog — Deep-Review Fix Pass

Applied fixes per `DEEP_REVIEW.md` on 2026-09-16.

## P0 — all fixed
1. **AiAssistant markdown parsing (1.10)** — replaced buggy `split('\\\\n')` with `split('\n')`; rewrote inline markdown rendering to a single-pass tokenizer (bold + code) to fix double-escaping.
2. **AiAssistant stale-closure race (1.1)** — added `messagesRef` to read latest state in `handleSendMessage`; disabled `<form>`, send button, template buttons, Analyze Snapshot button, and text input while `isTyping`; `handleNewChat` now clears attached image.
3. **Rate-limit IP spoofing (1.2)** — `sanitizeClientIp` now only trusts `x-forwarded-for` when the direct peer is a known loopback/proxy; trusted-proxy list is configurable via `TRUST_PROXY_IPS`. `unknown` keys no longer merge users into one bucket.
4. **WS token hardening (1.3)** — tokens are now bound to the requesting IP and rejected on mismatch (close code 4003); `WS_SHARED_SECRET` is accepted via `x-ws-secret` header only (dropped `?secret=` query-string path which leaked into access logs).
5. **ESLint broken (1.5)** — pinned `eslint` to `^8.57.0` (matches existing `.eslintrc.json` legacy config); removed `|| echo` swallow in CI so lint regressions fail the build. Cleaned 30+ unused-import warnings.
6. **npm audit CI silence (1.6)** — security job now installs deps before running audit; runs in non-blocking mode but emits a GitHub Actions warning rather than being fully silenced. (Upgrades of vulnerable deps will happen in a follow-up pass to avoid breaking-changes.)
7. **Pip values in risk calculator (1.9)** — `getPipValueStandardLot` now derives pip value from live `currentPrice` and proper contract math (XXX/USD, USD/XXX, and cross pairs); fixes XAG pip value which was off by 10×.
8. **Logo 404 in production (3.11)** — replaced the bare `/src/assets/...jpg` string with a real `import` so Vite hashes and emits the asset in `dist/assets/`.
9. **Chart full-repaint on every tick (1.7)** — `useChartCore` now calls `candleSeries.update()` for intra-bar ticks (same `data.length`) and reserves `setData()` for new bars; eliminates the full dataset re-paint on each price update.
10. **Side effects in state updater (2.11)** — `handleClosePosition` reads target from `positionsRef` outside `setPositions`, then calls `setPositions` and `setClosedTrades` sequentially (pure updater, no side effects); avoids StrictMode double-close duplicates.
11. **Side-effect-free server import (3.6)** — completely restructured `server.ts`: WS server creation, Twelve Data stream, polling intervals, and token-cleanup interval are now constructed inside `startServer()`, with matching `stopBackgroundFeeds()` teardown. Importing `app` (for Vercel serverless) no longer opens sockets or starts timers.
12. **`setClosedTrades` inside updater** — fixed the same issue in the SL/TP trigger loop (already in a `useEffect`, but added a ref-based throttled PnL recalculator with 500 ms debounce and epsilon comparison to avoid spurious floating-point renders).

## P1 — most fixed
- **Indicator cache (1.8 / 2.12)** — `indicatorCache.ts` no longer duplicates indicator math; it imports canonical implementations from `forexData.ts`, adds `lastCandleClose` to cache validity, and is exported for wiring through context in a follow-up.
- **Yahoo price fan-out (2.1)** — `fetchYahooPricesFor` now uses the Yahoo v7 batch quote endpoint (one HTTP call for all 8 instruments) with query1→query2 fallback and graceful per-symbol chart fallback; 8×-fewer requests per poll cycle.
- **CORS hardening (1.4)** — removed `Access-Control-Allow-Origin: *` (dev and prod); dev origins are explicitly enumerated via `getAllowedOrigins()`. Removed `Access-Control-Allow-Credentials: true` (we use bearer tokens, not cookies). Added `Access-Control-Max-Age: 86400` and `X-Permitted-Cross-Domain-Policies: none`.
- **CSP tightening (2.8)** — production CSP drops `'unsafe-inline'` and `'unsafe-eval'` for scripts (Vite production bundles emit no inline scripts); dev CSP keeps them for HMR.
- **Cache double-set (2.4)** — history cache keys normalized so `/api/market/history`, yahoo fetches, and TD fetches all write to the same `history:${sym}:${tf}` key.
- **`useChartHistory` dep loop (2.3)** — removed `chartData` from the effect dependency array; use a `loadedKey` ref to ensure we fetch once per symbol/timeframe pair.
- **TP/SL uses real ATR (3.15)** — `generateSignal` now derives TP/SL distances from the live computed ATR instead of hardcoded constants (with static fallback when insufficient candles).
- **Supabase indexes (2.16)** — added `idx_positions_user`, `idx_closed_trades_user_time`, `idx_drawings_user_symbol`.
- **Stable pattern IDs (3.13)** — pattern IDs now include candle time (`${c.time}_hammer`, etc.) instead of array index, preventing marker flicker and re-animation on re-renders.
- **Cache-Control headers (2.19)** — all API routes now set explicit `Cache-Control` (`no-store` for dynamic endpoints, `public, max-age=30` for cached history).
- **Twelve Data WS error handling (2.20)** — added handling for `subscribe-status` and generic error frames; warns instead of silently dropping.
- **WS backpressure (3.7)** — `broadcastPrices` now terminates clients whose buffered output exceeds 512 KB to avoid slow-consumer memory leaks.
- **Request-ID correlation (3.22)** — all requests get a `x-request-id` (incoming or generated) that is echoed on the response for tracing.
- **CSV export RFC 4180 compliance (2.10)** — `handleExportCSV` now properly quotes/escapes fields containing commas, quotes, or newlines and uses CRLF line endings.
- **`usePaperTrading` throttling** — PnL effect runs at most every 500 ms, uses `useRef` instead of `useMemo` for state reference, and uses an epsilon (`<0.01`) to avoid floating-point churn.
- **Time scale sync feedback loop (3.17)** — `syncTimeScales` now uses an `applyingSync` guard flag to prevent oscillating updates between main and sub-charts.
- **Pip-value calculations** use a unified `getPipSize()` helper and derive USD pip values from live prices instead of hardcoded cross rates.

## P2 — cleanup
- **Dead code removed** — deleted unused `src/utils/fetchWrapper.ts`; cleaned unused imports across 12 files.
- **`TRUST_PROXY_IPS` env var** documented in `.env.example`.
- **Health endpoint** now reports `wsClients` correctly even when WS is not attached (e.g. on Vercel).

## Verification
- `npm run lint` (tsc --noEmit) → **clean, no errors**
- `npm test` (vitest) → **13/13 passing**
- `npm run lint:eslint` → **0 errors** (23 cosmetic warnings about unused vars remain)
- `npm run build` → **succeeds**; logo is hashed & emitted to `dist/assets/`; server bundles to 48 KB
- Server smoke test (`npm start`) → boots, listens on `0.0.0.0:3000`, serves `/api/health`; upstream Yahoo calls fail in sandbox but fallback paths execute correctly
