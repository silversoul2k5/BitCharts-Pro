'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, Drawing, DrawingTool, IndicatorState, Interval, OscillatorState, TickerSnapshot } from '@/lib/types';
import { DEFAULT_SYMBOL, DEFAULT_WATCHLIST, prettySymbol } from '@/lib/symbols';
import { fetchKlines, fetchTickers } from '@/lib/binanceRest';
import { useActiveMarketSocket, useWatchlistSocket } from '@/lib/useBinanceSocket';
import { formatPrice, formatPercent } from '@/lib/format';

import Watchlist from './Watchlist';
import Toolbar from './Toolbar';
import ChartPanel, { ChartApiRefs } from './ChartPanel';
import DrawingOverlay from './DrawingOverlay';
import MarketDepthPanel from './MarketDepthPanel';
import AnalysisPanel from './AnalysisPanel';
import Screener from './Screener';

const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;

export default function ChartForgeApp() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [interval, setInterval_] = useState<Interval>('1h');
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<'chart' | 'screener'>('chart');
  const [searchInput, setSearchInput] = useState('');
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [indicators, setIndicators] = useState<IndicatorState>({ sma20: true, ema50: true, bb: false, vwap: false, supertrend: false });
  const [oscillators, setOscillators] = useState<OscillatorState>({ rsi: true, macd: true, stoch: false });
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [drawings, setDrawings] = useState<Drawing[]>([]);

  const [restTickers, setRestTickers] = useState<Record<string, TickerSnapshot>>({});
  const [screenerBars, setScreenerBars] = useState<Record<string, Bar[]>>({});

  const chartApiRef = useRef<ChartApiRefs | null>(null);
  const [chartApi, setChartApi] = useState<ChartApiRefs | null>(null);
  const prevLiveKlineRef = useRef<Bar | null>(null);

  const activeMarket = useActiveMarketSocket(symbol, interval);
  const watchlistSocket = useWatchlistSocket(DEFAULT_WATCHLIST);

  const tickers = useMemo(() => ({ ...restTickers, ...watchlistSocket.tickers }), [restTickers, watchlistSocket.tickers]);

  // Initial watchlist snapshot + per-symbol daily history for the screener (fetched once).
  useEffect(() => {
    fetchTickers(DEFAULT_WATCHLIST)
      .then((list) => setRestTickers(Object.fromEntries(list.map((t) => [t.symbol, t]))))
      .catch(() => {});
    Promise.all(
      DEFAULT_WATCHLIST.map((s) =>
        fetchKlines(s, '1d', 220)
          .then((b) => [s, b] as const)
          .catch(() => [s, []] as const)
      )
    ).then((pairs) => setScreenerBars(Object.fromEntries(pairs)));
  }, []);

  // Historical bars for the active symbol/interval.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear stale state the instant symbol/interval changes, before the new fetch resolves
    setLoading(true);
    setLoadError(null);
    fetchKlines(symbol, interval, 500)
      .then((data) => {
        if (cancelled) return;
        setBars(data);
        prevLiveKlineRef.current = null;
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load market data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  // Fold a just-closed candle permanently into history once the live stream moves to a new bar.
  useEffect(() => {
    const kline = activeMarket.kline;
    if (!kline) return;
    const prev = prevLiveKlineRef.current;
    if (prev && kline.time > prev.time) {
      setBars((old) => {
        if (!old.length || old[old.length - 1].time >= prev.time) return old;
        return [...old, prev];
      });
    }
    prevLiveKlineRef.current = kline;
  }, [activeMarket.kline]);

  function selectSymbol(next: string) {
    const sym = next.toUpperCase();
    if (sym === symbol) return;
    setSymbol(sym);
    setDrawings([]);
    setActiveTool('cursor');
    setMobileWatchlistOpen(false);
  }

  function handleIntervalChange(next: Interval) {
    setInterval_(next);
    setDrawings([]);
    setActiveTool('cursor');
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const candidate = searchInput.trim().toUpperCase();
    if (SYMBOL_RE.test(candidate)) selectSymbol(candidate);
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 4000);
  }

  const { base, quote } = prettySymbol(symbol);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const liveOrLast = activeMarket.kline || last;
  const change = liveOrLast && prev ? liveOrLast.close - prev.close : 0;
  const changePct = liveOrLast && prev && prev.close ? (change / prev.close) * 100 : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <button className="icon-btn mobile-only" onClick={() => setMobileWatchlistOpen((o) => !o)} title="Watchlist">☰</button>
          <div className="brand">Chart<span className="brand-accent">Forge</span> Live</div>
          <button
            className="premium-badge"
            onClick={() => showToast('Live Binance market data. Educational tool only — not financial advice.')}
          >
            ✦ LIVE
          </button>
        </div>

        <div className="symbol-block">
          <input
            className="symbol-search"
            placeholder="Search or type a symbol…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <div className="current-symbol">{base}/{quote}</div>
          <div className="current-price-block">
            <span className="current-price">{liveOrLast ? formatPrice(liveOrLast.close) : '—'}</span>
            <span className={`current-change ${change >= 0 ? 'positive' : 'negative'}`}>
              {liveOrLast && prev ? `${change >= 0 ? '+' : ''}${formatPrice(change)} (${formatPercent(changePct)})` : ''}
            </span>
          </div>
        </div>

        <div className="view-tabs">
          <button className={`view-tab${view === 'chart' ? ' active' : ''}`} onClick={() => setView('chart')}>Chart</button>
          <button className={`view-tab${view === 'screener' ? ' active' : ''}`} onClick={() => setView('screener')}>Screener</button>
        </div>

        <div className={`live-badge ${activeMarket.connected ? 'live' : 'down'}`}>
          <span className={`pulse-dot ${activeMarket.connected ? '' : 'off'}`} />
          {activeMarket.connected ? 'LIVE' : 'CONNECTING'}
        </div>
      </header>

      <div className="main-layout">
        <aside className={`watchlist-panel${mobileWatchlistOpen ? ' mobile-open' : ''}`}>
          <div className="panel-title">Watchlist</div>
          <Watchlist symbols={DEFAULT_WATCHLIST} tickers={tickers} activeSymbol={symbol} onSelect={selectSymbol} filter={searchInput} />
        </aside>

        {view === 'chart' ? (
          <div className="chart-view">
            <Toolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              onClear={() => setDrawings([])}
              onReset={() => chartApiRef.current?.chart.timeScale().fitContent()}
              interval={interval}
              onIntervalChange={handleIntervalChange}
              indicators={indicators}
              onIndicatorsChange={setIndicators}
              oscillators={oscillators}
              onOscillatorsChange={setOscillators}
            />
            <div className="chart-stage">
              <ChartPanel
                bars={bars}
                liveKline={activeMarket.kline}
                interval={interval}
                indicators={indicators}
                oscillators={oscillators}
                onReady={(refs) => {
                  chartApiRef.current = refs;
                  setChartApi(refs);
                }}
              />
              <DrawingOverlay
                chart={chartApi?.chart ?? null}
                mainSeries={chartApi?.mainSeries ?? null}
                activeTool={activeTool}
                drawings={drawings}
                onDrawingsChange={(updater) => setDrawings(updater)}
                onToolComplete={() => setActiveTool('cursor')}
              />
              {loading && <div className="chart-loading">Loading {symbol}…</div>}
              {!loading && loadError && <div className="chart-loading">{loadError}</div>}
            </div>
          </div>
        ) : (
          <div className="screener-view">
            <Screener symbols={DEFAULT_WATCHLIST} tickers={tickers} barsBySymbol={screenerBars} onSelect={selectSymbol} />
          </div>
        )}

        <MarketDepthPanel orderBook={activeMarket.orderBook} trades={activeMarket.trades} />
        <AnalysisPanel key={symbol} symbol={symbol} interval={interval} bars={bars} />
      </div>

      <footer className="statusbar">
        <span><span className={`pulse-dot ${activeMarket.connected ? '' : 'off'}`} />Binance live feed</span>
        <span>{symbol} · {interval.toUpperCase()}</span>
        <span>Real-time crypto data via Binance. Educational use only — not financial advice.</span>
      </footer>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
