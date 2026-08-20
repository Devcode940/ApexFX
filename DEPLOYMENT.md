# Deployment Guide

## Production Deployment Options

### Option 1: Vercel (Recommended for Serverless)

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
```

**Note:** WebSocket support is limited on Vercel. For full WebSocket functionality, use a traditional server deployment.

---

### Option 2: Traditional Server (Node.js + PM2)

**Prerequisites:**
- Node.js 18+ installed
- PM2 process manager

**Steps:**
1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Set environment variables (see `.env.example`)
4. Start with PM2: `pm2 start dist/server.cjs --name apexfx`
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
TWELVEDATA_QUOTE_SYNC_MS=900000
TWELVEDATA_POLL_MS=15000
SHOW_WARNINGS=false
```

---

### Option 3: Docker

**Dockerfile:**
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/server.cjs"]
```

**Deploy:**
```bash
docker build -t apexfx .
docker run -p 3000:3000 --env-file .env apexfx
```

---

## Security Checklist

✅ **Before deploying to production:**

1. **Environment Variables**
   - [ ] All API keys set via environment variables
   - [ ] No hardcoded secrets in code
   - [ ] `.env` file excluded from version control

2. **CORS Configuration**
   - [ ] Set `ALLOWED_ORIGINS` to your production domain(s)
   - [ ] Remove wildcard origins in production

3. **Rate Limiting**
   - [ ] Verified rate limiting is active on all `/api/*` routes
   - [ ] Adjust limits based on expected traffic

4. **Logging**
   - [ ] Verbose logs disabled in production (`NODE_ENV=production`)
   - [ ] Error messages sanitized (no stack traces to clients)

5. **WebSocket Security**
   - [ ] Origin validation enabled
   - [ ] Token-based authentication active

6. **Input Validation**
   - [ ] All user inputs validated (symbols, timeframes, categories)
   - [ ] SQL injection prevention (Supabase RLS enabled)

7. **HTTPS**
   - [ ] SSL/TLS certificate configured
   - [ ] Force HTTPS redirects

---

## Monitoring & Maintenance

**Health Checks:**
- Monitor `/api/forex` endpoint for external API availability
- Watch WebSocket connection counts
- Track rate limit hits (429 responses)

**Logs to Monitor:**
- Twelve Data API errors (rate limits, credential issues)
- AI provider timeouts
- WebSocket disconnections

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

**Issue: API returning 500 errors**
- Verify all required API keys are set
- Check external API status (Twelve Data, Finnhub, etc.)
- Review server logs for specific error messages

**Issue: Rate limiting too aggressive**
- Adjust `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_MS` in `server.ts`
- Consider IP-based vs user-based limiting

**Issue: AI responses slow or timing out**
- Increase `CHAT_TIMEOUT_MS` value
- Check AI provider status
- Consider switching to OpenRouter for better latency
