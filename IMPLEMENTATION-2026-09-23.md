# ApexFX fixes, evidence, and critique of alternatives

> This records the earlier 241-test fixes checkpoint. The subsequent preferred-provider/weekly-data change and its newer verification are documented in [Tiingo & Forex Factory integration](TIINGO-FOREXFACTORY.md).

**Scope:** implementation of the [baseline review](REVIEW-2026-09-22.md), not just another review. Work is on `arena/01a0cb76-apexfx`. This is still a paper simulator, not a broker execution system or a calibrated prediction product.

The most consequential changes are currency/provenance correctness, lossless processing of accepted quotes, account-bound synchronization, and paid-resource controls. I kept the modular monolith rather than introducing a new state framework, event infrastructure, or an unrelated UI rewrite.

## What changed

| Finding | Implemented response | Regression evidence |
|---|---|---|
| **R1 — mixed-currency P&L** | v2 USD valuation retains quote P&L/currency and conversion source/time. USDJPY 150→151, one lot = 100,000 JPY = **$662.25**; with EURUSD +$1,000 the known USD total is **$1,662.25**, not $101,000. Closed FX is frozen. Legacy cross FX and unmarked restored opens stay unknown. UI/statistics/risk sizing/CSV handle that explicitly. | `ledger.test.ts`, `usePaperTrading.test.tsx`, `financial-ui.test.tsx`, `pips.test.ts` |
| **R2 — lost stop touches** | A provider-owned `QuoteStore` synchronously delivers every accepted ordered message to an atomic book ref, outside React. No execution on a throttled rendered price. Stable close/position linkage prevents duplicate closure. Stops use adverse observed gap prices; targets use their target. | Real React/StrictMode open→touch→rebound→double-close tests in `usePaperTrading.test.tsx`; pure engine tests |
| **R3 — poisoned history loads** | Abort superseded requests; cache successful loads only; explicit error/retry; validate history. StrictMode replay and A→B→A work. Deadlines include response consumption. | `useChartHistory.test.tsx`, actual context test |
| **R4 — chart lifecycle/rollover** | UTC timestamp buckets, sparse provisional bars, authoritative refresh, retained main/indicator charts, one marker plugin with `setMarkers`/`detach`, corrections to earlier bars, no append-driven chart recreation. Preserve non-UTC provider bars instead of mixing incompatible quote buckets. | `quotes-and-candles.test.ts`, real indicator adapters against an SDK boundary fixture in `useChartCore.test.tsx` |
| **R5 — false freshness/source** | Provider observation and receipt times stay distinct. History/reference/unknown/stale prices cannot execute. Per-row source/kind/quality, actual aggregate source, Yahoo HTTP/payload failure accounting. No candle timestamp borrowed to legitimize a missing quote timestamp. | Ordered quote tests, context/ticket tests, real Express API fixtures |
| **R6 — lossy/resurrecting sync** | Versioned per-user JSON book, CAS revision loop, latest-local-state re-read after awaits, closure/deletion tombstones, deterministic conflict behavior, bounded retries, visible failures. Empty-history pushes retain tombstones. | `cloudLedger.test.ts`, `paperBooks.sql.test.ts`, paper hook integration |
| **R7 — account contamination** | One auth owner/readiness source; guest/account local namespaces; generation-bound callbacks and aborts; explicit legacy import. The RPC also checks `expected_user_id` against `auth.uid()` so SDK token changes cannot send A's captured book as B. Old row writers have a separate retirement migration. | Account/session/hook tests, late-A-response tests, real SQL A/B/RLS and mismatched-identity cases |
| **R8 — drawing overwrite** | Load and save carry the same account/symbol key; old setters cannot write a new scope. Validate collections, preserve corrupt storage, explicit legacy import. | `useScopedDrawings.test.tsx` under StrictMode |
| **R9 — WS auth/retry** | Browser-compatible POST nonce flow with optional verified Supabase Bearer; service secret is server/header-only. Pre-upgrade nonce/IP/origin checks; one use, expiry, connection/payload/backpressure/heartbeat bounds. Capability discovery, no tokenless connect, auth-failure retry stop, fresh-data watchdog, independent polling and full Retry-After minima. | Real local HTTP/WS upgrade tests and `useWatchlistFeed.test.tsx` |
| **R10 — paid work/cold misses** | Verified AI account or explicit small guest allowance; bounded input/images/output; shared account/global daily reservations and concurrency leases; fail-closed paid-store failures. Unknown AI completion holds its lease until expiry; no daily refunds. Paid market reservations and bounded per-key single-flight/cache. Gemini retries explicitly limited to one. | `paidBudget.test.ts`, `cache.test.ts`, real API fixtures including auth, budget failure, guest cap, output caps, abort propagation and five concurrent misses |
| **R11 — ineffective deadlines** | Proxy helper buffers a bounded complete body under one composed deadline/caller signal. Chat propagates cancellation and clears its timer; resetting/switching AI sessions discards stale completions. Cancellation is not a guarantee against upstream billing. | Real delayed/chunked HTTP bodies in `fetch.test.ts`; API and React AI reset tests |
| **R12 — deployment/provider mismatch** | Same primary/fallback selection on Node and request-driven Vercel. Truthful metadata. `SI=F` is labeled, **display-only**, never a spot execution substitute. Current Vercel capabilities explicitly choose polling; Beta WS is not assumed wired. | `api-regressions.test.ts`, Vercel adapter tests, source/kind eligibility tests |
| **R13 — unsupported probability claims** | Causal preceding-volume comparison, confluence/tier labels instead of pattern win probabilities, honest no-data price, ATR boundary fix. Real paper statistics are separate from heuristic rankings; no-loss PF is explicit rather than `99.9`. | Prefix/append invariance and ATR tests; financial UI statistics test |
| **R14 — runtime/deployment evidence** | Node 24 across engine, CI and Docker; explicit startup; provider-independent liveness versus readiness; deterministic offline production smoke; backend artifacts outside the static root. Updated configuration and staged migration documentation. | Typecheck/lint/build; HTTP/WS fixtures; `scripts/production-smoke.mjs` |

