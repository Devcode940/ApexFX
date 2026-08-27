# Deployment Guide

## Production Deployment Options

### Option 1: Vercel (Recommended for Serverless, with polling fallback)

**Prerequisites:**
- Vercel account
- Environment variables configured in Vercel dashboard

**Steps:**
1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel login`
3. Deploy: `vercel --prod`

**Environment Variables Required:**
```
GEMINI_API_KEY=your_gemini_key
TWELVEDATA_API_KEY=your_twelvedata_key
FINNHUB_API_KEY=your_finnhub_key
FOREXRATE_API_KEY=your_forexrate_key
OPENROUTER_API_KEY=your_openrouter_key (optional)
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com
WS_SHARED_SECRET=random_secret_for_ws_token (recommended)
UPSTASH_REDIS_REST_URL=https://... (optional, for distributed rate limiting)
UPSTASH_REDIS_REST_TOKEN=...
```

**Note:** WebSocket is limited on Vercel serverless — client automatically falls back to HTTP polling (`/api/market/prices`). For full WS ticks, use traditional server.

---

### Option 2: Traditional Server (Node.js + PM2) — Recommended for full WS

**Prerequisites:**
- Node.js 20+ installed
- PM2 process manager

**Steps:**
1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Set environment variables (see `.env.example`)
4. Start with PM2: `pm2 start dist/server.cjs --name apexfx -- -p 3000`
5. Enable startup: `pm2 startup && pm2 save`

**Environment Variables (.env):**
```
PORT=3000
NODE_ENV=production
GEMINI_API_KEY=your_gemini_key
TWELVEDATA_API_KEY=your_twelvedata_key
FINNHUB_API_KEY=your_finnhub_key
FOREXRATE_API_KEY=your_forexrate_key
OPENROUTER_API_KEY=your_openrouter_key (optional)
ALLOWED_ORIGINS=https://yourdomain.com
WS_SHARED_SECRET=your_random_secret
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
TWELVEDATA_QUOTE_SYNC_MS=900000
TWELVEDATA_POLL_MS=15000
SHOW_WARNINGS=false
```

**Health Check:**
```
curl https://yourdomain.com/api/health
```

---

### Option 3: Docker (Multi-stage, hardened)

**Dockerfile:** now uses multi-stage build (builder + production), non-root user, healthcheck.

**Deploy:**
```bash
docker build -t apexfx .
docker run -p 3000:3000 --env-file .env apexfx
```

**Docker Compose example:**
```yaml
services:
  apexfx:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

---

## Security Checklist

✅ **Before deploying to production:**

1. **Environment Variables**
   - [ ] All API keys set via environment variables
   - [ ] No hardcoded secrets in code
   - [ ] `.env` file excluded from version control
   - [ ] `WS_SHARED_SECRET` set to random 32+ chars

2. **CORS Configuration**
   - [ ] Set `ALLOWED_ORIGINS` to your production domain(s)
   - [ ] Remove wildcard origins in production

3. **Rate Limiting**
   - [ ] Verified rate limiting is active on all `/api/*` routes
   - [ ] For serverless, set Upstash Redis env for distributed limiting
   - [ ] Adjust limits based on expected traffic

4. **Logging**
   - [ ] Verbose logs disabled in production (`NODE_ENV=production`)
   - [ ] Error messages sanitized (no stack traces to clients)

5. **WebSocket Security**
   - [ ] Origin validation enabled (production)
   - [ ] Token-based authentication active with expiry + single-use
   - [ ] `WS_SHARED_SECRET` required for token issuance

6. **Input Validation**
   - [ ] All user inputs validated (symbols, timeframes, categories) with length limits
   - [ ] SQL injection prevention (Supabase RLS enabled)

7. **HTTPS & Headers**
   - [ ] SSL/TLS certificate configured
   - [ ] Force HTTPS redirects
   - [ ] HSTS, CSP, X-Frame-Options, X-Content-Type-Options active (now in security middleware)

8. **Data Integrity**
   - [ ] Note that win rates / profit factors are heuristic estimates, not backtested guarantees — disclaimer shown in UI

---

## Monitoring & Maintenance

**Health Checks:**
- Monitor `/api/health` endpoint for uptime, WS client count, watchlist size
- Monitor `/api/forex` endpoint for external API availability
- Watch WebSocket connection counts
- Track rate limit hits (429 responses)

**Logs to Monitor:**
- Twelve Data API errors (rate limits, credential issues)
- AI provider timeouts
- WebSocket disconnections
- Fetch timeouts (now 6-8s with AbortController)

**Regular Tasks:**
- Rotate API keys quarterly
- Review rate limit metrics monthly
- Update dependencies weekly (`npm update`)

---

## Troubleshooting

**Issue: WebSocket not connecting**
- Check `ALLOWED_ORIGINS` includes your frontend domain
- Verify firewall allows WebSocket traffic (port 3000)
- Check server logs for origin rejection messages
- In prod, ensure client fetches `/api/ws/token` with `x-ws-secret` if `WS_SHARED_SECRET` is set, otherwise it will fallback to polling

**Issue: API returning 500 errors**
- Verify all required API keys are set
- Check external API status (Twelve Data, Finnhub, etc.)
- Review server logs for specific error messages

**Issue: Rate limiting too aggressive**
- Adjust env or code in `server/lib/rateLimit.ts`
- For Vercel, set Upstash Redis to get distributed limiting
- Consider IP-based vs user-based limiting

**Issue: AI responses slow or timing out**
- Increase `CHAT_TIMEOUT_MS` value (default 45s)
- Check AI provider status
- Consider switching to OpenRouter for better latency

**Issue: Docker build fails**
- Ensure using multi-stage Dockerfile (now fixed) — first stage does `npm ci` with dev deps, second stage prunes to prod
