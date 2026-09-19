#!/usr/bin/env bash
# Live behaviour probe for the claims in FIXES_APPLIED.md.
#
# Boots the real server (NODE_ENV=production) on a throwaway port and asserts the things a unit test
# cannot: middleware ordering, header shape, which rate-limit bucket a request lands in, and the
# trust-proxy semantics in both modes. Exits non-zero on the first unmet expectation.
#
#   ./scripts/probe-live.sh            # picks a free-ish port itself
#   PORT=4100 ./scripts/probe-live.sh  # explicit port
#
# Editing notes (these cost real debugging time, so they are written down):
#  - curl needs -g or bracket queries are treated as glob patterns.
#  - The server is started with setsid so it can be killed as a process group. `kill $PID` on the
#    `npx tsx` line kills only the wrapper and leaves node holding the port; every later assertion
#    then silently describes the PREVIOUS build. The EADDRINUSE guard is the other half of that fix.
#  - Flooding one endpoint exhausts its bucket and makes *later* steps in the same run return 429,
#    so each phase boots a fresh server.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-$((3600 + RANDOM % 400))}"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
GROUP=""

fail=0
count_code() { tr -d '\n' | grep -o "$1" | wc -l | tr -d ' '; }  # codes print on one line; `grep -c` would report 1
check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  ok   %-58s %s\n' "$1" "$3"
  else
    printf '  FAIL %-58s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}
boot() {
  env "$@" PORT="$PORT" setsid npx tsx server.ts >"$LOG" 2>&1 &
  GROUP=$!
  sleep 8
  if grep -q EADDRINUSE "$LOG"; then
    echo "ABORT: port $PORT already busy - results would describe a different build." >&2
    stop
    exit 2
  fi
}
stop() { [ -n "$GROUP" ] && kill -9 -- -"$GROUP" 2>/dev/null; sleep 1; GROUP=""; }

P="http://127.0.0.1:$PORT"
code() { curl -s -g -o /dev/null -w '%{http_code}' "$@"; }

# ------------------------------------------------------------------ phase A: defaults (auto trust)
boot NODE_ENV=production WS_SHARED_SECRET=probe-secret

echo "== phase A: production defaults (TRUST_PROXY unset = auto) =="
check "/api/health answers" "200" "$(code "$P/api/health")"

echo
echo "-- proxy header trust --"
# Auto mode: the header is believed because the *peer* (127.0.0.1) is inside TRUSTED_PROXY_RANGES.
# 35 distinct client IPs => 35 distinct buckets => a 30/min default policy cannot limit them.
auto=$(for i in $(seq 1 35); do code -H "X-Forwarded-For: 9.9.9.$i" "$P/api/forex"; done | count_code 200)
check "X-Forwarded-For honoured from a trusted peer" "35" "$auto"

echo
echo "-- per-endpoint budgets --"
prices=$(for i in $(seq 1 55); do code "$P/api/market/prices"; done | count_code 200)
check "/api/market/prices has its own 60/min policy" "55" "$prices"
policy=$(curl -s -g -D - -o /dev/null "$P/api/market/prices" | tr -d '\r' | grep -i '^X-RateLimit-Policy:' | awk '{print $2}')
check "policy label is advertised (not 'default')" "prices;window=60s" "$policy"
limit=$(curl -s -g -D - -o /dev/null "$P/api/market/prices" | tr -d '\r' | grep -i '^X-RateLimit-Limit:' | awk '{print $2}')
check "budget is advertised" "60" "$limit"

echo
echo "-- 429 is machine-readable and carries a backoff --"
for i in $(seq 1 12); do code "$P/api/market/quote?symbol=EUR/USD" >/dev/null; done
shape=$(curl -s -g -i "$P/api/market/quote?symbol=EUR/USD" | tr -d '\r')
check "Retry-After present" "yes" "$(echo "$shape" | grep -qi '^Retry-After:' && echo yes || echo no)"
check "RATE_LIMITED code present" "yes" "$(echo "$shape" | grep -q 'RATE_LIMITED' && echo yes || echo no)"
check "quote budget is the tight one (credits)" "yes" "$(echo "$shape" | grep -q '"scope":"quote"' && echo yes || echo no)"

echo
echo "-- WS token is deny-by-default in production --"
check "no Origin, no secret -> 403" "403" "$(code "$P/api/ws/token")"
check "valid secret, no Origin -> 200" "200" "$(code "$P/api/ws/token?secret=probe-secret")"
check "wrong secret, valid Origin -> 403" "403" "$(code -H "Origin: $P" "$P/api/ws/token?secret=nope")"

