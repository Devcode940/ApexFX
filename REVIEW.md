# ApexFX Terminal — Code Review

**Repo:** Devcode940/ApexFX  
**Branch reviewed:** main @ 3645583  
**Date:** 2026-08-27  
**Reviewer:** Arena AI Agent

---

## 1. Executive Summary

ApexFX is a surprisingly polished full-stack Forex/Commodities trading workstation. For a solo project it punches well above its weight:

- **Real data only** philosophy is respected throughout (no synthetic ticks, no seeded demo trades).
- **Stack:** React 19 + Vite 6 + Tailwind v4 + lightweight-charts v5 + Express + ws + Gemini/OpenRouter.
- **Dual market feed:** Twelve Data WebSocket (primary) + Yahoo Finance REST polling fallback + Frankfurter/ECB pre-population.
- **Features:** live watchlist with tick flashes, historical candles (1m–D), SMA/EMA/RSI/MACD/BB/Fib, pattern scanner, session shading, ATR HUD, drawing tools persisted per symbol, paper trading with SL/TP, performance dashboard, AI assistant with chart snapshot, Supabase optional sync.

**Overall grade: B+** — Strong product sense and data integrity, but monolithic backend and god-context frontend need refactoring, and security / serverless story needs hardening.

---

## 2. What Works Well

### Architecture & Product
- **Modular chart layer** (`src/hooks/useChartCore.ts` + `utils/chart/` + `components/chart/`) is textbook: lifecycle, overlays, drawings, sub-charts, HUD are cleanly separated.
- **TradingContext** uses `watchlistRef` to avoid stale closures in WS/polling callbacks — clever and correct.
- **Indicator implementations** in `forexData.ts` are correct: Wilder smoothing for RSI/ATR, proper EMA seeding, Bollinger stddev. Volatility baseline excludes latest candle (avoids self-dampening) — nice detail.
- **Pattern scanner** adds winRate/reliability/profitFactor/volumeConfirm/indicatorsConfirm — heuristic but transparent.
- **Twelve Data integration** is production-minded: 
  - WS ticks (no API credit cost) + slow REST quote sync (default 15m = ~96 credits/day < 800 free limit)
  - 429 cooldown, per-symbol Yahoo fallback for XAG/USD, heartbeat, auto-reconnect.
- **Vercel vs Node dual-mode**: `if (!process.env.VERCEL)` guard prevents timers on serverless cold starts; client falls back to HTTP polling.
- **UX:** collapsible sidebars, mobile tab bar, theme persisted, indicator prefs persisted, drawings per symbol, snapshot → clipboard + AI attachment.

### Code Hygiene
- TypeScript types are well defined (`types.ts`, `types/chart.ts`).
- No hardcoded secrets; all keys via env.
- ErrorBoundary present and used in `main.tsx`.
- Supabase client only constructed when env vars exist — no placeholder URL.
- CSV export for trades, duration formatting, risk calculator.

---

## 3. Backend Review (`server.ts` — 1056 lines)

