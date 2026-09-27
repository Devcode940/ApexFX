# Changelog

All notable changes to ApexFX are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project is versioned by
git tags and does not publish npm packages.

## [Unreleased]

### Added
- Pattern scanner extended from 7 bespoke detections to 22 by adopting the MIT
  [`candlestick`](https://github.com/cm45t3r/candlestick) library (zero-dependency, ~99.7 % coverage)
  for textbook formations: Three White Soldiers/Black Crows, Piercing Line, Dark Cloud Cover,
  Harami ×2, Kicker ×2, Tweezers ×2, Inverted Hammer, Hanging Man, Marubozu ×2, Spinning Top.
  Library matches are strictly lower priority than the bespoke chain and flow through the same
  honest confluence band — still heuristics, never probabilities.
- MIT `LICENSE` (Devcode940). Previously the repo shipped no explicit license.
- Instrument catalog expanded from 8 to 16 FX instruments (adds USDCHF, EURJPY, EURGBP,
  AUDJPY, CADJPY, NZDUSD, CHFJPY, NZDJPY). Tiingo batching, Twelve Data and Yahoo maps
  derive from the catalog, so quote polling remains one batched request.
- User-editable watchlist: per-row remove plus an add picker over the covered catalog,
  persisted in localStorage and validated against the shared symbol contract.
- Strategy lab: deterministic SMA-crossover backtester (`GET /api/backtest`) over the same
  real cached candles the chart uses, with half-spread-per-side and per-lot commission cost
  model, quote-currency P&L labeling, and an educational disclaimer. Not a forecast.
- Opt-in spread-aware paper fills (fill at the traded side when the quote is two-sided) and
  per-lot per-leg commission, configurable under Execution costs in the ticket panel and
  persisted locally. Midpoint fills remain the default.
- Optional upstream Tiingo FX WebSocket (`TIINGO_WS_ENABLED`, default off): tolerant frame
  parsing (only well-formed top-of-book quotes are applied), coalesced broadcasts, bounded
  reconnect, and a health gate that resumes REST polling whenever the stream goes quiet.
- Economic-calendar cron prewarm: `GET /api/cron/calendar` (optional `CRON_SECRET` bearer)
  plus an hourly `vercel.json` schedule; the panel now shows a live countdown to the next
  HIGH-impact release in the selected currency scope.
- First-party browser error beacons: `POST /api/client-errors` (validated, 6/min per IP,
  redacted log line, never persisted) with a PROD-only, 1/min/throttled client installer.
- `npm run doctor`: offline operator checklist (env, keys, Vercel cron/CSP consistency,
  Redis/Supabase provisioning state) with honest reminders for what needs live cloud access.
- Playwright chromium suite (`npm run test:e2e`) over the production build in
  `MARKET_DATA_MODE=offline`, incl. a regression that demo-mode strings stay absent from the
  shipped bundle; CI workflow `E2E (real browser)`.
- `.github/PULL_REQUEST_TEMPLATE.md` and `CHANGELOG.md`.

### Changed
- `vercel.json`: removed the duplicate static CSP (Express `securityHeadersMiddleware` is the
  single source); added `crons`.
- CSP `connect-src` no longer allows blanket `ws:`/`wss:` — same-host WebSocket origin derived
  from the forwarded protocol, plus explicit `APP_URL` hosts and `CSP_CONNECT_EXTRA`.
- `/api/ready` required-symbol default is now the explicit CORE instrument set, so optional
  catalog entries cannot flip an otherwise-healthy core feed to 503.
- Vite build: `react`/`react-dom` and `lightweight-charts` split into long-lived vendor chunks;
  app logo recompressed 338 kB → 15 kB (entry chunk and first paint improve accordingly).

### Removed
- `src/components/NewsPanel.tsx` — a compat re-export with zero importers.