echo
echo "-- headers & routing --"
hdr=$(curl -s -g -D - -o /dev/null "$P/api/health" | tr -d '\r')
check "X-Powered-By removed" "absent" "$(echo "$hdr" | grep -qi '^X-Powered-By:' && echo present || echo absent)"
check "CSP present" "yes" "$(echo "$hdr" | grep -qi '^Content-Security-Policy:' && echo yes || echo no)"
ct=$(curl -s -g -o /dev/null -w '%{content_type}' "$P/api/definitely-not-a-route")
check "unknown /api/* is JSON, never index.html" "application/json; charset=utf-8" "$ct"
check "bracket param rejected (qs advisories unreachable)" "400" "$(code "$P/api/market/history?symbol[a]=b&timeframe=1H")"

echo
echo "-- compression --"
# Proves the middleware actually shrinks the transfer (a Content-Encoding header alone would be a lie)
# and that the 1 KB threshold leaves tiny JSON alone. `dist/` must be built: the asset request is what a
# browser makes in production, so this checks the real bytes rather than a synthetic payload.
entry=$(cd dist 2>/dev/null && ls assets/index-*.js 2>/dev/null | head -1)
if [ -n "$entry" ]; then
  raw=$(curl -s -g -o /dev/null -w '%{size_download}' "$P/$entry")
  gz=$(curl -s -g -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: gzip' "$P/$entry")
  hdr_asset=$(curl -s -g -D - -o /dev/null -H 'Accept-Encoding: gzip' "$P/$entry" | tr -d '\r')
  check "entry asset served with Content-Encoding: gzip" "1" "$(echo "$hdr_asset" | grep -ci '^Content-Encoding: gzip')"
  check "Vary: Accept-Encoding advertised (shared caches)" "1" "$(echo "$hdr_asset" | grep -i '^Vary:' | grep -ci 'accept-encoding')"
  check "gzip transfer is a large fraction smaller" "$(awk -v r="$raw" -v g="$gz" 'BEGIN{print (r>0 && g*100 < r*40) ? "yes" : "no"}')" "yes"
  check "no Accept-Encoding -> plain 200 (not a corrupted body)" "0" "$(curl -s -g -D - -o /dev/null "$P/$entry" | tr -d '\r' | grep -ci '^Content-Encoding:')"
  check "sub-threshold /api/health left uncompressed" "0" "$(curl -s -g -D - -o /dev/null -H 'Accept-Encoding: gzip' "$P/api/health" | tr -d '\r' | grep -ci '^Content-Encoding:')"
  printf '       %s: raw %s B -> gzip %s B\n' "$entry" "$raw" "$gz"
else
  check "dist/ built (npm run build) before probing compression" "yes" "no"
fi

echo
echo "-- degraded feed is visible, not 'healthy' --"
feed=$(curl -s -g "$P/api/health")
check "status reflects zero priced instruments" "degraded" "$(echo "$feed" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p')"
check "feed source is reported" "yes" "$(echo "$feed" | grep -q '"source":"\(yahoo\|twelvedata\)"' && echo yes || echo no)"

echo
echo "-- log hygiene --"
if grep -qE "TWELVEDATA_API_KEY=[A-Za-z0-9]|apikey=[A-Za-z0-9]{8}" "$LOG"; then
  echo "  FAIL an upstream key appears in the log"; fail=1
else
  echo "  ok   no upstream key in server log"
fi
lines=$(wc -l < "$LOG")
check "no log flood while upstream is unreachable (<90 lines for ~40s)" "yes" "$([ "$lines" -lt 90 ] && echo yes || echo "no ($lines)")"
stop

# --------------------------------------------------------- phase B: header trust explicitly disabled
# LOG_LEVEL=info so the startup config line (which states the resolved mode) is emitted
boot NODE_ENV=production TRUST_PROXY=0 LOG_LEVEL=info

echo
echo "== phase B: TRUST_PROXY=0 (fail-safe escape hatch) =="
spoofed=$(for i in $(seq 1 35); do code -H "X-Forwarded-For: 9.9.9.$i" "$P/api/forex"; done | count_code 200)
check "forged XFF collapses into one socket bucket" "30" "$spoofed"
warned=$(grep -c "X-Forwarded-For but it was not honoured" "$LOG")
check "the rejection is reported once to the operator" "1" "$warned"
mode=$(grep -o "trustProxy=[^ ]* [^ ]* [^ ]*" "$LOG" | head -1)
check "startup log states the mode" "disabled" "$(echo "$mode" | grep -o disabled || echo none)"
stop

echo
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "  FAIL port $PORT still bound (orphaned process - probes above may be stale)"; fail=1
else
  echo "  ok   server stopped, port released"
fi

echo
[ "$fail" -eq 0 ] && echo "ALL LIVE PROBES PASSED" || echo "LIVE PROBES FAILED"
exit "$fail"
