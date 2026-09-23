#!/usr/bin/env bash
# Compatibility name: these are local HTTP/WS fixtures and an OFFLINE production smoke, not
# a claim that live providers, broker feeds, paid models, or a deployed cloud project were tested.
set -euo pipefail
cd "$(dirname "$0")/.."
npm test -- server/api-regressions.test.ts server/lib/security.test.ts server/lib/vercel.test.ts
npm run build
exec npm run test:smoke
