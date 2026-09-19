# ApexFX Terminal 📈⚡

ApexFX Terminal is a high-performance, next-generation **multi-confluence Forex and Commodity trading workstation**. Designed with desktop-first precision and responsive mobile adapters, this full-stack terminal provides professional traders with live quotes, real historical interactive charting, dynamic volatility risk indicators, and real-time AI-powered confluence analytics.

> **Data integrity:** the terminal serves **real market data only**. There is no synthetic price generator, no placeholder quotes, and no seeded demo trades. All prices, candles, news, and AI analysis come from live upstream sources (Twelve Data, Yahoo Finance, ECB/Frankfurter, Finnhub, Gemini/OpenRouter); the only static values are instrument metadata (pip decimals, contract sizes, nominal spreads) and locally computed indicators, patterns, and paper-trade P&L.

---

## 🌟 Core Features

### 1. Real-Time Data Pipeline
* **Dual-Streaming Engine**: live WebSocket updates plus a reliable background HTTP polling fallback, so the price feed stays active even behind restrictive firewalls or through connection drops.
* **Primary source — Twelve Data** (when `TWELVEDATA_API_KEY` is set): the server opens a Twelve Data WebSocket stream (`wss://ws.twelvedata.com/v1/quotes/price`) subscribed to all 8 instruments for low-latency tick prices (WebSocket credits only, not API credits), plus a REST quote sync for day high/low/change every **15 minutes** by default (`TWELVEDATA_QUOTE_SYNC_MS`). If the stream drops, it reconnects automatically and REST polling takes over until it is back.
* **Fallback source — Yahoo Finance**: without a Twelve Data key (or for any symbol Twelve Data fails to cover), the server polls real Yahoo quotes every **5 seconds** (`interval=1m&range=1d`). No random ticks are injected between syncs — every price is fetched from an upstream exchange feed.
* **Covered instruments**: `EUR/USD`, `GBP/USD`, `USD/JPY`, `AUD/USD`, `USD/CAD`, `GBP/JPY`, plus precious metals `XAU/USD` (Gold) and `XAG/USD` (Silver). Silver is served from COMEX silver futures (`SI=F`) because Twelve Data free plans omit `XAG/USD` and Yahoo has no silver spot feed.
* **Secondary rate sync**: on load the watchlist is pre-populated from the configured ForexRate API (falling back to the public Frankfurter/ECB API at `/api/forex`) until the WebSocket feed takes over.

### 2. High-Precision Charting & Confluence Overlays
* **Real historical candlesticks**: live price history from Yahoo Finance for `1m`, `5m`, `15m`, `1H`, `4H` (aggregated from hourly data server-side), and `D`.
* **Built on lightweight-charts v5** with a modular chart core (`src/hooks/useChartCore.ts`, `src/utils/chart/`, `src/components/chart/`):
  * **Multi-Indicator Confluence Matrix**: quick-toggle overlays for SMA & EMA, RSI, MACD, and Bollinger Bands, plus automatic Fibonacci retracement levels.
  * **Candlestick pattern markers**: bullish/bearish/neutral formations (Engulfing, Hammer, Shooting Star, Doji, Morning/Evening Star) rendered as markers with win-rate scoring.
  * **Session range HUD**: custom session shading for Tokyo/London/New York/Sydney hours.
  * **ATR volatility HUD**: live risk classification (LOW / MEDIUM / HIGH) relative to historical norms.
  * **Drawing tools**: horizontal support/resistance lines, trendlines, annotations, Risk/Reward rectangles, and Fibonacci retracements — persisted per symbol in `localStorage`.
  * **Trade animations**: open positions and closed trades overlaid on the chart.
* **Chart snapshots**: one-click screenshot copied to clipboard and attachable to the AI assistant.

