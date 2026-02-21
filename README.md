# BitCharts Pro

BitCharts Pro is a Binance-style crypto charting web app with live market data, multi-chart layouts, and AI-assisted market annotations.

It includes:
- Live candles/orderbook/trades from Binance public APIs
- Technical indicators (SMA, EMA, Bollinger Bands, RSI, MACD)
- Single and multi-chart modes (1/2/3/4)
- AI analysis pipeline (Gemini + deterministic fallback)
- Support/resistance, trend lines, and buy/sell markers rendered on chart

## 1. What This Project Does

BitCharts Pro provides a trading-terminal style interface where you can:
- Switch symbols (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, etc.)
- Switch intervals (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`)
- View real-time candlestick movement
- Inspect orderbook + recent trades
- Enable/disable common indicators
- Run AI analysis and draw market structure on chart

## 2. Tech Stack

- Frontend:
  - `index.html`
  - `styles.css`
  - `app.js`
  - `lightweight-charts` (CDN)
- Backend:
  - `server.js` (Node.js HTTP server, no framework)
- AI:
  - Gemini API (`generateContent`)
- Market/news inputs:
  - Binance market data API + websocket
  - Binance announcements API
  - Coinbase status Atom feed
  - CoinDesk RSS
  - Optional Telegram public channels

## 3. Project Structure

```text
BitCharts/
├── app.js          # Frontend logic, chart rendering, sockets, AI overlays
├── index.html      # UI layout
├── styles.css      # Styling + responsive layouts
├── server.js       # Static server + AI/news analysis API
├── package.json    # npm metadata + start script
├── .env.example    # Environment variable template
└── README.md       # Documentation
```

## 4. How AI Analysis Works

### Analysis flow

1. Frontend calls:
   - `GET /api/ai/analyze?symbol=BTCUSDT&interval=1h`
2. Backend fetches:
   - Candles for `1m,5m,15m,1h,4h,1d`
   - News/signal sources
3. Backend computes deterministic analysis:
   - EMA/RSI/MACD/ATR + swing points + support/resistance
4. If Gemini key exists:
   - Gemini refines/adjusts analysis
5. Frontend renders overlays on current interval:
   - Trend lines
   - Horizontal support/resistance zones
   - Buy/Sell marker arrows

### Safety behavior

- If Gemini is missing/down, analysis still works with deterministic fallback.
- API response includes whether fallback was used.

## 5. API Endpoints

### `GET /api/health`
Checks server status.

### `GET /api/ai/analyze?symbol=BTCUSDT&interval=1h`
Returns:
- `analyses` by timeframe (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`)
- `trendLines`, `support`, `resistance`, `buyPoints`, `sellPoints`
- `news` summary + sentiment score
- provider mode (`gemini` or `rules` fallback)

## 6. Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Supported vars:

- `PORT` (default: `8080`)
- `GEMINI_API_KEY` (recommended for AI refinement)
- `GEMINI_MODEL` (default suggested: `gemini-2.5-flash`)
- `TELEGRAM_CHANNELS` (optional comma-separated public handles)

Example:

```env
PORT=8080
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
TELEGRAM_CHANNELS=binancekillers
```

## 7. Get Started (Run Locally)

### Prerequisites

- Node.js 18+ (Node 20+ recommended)
- Internet connection

### Start

```bash
cd /home/arjun/Projects/BitCharts
cp .env.example .env
# edit .env and add GEMINI_API_KEY
node server.js
```

Open:

```text
http://localhost:8080
```

## 8. Usage Guide

1. Enter symbol and press `Enter`.
2. Choose interval (1m/5m/15m/1h/4h/1d).
3. Click `AI Analyze`.
4. Keep `Auto refresh` enabled for periodic updates.
5. Switch `Multi View` to 2/3/4 to monitor multiple symbols.

Notes:
- AI overlays are shown in single-chart mode.
- Multi-chart mode prioritizes compact monitoring.

## 9. Troubleshooting

### I don’t see AI trend lines

- Make sure you started with `node server.js` (not `python -m http.server`)
- Open `http://localhost:8080/api/health` and check JSON response
- Click `AI Analyze`
- Ensure `Multi View` is `1 Chart`
- Check `.env` has a valid `GEMINI_API_KEY` (fallback still works, but key improves output)

### Port already in use

Run on another port:

```bash
PORT=8099 node server.js
```

### Binance/Coinbase feed problems

Some sources may intermittently block/rate-limit requests. The backend is built to continue with partial sources when possible.

## 10. Limitations

- This is not a brokerage/execution platform.
- AI outputs are probabilistic and not financial advice.
- Public web feeds can change formats or become rate-limited.
- Full Binance terminal parity is outside scope.

## 11. Upload to GitHub (Step-by-Step)

This folder is currently not a git repo, so do this once:

```bash
cd /home/arjun/Projects/BitCharts
git init
git add .
git commit -m "Initial commit: BitCharts Pro with AI analysis"
```

### Create GitHub repo

1. Go to `https://github.com/new`
2. Repo name example: `BitCharts-Pro`
3. Keep it empty (do not auto-add README/.gitignore/license)
4. Create repo

### Connect and push

Replace `YOUR_USERNAME` and repo name:

```bash
git remote add origin https://github.com/YOUR_USERNAME/BitCharts-Pro.git
git branch -M main
git push -u origin main
```

## 12. Recommended Next Improvements

- Show AI overlays in multi-chart mode per tile
- Add per-timeframe confidence heatmap
- Add backtesting panel for generated signals
- Add caching/rate limiting for external news sources

---

## Disclaimer

This project is for educational and research use. Nothing in this repository is investment advice.
