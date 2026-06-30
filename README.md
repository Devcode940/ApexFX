# ApexFX Terminal

ApexFX Terminal is a high-performance, next-generation **multi-confluence Forex and Commodity trading workstation**. Provides live quotes, interactive charting with technical indicators, volatility risk analysis, candlestick pattern detection, and AI-powered confluence analytics.

---

## Features

### 1. Real-Time Data Pipeline
- **Dual-streaming engine**: WebSocket updates with HTTP polling fallback
- **Multiple data sources**: Yahoo Finance, Twelve Data, Alpha Vantage, Frankfurter, Finnhub
- Real-time watchlist with bid/ask spreads and price tick updates

### 2. Professional Charting
- Interactive candlestick chart via **Lightweight Charts**
- Historical data across `1m`, `5m`, `15m`, `1H`, `4H`, `D` timeframes
- Drawing tools: horizontal lines, trendlines, Fibonacci retracements, annotations, risk/reward markers
- **Technical indicators**: SMA, EMA, RSI, MACD, Bollinger Bands, ATR
- ATR-based volatility HUD with risk classification (LOW / MEDIUM / HIGH)

### 3. AI Assistant
- Google Gemini-powered chat with automatic context (symbol, timeframe, indicators, positions)

### 4. Auxiliary Panels
- **Pattern Scanner**: Bullish/Bearish Engulfing, Hammer, Doji, Harami, Piercing, Dark Cloud, etc.
- **News Feed**: Macroeconomic developments via Finnhub
- **Position Panel**: Paper trading with SL/TP simulation
- **Supabase Sync**: Optional cross-session trade history persistence

---

## Tech Stack

- **Frontend**: React 18+, Vite 6, Tailwind CSS v4, Lightweight Charts, Recharts, Lucide Icons, Motion
- **Backend**: Express.js, ws (WebSocket), Pino logger, Helmet, express-rate-limit
- **APIs**: Yahoo Finance, Twelve Data, Alpha Vantage, Frankfurter, Finnhub, Google Gemini
- **Language**: TypeScript
- **Testing**: Vitest

---

## Getting Started

### Prerequisites
- Node.js v18+
- npm or yarn

### Environment Setup
Copy `.env.example` to `.env` and fill in your API keys:
```env
PORT=3000
GEMINI_API_KEY=your_key_here
TWELVEDATA_API_KEY=your_key_here
ALPHA_VANTAGE_API_KEY=your_key_here
FINNHUB_API_KEY=your_key_here
SUPABASE_URL=your_url_here
SUPABASE_KEY=your_key_here
```

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```
Opens at `http://localhost:3000`.

### Production Build
```bash
npm run build
npm start
```

### Tests
```bash
npm test
```

---

## Project Structure

```
├── server.ts                      # Express backend (API proxy, WebSocket, Gemini)
├── vite.config.ts                 # Vite + Vitest configuration
├── vercel.json                    # Vercel deployment config
├── src/
│   ├── App.tsx                    # Main terminal layout
│   ├── types.ts                   # TypeScript definitions
│   ├── constants/config.ts        # Centralized configuration
│   ├── components/
│   │   ├── TradingChart.tsx       # Candlestick chart with indicators
│   │   ├── Watchlist.tsx          # Instrument rate cards
│   │   ├── SignalPanel.tsx        # Buy/sell signal overview
│   │   ├── PositionsPanel.tsx     # Paper trading positions
│   │   ├── PatternPanel.tsx       # Candlestick pattern detection
│   │   ├── NewsPanel.tsx          # Macro news feed
│   │   ├── AiAssistant.tsx        # Gemini chat integration
│   │   ├── ErrorBoundary.tsx      # React error boundary
│   │   └── SupabaseSync.tsx       # Cloud trade sync
│   ├── context/
│   │   └── TradingContext.tsx      # Global state & WebSocket orchestration
│   ├── utils/
│   │   ├── forexData.ts           # Indicators, signals, simulation
│   │   └── forexData.test.ts      # Utility tests
│   └── test/
│       └── setup.ts               # Test environment setup
```

---

## Disclaimer

ApexFX Terminal is designed for simulation, paper-trading, and educational research. Real forex and commodities trading involves substantial risk. All analytics should be verified independently.