### 3. Integrated AI Assistant
* **Real AI engine — Gemini or OpenRouter**: built-in chat container with recent conversation history (server caps at the last 30 messages), chart-image understanding, and automatic market context injection (active symbol, timeframe, latest signal, indicators). Uses `GEMINI_MODEL` (default `gemini-3.5-flash`) via `@google/genai` — the id is configuration, not a literal, because Google's retirement cadence breaks hardcoded model names; setting `OPENROUTER_API_KEY` routes chat through OpenRouter instead (`OPENROUTER_MODEL`, default `openrouter/auto`).
* **Server-side hardening**: in-memory rate limiting, payload size caps, history truncation, and a 45s request timeout.
* **No canned fallbacks**: if the AI service is unavailable, the terminal surfaces the real error instead of fabricating an offline answer.

### 4. Auxiliary Panels
* **Pattern Scanner**: analyzes the real candlestick sequence to isolate classical price-action patterns with profitability scoring.
* **Live News Feed**: macroeconomic headlines from Finnhub (requires `FINNHUB_API_KEY`).
* **Position execution panel**: paper-trading engine that opens/closes demo positions **priced from the live market feed**, with stop-loss / take-profit triggering and P&L in real time.
* **Performance Dashboard**: win rate, profit factor, equity curve, holding-time and symbol breakdowns, with CSV export.
* **Supabase Sync (optional)**: authenticate and sync positions/trades to a Supabase project when credentials
  are configured. Keys are per-user (`PRIMARY KEY (user_id, id)`), pulls **merge** into local state rather
  than replacing it, and `pips` is computed from the same `PAIRS_CONFIG` precision the UI uses. Existing
  databases need the migration block at the end of `supabase-schema.sql`; until then the client upserts on the
  legacy `id` key and logs a warning, so nothing breaks — it just stays collision-prone.

---

## 🛠️ Technology Stack

* **Frontend**: React 19, Vite 6, Tailwind CSS v4, lightweight-charts v5, Lucide Icons, Recharts, Motion animations.
* **Backend**: Express.js on Node.js with a native WebSocket server (`ws`).
* **APIs & Data**: Twelve Data (WebSocket ticks + REST quotes + history), Yahoo Finance REST API (fallback quotes + history), Frankfurter (ECB rates), Finnhub (news), ForexRate API, Google Gemini API / OpenRouter (AI).
* **Quality**: TypeScript type checking (`npm run typecheck`), ESLint 9 flat config with `--max-warnings=0` (`npm run lint`), `strict: true` in `tsconfig.json`, and 107 Vitest tests (`npm test`) across the client trading math *and* the server security/limits layer. CI fails on any of them plus a prod-bundle boot smoke test, a secret scan, and a Docker healthcheck test.

---

## 🚀 Getting Started

### Prerequisites
* Node.js (v18 or higher recommended)
* NPM or Yarn

### Environment Setup
Create a `.env` file at the root of the project (using `.env.example` as a template):

```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash        # never hardcode a model id: 2.0-flash was retired 2026-06-01
# TRUST_PROXY=1                      # only needed for a proxy on a PUBLIC address; the default
#                                    # auto-trusts X-Forwarded-For from loopback/private peers only,
#                                    # and TRUST_PROXY=0 disables header trust entirely
# LOG_LEVEL=info                     # silent|error|warn|info (default: warn in prod, info in dev)
# Alternative AI provider — set either GEMINI_API_KEY or OPENROUTER_API_KEY
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=openrouter/auto
TWELVEDATA_API_KEY=your_twelvedata_key_here  # recommended — primary live feed
FINNHUB_API_KEY=your_finnhub_api_key_here    # optional — live news
FOREXRATE_API_KEY=your_forexrate_key_here    # optional — rate cross-check
VITE_SUPABASE_URL=your_supabase_project_url  # optional — account sync
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

The AI assistant needs **`GEMINI_API_KEY` or `OPENROUTER_API_KEY`**. **Adding `TWELVEDATA_API_KEY` makes Twelve Data the primary live market source** (WebSocket ticks + history). Without it, the market feed falls back to Yahoo Finance — quotes and history work with **no keys at all**. `FINNHUB_API_KEY` enables the news feed, `FOREXRATE_API_KEY` the rate cross-check, and `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` the account/trade sync (auth + push/pull of positions and closed trades).

> **Twelve Data credits:** the REST `/quote` endpoint costs 1 API credit **per symbol**, so a full-watchlist sync is 8 credits — 96 syncs/day × 8 = **~768 credits/day**, which is most of the free tier's 800/day and does *not* leave headroom. The old README said "~96 credits/day"; that counted requests instead of symbols. As of the 2026-09-13 pass the two *uncontrolled* consumers are gone: the header no longer runs a per-tab 60s poll of `/api/market/quote` (that was ~1,440 credits/day **per open tab**, uncached — it read the same source the watchlist feed already had), and the endpoint now answers from a shared 15s server-side cache under a 10 req/min budget, so 100 tabs cost at most a few credits an hour. Every chart load still costs credits for `/time_series`. Practical guidance on the free tier: `TWELVEDATA_QUOTE_SYNC_MS=3600000` (24 × 8 = 192/day) and rely on the WebSocket for ticks, or run keyless on Yahoo. Paid plans can lower it for fresher high/low/change; the WebSocket stream covers tick-level updates at no API credit cost. Tune with `TWELVEDATA_QUOTE_SYNC_MS` / `TWELVEDATA_POLL_MS`. When Twelve Data returns `429` (per-minute limit reached), REST sync pauses until the next minute instead of hammering the API; the WebSocket stream keeps delivering ticks. Symbols outside the plan (e.g. `XAG/USD` → `403`) automatically fall back per-symbol to Yahoo.

### Installation

```bash
npm install
```

### Running the Terminal

```bash
npm run dev
```
The full-stack development workspace (Express backend + Vite frontend) is live at `http://localhost:3000`.

