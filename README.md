# ApexFX Terminal 📈⚡

ApexFX Terminal is a high-performance, next-generation **multi-confluence Forex and Commodity trading workstation**. Designed with desktop-first precision and responsive mobile adapters, this full-stack terminal provides professional traders with live quotes, real historical interactive charting, dynamic volatility risk indicators, and real-time AI-powered confluence analytics.

> **Data integrity:** the terminal serves **real market data only**. There is no synthetic price generator, no placeholder quotes, and no seeded demo trades. All prices, candles, news, and AI analysis come from live upstream sources (Twelve Data, Yahoo Finance, ECB/Frankfurter, Finnhub, Gemini); the only static values are instrument metadata (pip decimals, contract sizes, nominal spreads) and locally computed indicators, patterns, and paper-trade P&L.

---

## 🌟 Core Features

### 1. Real-Time Data Pipeline
* **Dual-Streaming Engine**: live WebSocket updates plus a reliable background HTTP polling fallback, so the price feed stays active even behind restrictive firewalls or through connection drops.
* **Primary source — Twelve Data** (when `TWELVEDATA_API_KEY` is set): the server opens a Twelve Data WebSocket stream (`wss://ws.twelvedata.com/v1/quotes/price`) subscribed to all 8 instruments for low-latency tick prices (WebSocket credits only, not API credits), plus a REST quote sync every 60s for day high/low/change. If the stream drops, it reconnects automatically and REST polling takes over until it is back.
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
* **Real Gemini engine** (`gemini-3.5-flash` via `@google/genai`): built-in chat container with recent conversation history (server caps at the last 30 messages), chart-image understanding, and automatic market context injection (active symbol, timeframe, latest signal, indicators).
* **Server-side hardening**: in-memory rate limiting, payload size caps, history truncation, and a 45s request timeout.
* **No canned fallbacks**: if the AI service is unavailable, the terminal surfaces the real error instead of fabricating an offline answer.

### 4. Auxiliary Panels
* **Pattern Scanner**: analyzes the real candlestick sequence to isolate classical price-action patterns with profitability scoring.
* **Live News Feed**: macroeconomic headlines from Finnhub (requires `FINNHUB_API_KEY`).
* **Position execution panel**: paper-trading engine that opens/closes demo positions **priced from the live market feed**, with stop-loss / take-profit triggering and P&L in real time.
* **Performance Dashboard**: win rate, profit factor, equity curve, holding-time and symbol breakdowns, with CSV export.
* **Supabase Sync (optional)**: authenticate and sync positions/trades to a Supabase project when credentials are configured.

---

## 🛠️ Technology Stack

* **Frontend**: React 19, Vite 6, Tailwind CSS v4, lightweight-charts v5, Lucide Icons, Recharts, Motion animations.
* **Backend**: Express.js on Node.js with a native WebSocket server (`ws`).
* **APIs & Data**: Twelve Data (WebSocket ticks + REST quotes + history), Yahoo Finance REST API (fallback quotes + history), Frankfurter (ECB rates), Finnhub (news), ForexRate API, Google Gemini API.
* **Quality**: TypeScript with strict type checking (`npm run lint`), Vitest unit tests (`npm run test`).

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
TWELVEDATA_API_KEY=your_twelvedata_key_here  # recommended — primary live feed
FINNHUB_API_KEY=your_finnhub_api_key_here    # optional — live news
FOREXRATE_API_KEY=your_forexrate_key_here    # optional — rate cross-check
```

`GEMINI_API_KEY` is required for the AI assistant. **Adding `TWELVEDATA_API_KEY` makes Twelve Data the primary live market source** (WebSocket ticks + history). Without it, the market feed falls back to Yahoo Finance — quotes and history work with **no keys at all**.

> **Twelve Data credits:** the REST `/quote` endpoint costs 1 API credit per symbol (8 for the full watchlist). On the free tier (8 credits/min, 800/day) keep the OHLC/change sync at ≥ 60s — the default. The WebSocket stream uses separate WebSocket credits (1 per symbol, not API credits) and is the recommended low-latency feed. Tune with `TWELVEDATA_QUOTE_SYNC_MS` / `TWELVEDATA_POLL_MS`. When Twelve Data returns `429` (per-minute limit reached), REST sync pauses until the next minute instead of hammering the API; the WebSocket stream keeps delivering ticks. Symbols outside the plan (e.g. `XAG/USD` → `403`) automatically fall back per-symbol to Yahoo.

### Installation

```bash
npm install
```

### Running the Terminal

```bash
npm run dev
```
The full-stack development workspace (Express backend + Vite frontend) is live at `http://localhost:3000`.

### Production Build

```bash
npm run build
npm start
```

### Tests & Type Checking

```bash
npm run test   # Vitest unit tests
npm run lint   # TypeScript type check (tsc --noEmit)
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
| `/api/chat` | POST | Gemini AI analysis — body: `{ messages, selectedSymbol, selectedTimeframe, activeSignal }` | `GEMINI_API_KEY` |

**WebSocket**: connect to `ws://localhost:3000` — receives `INITIAL_RATES` on open, then `PRICE_UPDATE` messages every ~5 seconds.

---

## 📂 Project Architecture

```text
├── server.ts                  # Full-stack backend (Yahoo/Frankfurter proxies, WS feed, Gemini chat, rate limiting)
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
│   │   ├── AiAssistant.tsx        # Gemini confluence center
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
