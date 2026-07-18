# ChartForge Live

A real-time crypto charting platform: live Binance market data, a
TradingView-style chart engine (built on TradingView's own open-source
[lightweight-charts](https://github.com/tradingview/lightweight-charts)),
a full indicator set, nine drawing tools, an order book, a live trade tape,
a screener, and an automated market commentary panel.

**This build has zero possible running cost.** No API keys, no paid
services, no usage-based billing anywhere in the stack. See "Why this is
free" below for exactly why.

## Why this is free

- **Market data (Binance)**: public REST + WebSocket endpoints, no key,
  no charge, no rate-limit billing. This was already free.
- **Hosting (Vercel)**: the free Hobby tier easily covers this. The live
  data — candles, order book, trades, watchlist prices — streams **directly
  from the visitor's browser to Binance**, never through your Vercel
  functions, so there's very little for Vercel to do per visit (serve the
  page + a small number of proxy calls). Hobby tier is for non-commercial
  use; that's a terms-of-service detail, not a cost.
- **Market Commentary panel**: this used to call the Claude API (a paid,
  metered service). It's been replaced with `lib/insightGenerator.ts`, which
  writes the same kind of summary — trend, momentum, volatility, a level to
  watch — from the exact same live indicator values (RSI, MACD, Supertrend,
  ATR, moving averages), using deterministic rules and varied phrasing
  templates instead of an LLM call. It runs instantly, in the browser, for
  $0, no matter how many times it's clicked or how much traffic the site
  gets. It reads like a written summary because it's built from real,
  current numbers — it just isn't AI-generated prose, and doesn't claim to
  be.

Nothing in this project requires an account, a credit card, or an
environment variable to run.

## What this is (and isn't)

- **Data source: Binance**, not TradingView. TradingView doesn't sell or
  share a public data API — their charts run on direct exchange/vendor
  licensing deals that aren't resellable. What *is* public is their
  charting engine (`lightweight-charts`), which is what renders the chart
  here. Prices, candles, order book, and trades all come live from
  **Binance's public REST + WebSocket APIs**.
- **Crypto only.** Free real-time data at this quality doesn't really exist
  for stocks/forex. The code is structured so a provider could be added
  later behind the same `Bar`/API-route interface — that would likely bring
  its own costs and API key, unlike everything currently in this project.
- **No live trading.** This reads market data only. Placing real orders
  needs your private exchange API keys and HMAC request signing — a real
  security and financial-risk surface that isn't wired up here on purpose.
- **Drawing tools**: trend line, horizontal line, horizontal ray, vertical
  line, rectangle, Fibonacci retracement, parallel channel, arrow, and text
  notes. Gann fans, Elliott wave, and pitchfork tools aren't included.
- **Geo note**: `binance.com` blocks US IP addresses for regulatory reasons.
  If your users are in the US, point the app at Binance.US's API instead (or
  another exchange like Coinbase/Kraken) — the endpoints in `lib/` and
  `app/api/` are the only places that would need to change.
- I couldn't test the Binance integration against its live servers from the
  sandbox this was built in (network access there is restricted to package
  registries), so it's built strictly from Binance's current public API docs
  and validated with mocked responses, not a live run. Do a quick smoke test
  right after your first deploy.

## Features

- Live candlestick chart with pan/zoom, multi-pane layout (price, RSI, MACD,
  Stochastic), and a live-updating forming candle
- Overlays: SMA(20), EMA(50), Bollinger Bands(20,2), VWAP, Supertrend(10,3)
- Order book (top 20, live) and recent trades tape
- Watchlist (12 major pairs by default) with live price/%change
- Screener with sortable columns and real computed RSI/rating per symbol
- Market Commentary panel — instant, local, free, generated from live data
- Responsive layout down to tablet width; desktop-first like most charting
  tools

## Local setup

```bash
npm install
npm run dev
```

Open http://localhost:3000. That's it — no environment variables, no
`.env` file, nothing to configure.

## Deploying to Vercel

**Option A — Git (recommended)**
1. Push this folder to a new GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo. Vercel
   auto-detects Next.js — no config needed, no environment variables to set.
3. Deploy.

**Option B — CLI**
```bash
npm i -g vercel
vercel --prod
```

No `vercel.json`, no secrets, no build command overrides required.

## Project structure

```
app/
  page.tsx                  entry point (client-only render, chart lib is browser-only)
  api/klines/route.ts       proxies Binance historical candles, edge-cached briefly
  api/tickers/route.ts      proxies Binance 24h stats (top-by-volume or specific symbols)
components/
  ChartForgeApp.tsx         top-level state + layout
  ChartPanel.tsx            lightweight-charts instance, panes, series, live updates
  DrawingOverlay.tsx        canvas overlay for the 9 drawing tools
  Toolbar.tsx, Watchlist.tsx, MarketDepthPanel.tsx, Screener.tsx, AnalysisPanel.tsx, Gauge.tsx
lib/
  indicators.ts             SMA/EMA/Bollinger/RSI/MACD/Stochastic/VWAP/ATR/Supertrend + rating aggregation
  insightGenerator.ts       free, rule-based market commentary (replaces the old paid AI call)
  useBinanceSocket.ts       the two WebSocket connections (active symbol + watchlist tickers)
  binanceRest.ts            client fetch helpers for the /api routes
  types.ts, format.ts, symbols.ts
```

## Extending it

- **More symbols**: edit `DEFAULT_WATCHLIST` in `lib/symbols.ts`.
- **A stock/forex feed**: add a new set of API routes + a socket hook next to
  the Binance ones, and feed the same `Bar[]` shape into `ChartPanel`. Note
  this would likely introduce its own costs, unlike the current Binance setup.
- **More drawing tools**: `DrawingOverlay.tsx` has one render branch per tool
  type — Gann/Elliott/pitchfork would each be a new case there.
- **Bring back LLM-generated commentary**: if you ever want real AI prose
  instead of the free rule-based version, add a `/api/insight` route that
  calls the Claude API server-side (keeping the key off the client) and
  swap the call in `AnalysisPanel.tsx`. That reintroduces a small per-use
  cost — the previous version of this project did exactly that.
- **Alerts**: the indicator math already runs client-side; a `setInterval`
  checking conditions against `bars` plus the Notifications API would cover
  basic price/indicator alerts.