### Running behind a tunnel or preview proxy

`npm run dev` binds `0.0.0.0`, so a proxied URL works out of the box **except** that Vite's dev server
rejects unknown `Host` headers (DNS-rebinding hardening). If you see `Blocked request. This host ("…") is
not allowed.`, add the domain rather than disabling the check:

```bash
VITE_ALLOWED_HOSTS=.your-preview-domain npm run dev   # leading dot = subdomains
```

Production is unaffected: `npm start` serves a static build and never starts the Vite server.

### Production Build

```bash
npm run build
npm start
```

### Deploying to Vercel

`vercel.json` uses the modern `functions` + `rewrites` shape (the legacy `builds`/`routes` block it
replaced made `api/index.ts` dead code and left the function with a 10 s default while `/api/chat` can
take 45 s). What the split deployment means in practice:

* **Static** — `vite build` output in `dist/` is served by the CDN; `buildCommand` is `vite build`, *not*
  `npm run build`, so `dist/server.cjs` is never uploaded as a publicly downloadable asset.
* **API** — one function (`api/index.ts`) fronts every `/api/*` route. It imports the Express app without
  binding a socket (`server.ts` skips `startServer()` when `VERCEL` is set) and canonicalises `req.url`,
  because the rewrite may deliver the original path, the destination, or the mount-relative remainder;
  `server/lib/vercel.test.ts` asserts all three against the real app.
* **No WebSockets on Vercel functions** — the client tries the socket, fails, and settles into **POLL**
  mode with backoff against `/api/market/prices`. That is a supported state, not an error; the header badge
  says so. `/api/ws/token` is still reachable and simply isn't usable there.
* **Security headers are configured twice, deliberately.** The Express middleware sets them on `/api/*`;
  the CDN serves the HTML, so `vercel.json` `headers` repeats the same policy for static files. That copy
  cannot derive the Supabase origin from `VITE_SUPABASE_URL` the way the server does, so it uses
  `connect-src 'self' ws: wss: https://*.supabase.co` — a wildcard the server-side policy avoids. Tighten it
  to your project URL if that matters for your deployment.
* **`maxDuration: 120`** covers the 45 s AI timeout with margin; the Yahoo/Twelve Data fetches cap at 6–8 s.
* **Rate limiting is per-instance and in-memory** (Upstash Redis if `UPSTASH_REDIS_REST_URL` is set), so on a
  scale-to-zero platform a cold start resets the buckets. That is why the budgets are advisory rather than a
  hard quota; `TRUST_PROXY` is auto-on for Vercel because its edge always forwards.

A deploy from this sandbox cannot be verified, so the parts that depend on platform behaviour are the ones
carried by tests and by explicit config, not by claims.