Also included: CSV quoting and formula neutralization, truthful unknown durations, validated backup restore with retained corrupt originals, timeframe-event validation, LRU overwrite fix, restored tick flashes, warnings enabled by default, and bounded chat context that does not repeatedly upload old images.

## Verification, not promises

Local verification uses Node **24.21.0**. The final command/result summary below follows a fresh locked dependency install. The baseline had 113 tests; additional tests exercise integrated failure modes, not just isolated arithmetic.

- TypeScript and zero-warning ESLint.
- Vitest **4.1.11**, including React/jsdom lifecycles, local HTTP/WebSocket integration, currency/ledger invariants and SQL.
- PGlite executes actual PostgreSQL DDL, roles, RLS, RPC revision/identity checks, tombstone constraints, limits and legacy write retirement. It caught a real JSONB operator-precedence defect during implementation, which was corrected before the passing run. Its Auth function is a fixture; it does not prove a deployed Supabase project's policies/JWT/PostgREST configuration.
- Production smoke builds/boots the real Node bundle, verifies SPA/gzip, JSON API/parser failures, liveness/readiness, explicit capabilities, unavailable offline quotes, and denial of former backend/source/credential paths, then terminates the process.
- Targeted dependency updates: Express **4.22.3** / `qs` **6.16.0** and a peer-compatible patched Vitest 4 release, **not** a blind `audit fix --force`/latest-major jump. Unused Express validator removed; build-only Vite tooling moved out of runtime dependencies; Node typings aligned to 24. The latest audit run reports **0 vulnerabilities**. This is a point-in-time advisory result, not a security certification.

**Not performed:** real-browser graphics/accessibility/performance validation; actual paid-model/market entitlement checks; real Supabase or Redis deployment tests; Docker execution; deployed Vercel routing/WS verification. No SQL was run against a real project, and nothing was deployed, committed, or pushed. The earlier Chromium download failed; jsdom and chart SDK fixtures are not substituted claims of a browser run.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the required live checks and safe cutover sequence.

## Critique of the alternatives

### 1. USD ledger versus “approximately dollars” or a multicurrency account

**Chosen:** explicit USD valuations with retained quote amounts and frozen conversion provenance. Unknown conversion is `null`, not zero and not the quote amount with a dollar sign. Open marks are not persisted as if still current.

**Rejected:** a hard-coded JPY pip value; today's FX applied to an old realized cross; treating reference/history prices as executable; summing quote currencies into a single P&L number. All hide a correctness error behind a plausible display.

