# ApexFX Terminal 📈⚡

ApexFX Terminal is a high-performance, next-generation **multi-confluence Forex and Commodity trading workstation**. Designed with desktop-first precision and responsive mobile adapters, this full-stack terminal provides professional traders with live quotes, real historical interactive charting, dynamic volatility risk indicators, and real-time AI-powered confluence analytics.

---

## 🌟 Core Features

### 1. Real-Time Data Pipeline
* **Dual-Streaming Engine**: Integrates live WebSocket updates with a **reliable background HTTP polling fallback** to ensure your price feed remains active, even in restrictive firewalls or connection drops.
* **Yahoo Finance Real Quotes**: Synchronizes live market prices for top-tier currency pairs (`EUR/USD`, `GBP/USD`, `USD/JPY`, `AUD/USD`, `USD/CAD`, `GBP/JPY`) and core precious metals/commodities (`XAU/USD` (Gold), `XAG/USD` (Silver)).

### 2. High-Precision Charting & Confluence Overlays
* **Real Historical Candlesticks**: Fetches actual, live historical price intervals (`1m`, `5m`, `15m`, `1H`, `4H`, `D`) directly from Yahoo Finance API.
* **Multi-Indicator Confluence Matrix**: Quick-toggle overlays for:
  * **SMA & EMA** (Moving Averages)
  * **RSI** (Relative Strength Index)
  * **MACD** (Moving Average Convergence Divergence)
  * **Bollinger Bands** (Volatility Bands)
* **Live Session Range HUD**: Custom session gauge representing current price relative to the selected period's absolute lows and highs.
* **ATR (Average True Range) Risk HUD**: Advanced volatility scanner displaying real-time risk classification (LOW, MEDIUM, HIGH) relative to historical ratios.

### 3. Integrated AI Assistant
* **Next-Gen Confluence Engine**: Built-in chat container powered by Google Gemini.
* **Smart Context Awareness**: The assistant automatically reads the current active symbol, timeframe, indicators, latest candles, and active positions to provide precise technical critiques, risk management audits, and trend confluences.

### 4. Auxiliary Panels
* **Pattern Scanner**: Dynamically analyzes the historical candlestick sequence to isolate classical price-action patterns (e.g., Bullish/Bearish Engulfing, Hammer, Inverted Hammer, Doji).
* **Live News Feed**: Keeps you updated with real-world macroeconomic developments and interest rate projections.
* **Position execution panel**: Simulates mock and synchronized real order routing with stop-loss and take-profit bounds.

---

## 🛠️ Technology Stack

* **Frontend**: React 18+, Vite, Tailwind CSS, Lucide Icons, Recharts, Motion animations.
* **Backend**: Express.js server on Node.js.
* **APIs & Data**: Yahoo Finance REST API, Custom WebSocket servers, Google Gemini API.
* **Language & Quality**: TypeScript, ESLint.

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
```

### Installation
Install the project dependencies:
```bash
npm install
```

### Running the Terminal
To run the full-stack development workspace (Express serving the backend + Vite bundling frontend):
```bash
npm run dev
```
The terminal will be live at `http://localhost:3000`.

### Production Build
Compile both the React application and the Express backend into an optimal static bundle and self-contained server executable:
```bash
npm run build
npm start
```

---

## 📂 Project Architecture

```text
├── server.ts              # Full-stack backend server (API Proxy, WS Feed, Gemini Chat)
├── package.json           # Scripts and dependencies
├── tailwind.config.ts     # Tailwind CSS theme settings
├── src/
│   ├── App.tsx            # Main Terminal layout and global structure
│   ├── main.tsx           # React entrypoint
│   ├── index.css          # Global CSS imports and custom Tailwind extensions
│   ├── types.ts           # Unified TypeScript definitions & enums
│   ├── components/        # Isolated visual modules
│   │   ├── TradingChart.tsx   # SVG Candlestick & Indicator chart
│   │   ├── Watchlist.tsx      # Multi-instrument rate cards with tick flashes
│   │   ├── SignalPanel.tsx    # Technical overview of buy/sell triggers
│   │   ├── PositionsPanel.tsx # Active trades & order book execution
│   │   ├── PatternPanel.tsx   # Automated price-action pattern recognition
│   │   └── AiAssistant.tsx    # Immersive Gemini intelligence center
│   ├── context/
│   │   └── TradingContext.tsx # Central state orchestration & WebSockets
│   └── utils/
│       └── forexData.ts       # Mathematical indicators and pattern algorithms
```

---

## 📊 Licensing & Disclaimer
ApexFX Terminal is designed purely for simulation, paper-trading, and educational research purposes. Real trading in leveraged foreign exchange and commodities involves high risk. All financial analytics and AI confluences generated inside this workstation should be verified independently.
