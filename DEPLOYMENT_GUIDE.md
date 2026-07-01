# 🚀 ApexFX Terminal - Complete Deployment Guide

## Your Custom Configuration for Supabase Project: `zrqscleekkenxfnrxvzg`

---

## 📋 Quick Start Checklist

- [ ] Supabase project created: `https://zrqscleekkenxfnrxvzg.supabase.co`
- [ ] Database schema set up (SQL provided below)
- [ ] RLS policies configured
- [ ] Environment variables configured
- [ ] `vercel.json` updated
- [ ] Code pushed to GitHub
- [ ] Deployed to Vercel

---

## 🔐 Part 1: Supabase Configuration

### Step 1: Database Schema

Go to: [https://app.supabase.com/project/zrqscleekkenxfnrxvzg/sql](https://app.supabase.com/project/zrqscleekkenxfnrxvzg/sql)

Run this SQL:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Positions table for open trades
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  entry_price NUMERIC NOT NULL,
  current_price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  sl NUMERIC,
  tp NUMERIC,
  pnl NUMERIC NOT NULL,
  time TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Closed trades history
CREATE TABLE IF NOT EXISTS closed_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  pnl NUMERIC NOT NULL,
  time TEXT NOT NULL,
  close_reason TEXT NOT NULL CHECK (close_reason IN ('Manual', 'SL Hit', 'TP Hit')),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE closed_trades ENABLE ROW LEVEL SECURITY;

-- User access policies
CREATE POLICY "Users can manage their positions"
ON positions FOR ALL
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their closed trades"
ON closed_trades FOR ALL
USING (auth.uid() = user_id);
```

### Step 2: Get Your Keys

Go to: [https://app.supabase.com/project/zrqscleekkenxfnrxvzg/settings/api](https://app.supabase.com/project/zrqscleekkenxfnrxvzg/settings/api)

Copy these values (keep them SECRET!):

```
SUPABASE_URL=https://zrqscleekkenxfnrxvzg.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # Your anon key
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # Your service key
```

### Step 3: Set Up Site URL

Go to: [https://app.supabase.com/project/zrqscleekkenxfnrxvzg/auth/settings](https://app.supabase.com/project/zrqscleekkenxfnrxvzg/auth/settings)

Add these to **Site URL**:
```
http://localhost:5173
http://localhost:3000
https://your-vercel-app.vercel.app
```

---

## ☁️ Part 2: Vercel Configuration

### Step 1: Update vercel.json ✅ DONE

Your `vercel.json` has been updated to use `server.ts` instead of `api/index.ts`.

### Step 2: Environment Variables in Vercel

In your Vercel project dashboard → Settings → Environment Variables:

| Name | Value | Sensitive |
|------|-------|-----------|
| `TWELVEDATA_API_KEY` | Your Twelve Data key | ✅ Yes |
| `GEMINI_API_KEY` | Your Gemini key | ✅ Yes |
| `FINNHUB_API_KEY` | Your Finnhub key | ✅ Yes |
| `SUPABASE_URL` | `https://zrqscleekkenxfnrxvzg.supabase.co` | ✅ Yes |
| `SUPABASE_KEY` | Your anon key | ✅ Yes |
| `SUPABASE_SERVICE_KEY` | Your service key | ✅ Yes |
| `NODE_ENV` | `production` | ❌ No |
| `CORS_ORIGIN` | `https://your-app.vercel.app` | ❌ No |

### Step 3: Local .env File

Create `.env` in project root (DO NOT COMMIT THIS FILE):

```bash
cat > .env << 'EOF'
NODE_ENV=development
PORT=3000

# API Keys
TWELVEDATA_API_KEY=your_twelve_data_key
GEMINI_API_KEY=your_gemini_key
FINNHUB_API_KEY=your_finnhub_key

# Supabase
SUPABASE_URL=https://zrqscleekkenxfnrxvzg.supabase.co
SUPABASE_KEY=your_anon_key_here
SUPABASE_SERVICE_KEY=your_service_key_here

# CORS
CORS_ORIGIN=http://localhost:5173,http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF
```

---

## 📁 Files Updated for Your Deployment

### ✅ 1. vercel.json
- Changed `"src": "api/index.ts"` → `"src": "server.ts"`
- Changed `"dest": "api/index.ts"` → `"dest": "server.ts"`
- Removed duplicate Referrer-Policy header

### ✅ 2. .env.example
- Added your Supabase URL: `https://zrqscleekkenxfnrxvzg.supabase.co`
- Added Supabase key placeholders
- Removed quotes from values (better compatibility)

### ✅ 3. src/lib/supabase.ts
- Updated to use your Supabase URL as fallback
- Supports both `VITE_` prefixed (client) and regular (server) env vars
- Defaults to your project URL

### ✅ 4. src/components/SupabaseSync.tsx
- Updated example to show correct variable names

---

## 🚀 Part 3: Deploy to Vercel

### Option A: Vercel CLI (Recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy (from project root)
cd /project/workspace
vercel
```

Follow the prompts:
1. Link to existing project or create new
2. Project name: `apexfx-terminal`
3. Framework: `Other`
4. Build command: `npm run build`
5. Output directory: `dist`
6. Install command: `npm install`

### Option B: GitHub Integration

1. Push your code to GitHub:
```bash
cd /project/workspace
git add .
git commit -m "Ready for deployment with Supabase zrqscleekkenxfnrxvzg"
git push origin main
```

2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "Add New" → "Project"
4. Import your repository
5. Configure settings:
   - Framework: Other
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`
6. Click "Deploy"

### Option C: One-Command Deploy

```bash
cd /project/workspace
vercel --prod
```

---

## ✅ Part 4: Post-Deployment

### 1. Update CORS with Production Domain

After deployment, update your Vercel environment variables:

```
CORS_ORIGIN=https://your-app-name.vercel.app
```

Replace `your-app-name` with your actual Vercel domain.

### 2. Test Your Deployment

```bash
# Health check
curl https://your-app.vercel.app/health

# Test prices endpoint
curl https://your-app.vercel.app/api/market/prices

# Test historical data
curl "https://your-app.vercel.app/api/market/history?symbol=EURUSD&timeframe=1H"
```

### 3. Verify Supabase Connection

Open your deployed app and:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Check for any Supabase connection errors
4. Try opening a test position - it should sync to Supabase

---

## 🎯 Part 5: Database Testing

### Verify Tables Exist

Go to: [https://app.supabase.com/project/zrqscleekkenxfnrxvzg/table-editor](https://app.supabase.com/project/zrqscleekkenxfnrxvzg/table-editor)

You should see:
- `positions` table
- `closed_trades` table

### Test RLS Policies

Run this in SQL Editor to test:

```sql
-- Should return your user's data only
SELECT * FROM positions;

-- Should fail for other users
SELECT * FROM positions WHERE user_id != auth.uid();
```

---

## 🔧 Configuration Reference

### Polling Intervals (Already Configured)

| Component | Interval | Purpose |
|-----------|----------|---------|
| Server | 3,000ms (3s) | Fetch from Twelve Data |
| Client | 3,000ms (3s) | Poll `/api/market/prices` |
| Clock | 1,000ms (1s) | Update time display |
| Quote | 60,000ms (60s) | Fetch active symbol quote |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health status |
| GET | `/api/market/prices` | Real-time prices (from server state) |
| GET | `/api/market/history` | Historical candlesticks |
| GET | `/api/market/quote` | Single symbol quote |
| GET | `/api/market/news` | Market news |
| GET | `/api/forex` | Forex rates (Frankfurter) |
| GET | `/api/market/forexrate` | Forex rates (ForexRate API) |
| POST | `/api/chat` | AI chat |

---

## 🐛 Troubleshooting

### Issue: CORS Errors

**Error:** `Access to fetch at '...' from origin '...' has been blocked by CORS policy`

**Fix:**
1. Ensure `CORS_ORIGIN` in Vercel includes your domain
2. Check Supabase CORS settings include your Vercel domain
3. Restart deployment

### Issue: Supabase Connection Failed

**Error:** `Failed to connect to Supabase`

**Fix:**
1. Verify `SUPABASE_URL` is `https://zrqscleekkenxfnrxvzg.supabase.co`
2. Verify `SUPABASE_KEY` is your actual anon key
3. Check Supabase project settings → API
4. Ensure your domain is in Supabase Auth → Site URL

### Issue: API Keys Not Working

**Error:** `Twelve Data API key not configured`

**Fix:**
1. Verify environment variables are set in Vercel dashboard
2. Check variable names match exactly (case-sensitive)
3. Restart deployment
4. Check Vercel function logs

### Issue: Build Failed

**Error:** `Cannot find module 'zod'`

**Fix:**
```bash
npm install zod
npm run build
```

### Issue: Serverless Function Timeout

**Error:** `Function execution timeout (10s)`

**Fix:**
1. Upgrade to Vercel Pro for 60-second timeout
2. Or optimize your API calls
3. Or reduce polling frequency

---

## 📊 Monitoring & Analytics

### Vercel Analytics
- Go to: [https://vercel.com/dashboard](https://vercel.com/dashboard)
- View deployments, logs, and performance

### Supabase Dashboard
- Go to: [https://app.supabase.com/project/zrqscleekkenxfnrxvzg](https://app.supabase.com/project/zrqscleekkenxfnrxvzg)
- Monitor database activity, logs, and usage

---

## 🎯 Next Steps After Deployment

1. **Set up CI/CD**
   - GitHub Actions for automatic deployments
   - Run tests before deployment

2. **Add Monitoring**
   - Error tracking (Sentry, etc.)
   - Performance monitoring

3. **Implement Authentication**
   - Supabase Auth for user accounts
   - Protect trade data per user

4. **Optimize**
   - Add caching for historical data
   - Implement CDN for static assets
   - Fine-tune polling intervals

---

## 📚 Quick Commands

| Action | Command |
|--------|---------|
| Install dependencies | `npm install` |
| Local development | `npm run dev` |
| Build for production | `npm run build` |
| Start production server | `npm start` |
| Run tests | `npm test` |
| Deploy to Vercel | `vercel` or `vercel --prod` |

---

## 💡 Pro Tips

1. **Use Supabase Storage** for chart screenshots
2. **Enable Edge Functions** for faster API responses
3. **Set up Database Webhooks** for real-time notifications
4. **Use Vercel Analytics** to track user engagement
5. **Implement rate limiting** per user, not just globally

---

## 📞 Support & Resources

- [Vercel Docs](https://vercel.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Twelve Data API Docs](https://twelvedata.com/docs)
- [ApexFX Terminal Issues](https://github.com/your-repo/issues)

---

**Your Supabase Project:** `zrqscleekkenxfnrxvzg`  
**Deployment Date:** $(date)  
**Last Updated:** June 2026