**Valid alternative:** maintain separate currency cash accounts and a reporting-currency valuation layer. Better for actual multicurrency settlement, commissions/swaps, tax lots and account balances, but materially broader than this USD paper journal. Decimal/fixed-point accounting and an authoritative broker ledger would be appropriate before real-money use. Correcting old currency arithmetic cannot reconstruct bad historical fills or establish missing ownership/source identity.

### 2. Direct ordered execution versus faster UI ticks or a server order engine

**Chosen:** execute accepted events synchronously before React; preserve stable close identities. Removing the lossy execution throttle is safer than shortening it. UI render batching is free to skip visual intermediates; the book is not.

**Rejected:** “make the throttle 100ms,” stop fills always at the trigger, disabling StrictMode, and assertions about ticks the HTTP provider never supplied. Faster repainting does not prove a touched stop was processed, and a client cannot execute while it is not running.

**Valid alternative:** a server-owned ordered tick/event log with idempotent order transitions, explicit bid/ask and execution policies, durable workers and broker integration. Necessary for offline execution or stronger guarantees; unnecessary to pretend this browser simulator already provides them. Presentation-only throttling/selector state can be added after profiling without moving execution back into rendered state.

### 3. CAS JSON books versus additive row upserts, full events, or last-write-wins

**Chosen:** bounded immutable-creation union plus closed-wins/tombstones, an atomic per-account CAS save, identity-generation guards and a server-checked expected owner. Local work continues during network awaits and is re-read/merged. The RPC owns the write; no ambiguous fallback to legacy global IDs.

**Rejected:** replacing local arrays from a captured request, additive closed rows without position linkage, silently deleting old data during migration, and last-write-wins snapshots that discard another device's open/close. A user-scoped database primary key alone cannot prevent a client from mislabeling A's data as B's: the expected-account RPC check matters.

**Valid alternative:** a durable event ledger/outbox with server sequencing, operation IDs, conflict records and transactional local IndexedDB. Better for many devices/tabs, auditability, compaction and high volume. The chosen JSON journal has explicit limits and whole-document bandwidth costs. Earliest recorded simultaneous close is deterministic convergence, **not** broker/exchange authority; client clocks can differ. LocalStorage remains single-active-tab best effort, not transactional cross-tab replication or encryption.

### 4. UTC observed bars versus fabricated continuous candles or provider/session aggregation

**Chosen:** sparse, explicitly provisional observed bars and authoritative reconciliation. Retain chart objects/indicator handles/marker plugin; update them independently. Preserve provider-session history if it is not on the UTC grid instead of merging overlapping buckets.

**Rejected:** overwriting the last candle regardless of its timestamp; synthesizing full bars through a weekend/gap; recreating the chart on every append; repeatedly attaching marker primitives. Those create false OHLC, lose zoom, or leak resources.

**Valid alternative:** authoritative tick aggregation with a licensed feed and instrument/session calendars, or streaming provider candles. That can support proper intrabar history and non-UTC/DST-aware sessions; this implementation does not reconstruct data it never saw. Real-browser chart interaction still needs testing.

### 5. Price provenance versus one global “LIVE” badge or futures disguised as spot

**Chosen:** per-instrument provenance/freshness and conservative execution gating. Cached prices remain visible but are not called fresh solely because an HTTP response or socket arrived. Silver futures are display-only. Raw market quote and history contracts are separate.

**Rejected:** source inferred from which key is configured, wall-clock send time substituted for market observation time, and renaming a continuous futures ticker to make it a spot contract.

**Valid alternative:** contract-aware instrument IDs, explicit spot/futures selection and separate subscriptions/books for each actual contract. Better if futures trading is a real product requirement; a display label alone does not solve contract rollover, tick size, settlement, licensing or position identity.

### 6. Shared paid reservations versus per-IP throttling, timeouts, or provider retries alone

**Chosen:** authenticate before paid work, strict payload/output limits, atomic shared reservations, bounded concurrency/leases and no speculative refunds. Market miss coalescing reduces duplicate work on one instance. An explicit selected model and one Gemini attempt avoid hidden retry multiplication.

**Rejected:** Origin as identity, “a timeout means no charge,” fail-open paid-budget errors, or memory-only production counters spread across replicas. A per-IP limiter is useful abuse friction, not a global spend limit.