### Tests & Type Checking

```bash
npm test             # Vitest unit tests (client indicators + server security layer)
npm run probe:live   # boots the real prod server and asserts documented live behaviour
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . --max-warnings=0  (flat config; CI fails on any warning)
```

---

## 🔌 HTTP API Reference

All endpoints return JSON and are safe to call from Postman, `curl`, or any HTTP client. Keys are read from the server environment — never exposed to the browser.

| Endpoint | Method | Description | Requires key |
|---|---|---|---|
| `/api/market/prices` | GET | Live watchlist prices (all 8 instruments) — Twelve Data when configured, else Yahoo Finance | — |
| `/api/market/history?symbol=EURUSD&timeframe=1H` | GET | Real historical candlesticks (`1m`/`5m`/`15m`/`1H`/`4H`/`D`) — Twelve Data when configured, else Yahoo Finance | — |
| `/api/forex` | GET | ECB exchange rates via Frankfurter (USD base) | — |
| `/api/market/news?category=forex` | GET | Macro news headlines (Finnhub) | `FINNHUB_API_KEY` |
| `/api/market/quote?symbol=EUR/USD` | GET | Real-time quote cross-check (Twelve Data) | `TWELVEDATA_API_KEY` |
| `/api/market/forexrate?base=USD` | GET | Rate cross-check (ForexRate API) | `FOREXRATE_API_KEY` |
| `/api/chat` | POST | AI analysis — body: `{ messages, selectedSymbol, selectedTimeframe, activeSignal }` (OpenRouter when its key is set, else Gemini) | `OPENROUTER_API_KEY` or `GEMINI_API_KEY` |

**WebSocket**: connect to `ws://localhost:3000?token=…` — receives `INITIAL_RATES` on open, then `PRICE_UPDATE` messages every ~5 seconds. The token comes from `GET /api/ws/token` and is single-use.

### Security model (as of the 2026-09-13 hardening pass)

* **All `/api/*` routes are rate limited** (30 req/min per client, sliding window; optionally distributed via Upstash). The limiter is registered *before* every route — `/api/health` and `/api/ws/token` used to be registered above it and were effectively unthrottled.
* **Client identity is the socket address, unless a *trusted* proxy said otherwise.** By default `X-Forwarded-For` is honoured only when the connecting peer is itself loopback/private/CGNAT (`TRUSTED_PROXY_RANGES` in `server/lib/security.ts`), so a client that reaches the port directly cannot mint a fresh rate-limit identity — the unconditional header trust that was exploitable at 35/35 requests is gone, and so is the "every user behind nginx shares one bucket" regression that an opt-in-only default caused. A public-address proxy needs `TRUST_PROXY=1`; `TRUST_PROXY=0` disables header trust entirely. Rejected header attempts are logged (max once a minute). Residual risk, stated plainly: a co-tenant on a flat pod/VPC network *is* "private", so it can still choose its apparent IP — that is the trade, not an oversight.
* **Express 4 caveat worth knowing** if you touch this: `trust proxy` as a *predicate* does not work the way the v5 docs read. proxy-addr calls it as `trust(ip, hopIndex)`, so a function inspecting `req.socket` silently trusts nothing (observed: `req.ip` stuck at `127.0.0.1`). Range lists are the supported shape here.
* **`/api/ws/token` is deny-by-default in production**: if `WS_SHARED_SECRET` is set it is compared in constant time; if it is unset, a *matching* `Origin` is required and a missing `Origin` is rejected (a keyless non-browser client no longer gets a token).
* **No secret can reach the logs.** Upstream URLs are reduced to `host + path` before being put into an error message, and the logger redacts `apikey`/`api_key`/`token`/`secret`/`password`/`Bearer` in *every* argument including stack traces.
* **Headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and in production HSTS (without `preload`) plus a CSP whose `connect-src` is `'self'` + the WebSocket + the configured Supabase origin — no wildcard `https:`, so a content-injection bug cannot exfiltrate to an attacker host. Opt extra origins in with `CSP_CONNECT_EXTRA`.
* **Secrets stay server-side**; `.env` is gitignored and CI fails on a tracked `.env` or on `AIza…`/`sk-or-…`/private-key patterns in tracked files.