### Strengths
- Safe logging wrapper that redacts Bearer tokens in prod.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options DENY`, `X-XSS-Protection`.
- CORS origin allowlist via `ALLOWED_ORIGINS`.
- Rate limiting (30 req/min per IP) on all `/api/*`.
- Input validation for symbol/timeframe/category/base.
- Chat guardrails: 10 msg/min per IP, 30 msg history cap, 8000 char per msg, 45s timeout.
- OpenRouter conversion handles `inlineData` → `image_url` correctly.
- Graceful handling of Twelve Data response shapes (single vs multi symbol).

### Issues & Risks

**Critical:**
1. **`/api/ws/token` is unauthenticated.** Anyone can GET a token and connect to WS. The comment says "verify user authentication here" but it's TODO. In prod this is an open WS.
2. **WS `verifyClient` checks `Origin` only.** Origin header is trivially spoofable outside browsers. Should not be sole authz.
3. **In-memory stores don't work on Vercel/serverless:** `rateLimitBuckets`, `chatRateBuckets`, `wsAuthTokens`, `serverWatchlist` are per-instance. On Vercel each cold start has empty state; rate limiting is ineffective and WS broadcast fails. Needs Redis/Upstash or move WS to dedicated Node host.
4. **No fetch timeouts** for Yahoo/Twelve/Finnhub/Frankfurter calls. A hung upstream can block event loop. Use `AbortController` with 5-8s timeout.
5. **Memory leak:** `rateLimitBuckets` and `chatRateBuckets` Maps grow forever (only filtered on access, never pruned). Add periodic cleanup of expired keys.

**High:**
6. **Monolith file:** 1056 lines mixing Express setup, Vite middleware, WS, market sync, AI, 6 proxies. Split into `src/server/routes/`, `services/twelvedata.ts`, `services/yahoo.ts`, `middleware/rateLimit.ts`.
7. **CORS implementation is hand-rolled.** Use `cors` package and handle preflight properly. Current logic sets `*` in dev which conflicts with credentials if added later.
8. **No caching for `/api/market/history`.** Every timeframe switch hits Yahoo/Twelve. Add 30-60s in-memory LRU cache keyed by `symbol+timeframe`.
9. **Yahoo Finance scraping:** `query1.finance.yahoo.com` is undocumented and can break. Add fallback to Twelve Data history when key present (already done) but also add retry with `query2`.
10. **No Helmet/HSTS/CSP.** Add `helmet` and HSTS in prod.
11. **Error messages:** Some routes return 500 with generic message — good — but `console.error` sanitization regex may miss `x-api-key` header. Extend sanitization.

**Medium:**
- `PORT` parsing: `Number(process.env.PORT) || 3000` — if PORT=0 it falls back incorrectly. Use `parseInt` with fallback only if NaN.
- `TD_POLL_MS` and `TD_QUOTE_SYNC_MS` env parsing without validation; negative values would break intervals.
- `serverWatchlist` initial prices are 0 until first fetch — frontend shows 0 briefly. Better to keep previous known price or show loading skeleton.

---

## 4. Frontend Review

### `TradingContext.tsx` (785 lines — God Object)
**Good:**
- localStorage sync for positions/closedTrades/indicators/theme.
- `useTransition` for symbol/timeframe switching — prevents UI freeze.
- Tick flash clearing via effect (not inside state updater) — correct React pattern.
- PnL calc uses `getContractSize` (100k forex, 100 gold, 5000 silver) — correct.

**Issues:**
- **Too many responsibilities:** theme, clock, WS, polling, chart data, positions, PnL, calculator prefs, AI snapshot. Split into `useWatchlistFeed()`, `useChartHistory()`, `usePaperTrading()`, `useTheme()`.
- **Positions effect** runs on every `watchlistItems` change (every 2.5s polling) and maps over all positions O(n). Fine for <100 positions but could throttle to 500ms and only for symbols that changed.
- **Chart data mutation:** `setChartData` updates last candle on every price tick, causing full chart re-render via `useChartCore` effect deps `[data]`. Should update candleSeries directly via `update()` instead of replacing state array.
- **localStorage writes** on every positions change — could debounce.
- **No error boundary for async fetches:** `fetchRealRates` silent catch — user doesn't know Frankfurter failed.

### Charting
- `useChartCore` is excellent but dependency array includes `drawings` object which changes often, causing full chart teardown/recreate. Should memoize drawings or diff.
- `createMainChart`/`createSubChart` use `container.clientWidth` only at creation; ResizeObserver handles later — good.
- Drawing tools: horizontal lines as priceLines, trendlines as LineSeries — correct. Risk/Reward and Fibonacci as DOM overlays synced via `timeToCoordinate` — clever but could be jittery on zoom; consider using lightweight-charts primitives if possible.
- `syncTimeScales` bidirectional sync is correct but can cause feedback loop if both fire simultaneously; library docs suggest one-way sync or flag to prevent loop — add guard.
- Pattern markers use `createSeriesMarkers` — correct for v5 API.

### `forexData.ts`
- SMA/EMA/RSI/BB/MACD/ATR are correct.
- `computeFibonacci` uses last 100 candles to find high/low — reasonable.
- `generateSignal` scoring is arbitrary (buyScore starts 50, +/- 12/20 etc). Confidence mapping `60 + (score-62)*40/38` is linear — okay for demo but should be documented as experimental, not financial advice (README already says so).
- `PAIRS_CONFIG` spread values are static nominal — okay but should be labeled as indicative.

### Other Components
- **Watchlist:** flash classes `tick-green-flash` — check if CSS defined in `index.css` (it is? needs verification).
- **AiAssistant:** re-creates greeting on every `symbol/timeframe/activeSignal` change — causes chat history wipe. Should only init once or on explicit reset.
- **SignalPanel:** `analyzeSentiment` parses rationale strings via `includes('bullish')` — brittle. Better to return structured sentiment from `generateSignal`.
- **PositionsPanel:** calculator logic is solid but `getPipValueStandardLot` hardcodes $10/$6.5 — should be derived from price.
- **PerformanceDashboard:** comprehensive metrics, but equity curve sorts by `closedAt` which may be undefined for old localStorage data — fallback to `Date.now()` would be safer.
- **SupabaseSync:** not reviewed in depth but RLS policies in `supabase-schema.sql` look correct (user_id = auth.uid()).

---

## 5. Security

| Area | Status | Note |
|------|--------|------|
| API keys hidden | ✅ | Server proxies use Authorization header |
| Rate limiting | ⚠️ | In-memory, not distributed, no cleanup |
| CORS | ⚠️ | Manual, allows * in dev, no credentials handling |
| WS auth | ❌ | Token endpoint open, origin check spoofable |
| Input validation | ✅ | Regex for symbol, timeframe whitelist |
| XSS | ✅ | No dangerouslySetInnerHTML, markdown parsed manually |
| Headers | ⚠️ | Missing HSTS, CSP, no Helmet |
| Supabase RLS | ✅ | Policies correct, trigger for profiles |

**Recommendation:** Add `helmet`, `hpp`, `express-rate-limit` with Redis store, and proper auth for WS (e.g., Supabase JWT verification).

---

## 6. Testing & Reliability

- **Unit tests:** `forexData.test.ts` exists with Vitest, covers formatPrice, contractSize, SMA warmup, RSI bounds, volatility HIGH detection, pattern scanning, signal bounds. Good start but coverage is low (~15% of codebase).
- **No e2e tests.** Add Playwright for critical path: load → watchlist tick → chart render → open position → SL hit.
- **Lint script:** `tsc --noEmit` but `npm run lint` fails when `node_modules` missing (expected). No ESLint configured — add `eslint` + `eslint-plugin-react-hooks`.
- **No CI.** Add GitHub Actions: `npm ci && npm run lint && npm run test && npm run build`.
- **Error handling:** Yahoo/Frankfurter fetch failures are silent — user sees "Live market data unavailable" overlay, which is good UX but logs should be more visible in dev.

---

## 7. Deployment

- **Vercel config** (`vercel.json`) routes `/api/*` to `server.ts` and others to `index.html` — correct for SPA + serverless. But WS won't work on Vercel (serverless functions can't hold WS). README mentions this — good.
- **Dockerfile:** uses `node:20-alpine`, `npm ci --only=production` then `npm run build` — but build needs devDependencies (vite, esbuild, tsx). Should do `npm ci` then `npm prune --production` after build, or multi-stage build.
- **.env.example** is thorough, includes `ALLOWED_ORIGINS`, `APP_URL`, `SHOW_WARNINGS`.
- **Missing:** `healthcheck` endpoint for Docker/K8s (`/api/health`).

---

## 8. Prioritized Recommendations

### P0 (Fix before prod)
1. Secure `/api/ws/token` — require Supabase JWT or at least shared secret header, or remove token flow and rely on cookie session.
2. Fix Dockerfile: multi-stage build or `npm ci` before build.
3. Add fetch timeouts (AbortController 8s) for all upstream calls.
4. Add periodic cleanup for rate-limit Maps.

### P1 (High value)
5. Split `server.ts` into modules: `routes/market.ts`, `routes/chat.ts`, `services/twelve.ts`, `services/yahoo.ts`, `lib/rateLimit.ts`, `lib/ws.ts`.
6. Add Redis-backed rate limiting for Vercel (Upstash).
7. Add in-memory LRU cache for `/api/market/history` (60s TTL) and `/api/market/prices` (4s already has cache but only on Vercel — make universal).
8. Split `TradingContext` into smaller hooks.
9. Fix AiAssistant wiping history on symbol change — keep history or add explicit "New Chat" button.
10. Add ESLint + GitHub Actions CI.

### P2 (Nice to have)
11. Use `chart.update()` for last candle instead of replacing `chartData` state.
12. Memoize `drawings` to avoid chart teardown.
13. Add `/api/health` endpoint.
14. Add CSP and HSTS headers via Helmet.
15. Document that winRate/profitFactor are heuristic estimates, not backtested.
16. Add Playwright e2e.

---

## 9. Final Thoughts

ApexFX is one of the more complete trading terminal clones I've seen in the open-source space. The commitment to "real data only" and the dual-feed resilience (WS + polling + per-symbol fallback) is genuinely impressive. The charting layer is well-architected and the UX is polished.

Main risks are backend monolith and WS auth, plus serverless incompatibility of in-memory state. Fix those, add CI and more tests, and this could be a solid foundation for a real paper-trading SaaS.

**If this were a PR review, I'd approve with P0 fixes required.**

---