**Valid alternative:** an authenticated queued job gateway with real billing/usage reconciliation, pre-paid balances, shared cache and provider-level hard spend limits. Better at scale or with strong billing requirements. Current work units are conservative app quotas, not a dollar ledger. Shared Redis behavior and real provider charging/cancellation semantics must be verified live.

### 7. Polling deployment versus blindly adopting Vercel WS Beta or microservices

**Chosen:** preserve the modular monolith, use the same provider policy, expose capability discovery, and keep this Vercel HTTP adapter polling-only. Persistent Node owns its stream lifecycle. Bind source and built artifacts to the correct serving boundaries.

**Rejected:** the obsolete claim that Vercel categorically cannot host WS; equally, removing guards and assuming Beta automatically supplies upgrade routing, durable shared state and infinite connection life. Microservices would not repair currency math, stale request ownership or lossy execution.

**Valid alternative:** a specifically verified native Beta WS integration or a managed pub/sub/stream gateway with shared nonce state, lifetimes, reconnect/replay and licensing budgets. Adopt based on measured fan-out, latency and operating cost, not fashion.

### 8. Heuristic transparency versus cosmetic “confidence” and optimization-first rewrites

**Chosen:** causal scoring, explicit heuristic labels, descriptive paper statistics and meaningful regression tests. Stronger tests were more valuable than an attractive percentage, extra cache, or a different state library.

**Rejected:** calling a ranking a win probability, deriving profitability from that ranking, hiding bundle warnings, or marking an unexercised deployment/SQL scaffold “production verified.”

**Valid next work:** walk-forward/out-of-sample evaluation with transaction costs and unbiased datasets if predictive claims are desired; real-browser profiling and accessibility work before performance rewrites. Splitting the clock/context, virtualizing large ledgers, and optimizing the oversized logo are sensible measured follow-ups. The indicator cache is deliberately not wired in without a content/provenance-safe invalidation design.

## Remaining boundaries / follow-up work

1. **Live rollout gates:** actual Supabase, Redis, Vercel, Docker and browser/provider checks listed in the deployment guide. Passing local fixtures do not make those complete.
2. **Data recovery/migration:** original local/cloud data is preserved; legacy cloud archives and ambiguous old instruments/close linkage still require deliberate reconciliation. There is no automatic historical-FX invention or broad repair of unknowable past fills.
3. **Storage/replication:** one active tab per book; no encryption, event outbox or automatic tombstone compaction. Five CAS retries preserve local work but cannot guarantee immediate convergence while another device writes continuously. Database backups remain necessary.
4. **Execution realism:** no offline/inactive-book execution, no unseen ticks, broker fill assurance, margin/cash accounting, spread, financing or fees. Reference/futures proxies are not a substitute.
5. **Performance/accessibility:** the approximately 540 kB entry chunk still exceeds Vite's 500 kB warning; the 338 kB brand image and broad context clock re-renders remain. No warning threshold was raised to conceal this. Keyboard/mobile/contrast and visual chart behavior need a browser pass.
6. **Strategy validity:** causal does not mean profitable, and paper win-rate/profit-factor samples are not calibrated forecasts. Unknown USD records are explicitly excluded from the reported subset, which must not be mistaken for a complete portfolio statistic.

## Final local gate result

Completed on 2026-09-23 after a clean `npm ci` with Node 24/npm 11:

| Gate | Actual result |
|---|---|
| Locked install | Passed; 446 packages installed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, zero ESLint warnings/errors |
| `npm test` | **241 tests passed in 28 files** (baseline: 113/12) |
| `npm run build` | Passed; Vite 6.4.3 / private Node bundle |
| `npm run test:smoke` | Passed, actual built server in offline fixture mode |
| `npm audit` | **0 reported vulnerabilities** |
| `git diff --check` / shell syntax | Passed |
| Credential-pattern scan | 0 candidate matches across tracked/new non-ignored text files |

The entry bundle is **537.72 kB / 153.60 kB gzip**; the brand image is still **338.32 kB**. Vite's >500 kB warning remains visible. Install emitted ESLint 9 end-of-support and transitive polyfill deprecation notices, plus npm's dependency-install-script review warnings; these are maintenance follow-ups, not hidden or described as a clean bill of health. No install scripts were blanket-approved and no unrelated ESLint/framework major rewrite was forced through.

Expected provider/budget-failure fixtures log warnings during tests; they are deliberately asserted failure paths. These results do not supersede the real-service/browser gates above.