---

### Feed resilience & rate limits (operator notes)

**Upstream backoff.** The Yahoo fallback loop no longer runs on a blind `setInterval(…, 5000)`: cycles are
serialised (no overlapping fetches while one is in flight) and consecutive failures back off
5 → 10 → 20 → 40 → 60 s, recovering automatically. A dead upstream used to print one stack trace per symbol
per tick (~28k log lines in a 30-minute outage); now the first failure is logged in full and later ones are
sampled. `GET /api/health` returns `status: "degraded"` with `feed: { source, priced, yahooFailureStreak }`,
so "process healthy, zero prices" is detectable instead of silent.

**Per-endpoint budgets** (`server/lib/rateLimit.ts`) replace the single global 30/min bucket that one
legitimate tab could trip by itself:

| Scope | Budget/min | Why |
| --- | --- | --- |
| `health` | 120 | monitors must not be throttled |
| `prices` (watchlist poll) | 60 | ~24/min per tab is legitimate traffic |
| `history` (chart load) | 20 | expensive upstream |
| `quote`, `forexrate` | 10 | these spend Twelve Data credits |
| `news` | 15 | Finnhub |
| `ws-token` | 20 | reconnect storms |
| default | 30 | everything else |

Every response carries `X-RateLimit-Limit` / `X-RateLimit-Policy`; every 429 carries `Retry-After` and
`{ code: "RATE_LIMITED", scope, retryAfterSeconds }`. The client honours it — `useWatchlistFeed` backs off
by the advertised window, pauses polling while the tab is hidden, refreshes immediately on return, and drives
the header badge from `feedStatus` (`connecting | live | polling | degraded`) so degradation is visible rather
than looking like a quiet market.

## 📂 Project Architecture

```text
├── server.ts                  # Full-stack backend (Twelve Data/Yahoo proxies, WS feed, Gemini/OpenRouter chat, rate limiting)
├── package.json               # Scripts and dependencies
├── supabase-schema.sql        # Optional Supabase schema for position/trade sync
├── src/
│   ├── App.tsx                # Main terminal layout and global HUD
│   ├── main.tsx               # React entrypoint
│   ├── types.ts               # Core domain types (candles, positions, signals...)
│   ├── context/
│   │   └── TradingContext.tsx # Central state: WS/polling feed, chart data, paper trading, indicators
│   ├── components/
│   │   ├── TradingChart.tsx       # Chart orchestration (markers, sessions, drawings, animations)
│   │   ├── Watchlist.tsx          # Live instrument cards with tick flashes
│   │   ├── SignalPanel.tsx        # Buy/sell consensus signal
│   │   ├── PositionsPanel.tsx     # Paper trades + SL/TP execution
│   │   ├── PatternPanel.tsx       # Price-action pattern recognition
│   │   ├── AiAssistant.tsx        # AI confluence center (Gemini/OpenRouter)
│   │   ├── PerformanceDashboard.tsx
│   │   ├── NewsPanel.tsx
│   │   ├── SupabaseSync.tsx
│   │   └── chart/                 # ChartHeader, ChartSidebar, ChartOverlays, SubChartPanels,
│   │                              # DrawingsManager, DrawingToolbar
│   ├── hooks/
│   │   └── useChartCore.ts        # lightweight-charts lifecycle & interactions
│   ├── utils/
│   │   ├── forexData.ts           # Indicators, pattern & signal algorithms
│   │   ├── forexSessions.ts       # Market session definitions
│   │   └── chart/                 # indicatorOverlays, drawingTools
│   └── lib/
│       └── supabase.ts            # Optional Supabase client (no placeholder URL)
└── api/index.ts               # Vercel serverless entry
```

---

## ⚠️ Licensing & Disclaimer
ApexFX Terminal is designed for simulation, paper-trading, and educational research purposes. **The market data is real, but the trades are not** — no order is routed to any broker. Trading leveraged foreign exchange and commodities involves high risk; all financial analytics and AI confluences generated inside this workstation should be verified independently.
