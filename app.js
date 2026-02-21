(() => {
  "use strict";

  const REST_BASE = "https://data-api.binance.vision/api/v3";
  const WS_BASE = "wss://stream.binance.com:9443/ws";
  const MAX_CANDLES = 600;
  const RECONNECT_DELAY_MS = 1500;
  const AI_REFRESH_DELAY_MS = 1400;
  const AI_MIN_REFRESH_MS = 45000;
  const AI_KEY_STORAGE_KEY = "bitcharts-gemini-key";
  const AI_KEY_HEADER = "X-Gemini-Api-Key";
  const AI_TIMEFRAMES = ["1d", "4h", "1h", "15m"];
  const MULTI_DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
  const MULTI_LAYOUT_STORAGE_KEY = "bitcharts-multi-layouts";
  const MULTI_LAYOUT_PRESETS = {
    1: ["one"],
    2: ["two-cols", "two-rows"],
    3: ["three-cols", "three-rows"],
    4: ["four-grid"]
  };
  const MULTI_LAYOUT_DEFAULTS = {
    1: "one",
    2: "two-cols",
    3: "three-rows",
    4: "four-grid"
  };

  const PALETTES = {
    dark: {
      text: "#d6e0f5",
      grid: "rgba(129, 157, 194, 0.18)",
      up: "#0ecb81",
      down: "#f6465d",
      accent: "#f0b90b",
      warn: "#ffb14a",
      aux1: "#53a3ff",
      aux2: "#d27aff",
      aux3: "#8f9bb3",
      pos: "rgba(14, 203, 129, 0.6)",
      neg: "rgba(246, 70, 93, 0.6)"
    },
    light: {
      text: "#10243d",
      grid: "rgba(71, 100, 136, 0.2)",
      up: "#09a565",
      down: "#d94150",
      accent: "#bd7d1d",
      warn: "#a46b19",
      aux1: "#2a75d6",
      aux2: "#a353cb",
      aux3: "#7387a3",
      pos: "rgba(9, 165, 101, 0.55)",
      neg: "rgba(217, 65, 80, 0.55)"
    }
  };

  const state = {
    symbol: "BTCUSDT",
    interval: "1m",
    theme: localStorage.getItem("bitcharts-theme") === "light" ? "light" : "dark",
    chartType: "candles",
    multiCount: Number(localStorage.getItem("bitcharts-multi-count") || "1"),
    multiLayouts: loadMultiLayouts(),
    candles: [],
    candleMap: new Map(),
    depth: { bids: [], asks: [] },
    trades: [],
    indicators: {
      volume: true,
      sma: true,
      ema: true,
      bb: true,
      rsi: true,
      macd: true
    },
    sockets: {},
    reconnectTimers: {},
    livePollTimer: null,
    streamNonce: 0,
    multiCharts: [],
    ai: {
      auto: true,
      enabled: true,
      loading: false,
      multiLoading: false,
      lastRunAt: 0,
      lastMultiRunAt: 0,
      timer: null,
      data: null,
      overlaySeries: [],
      markerApi: null,
      nonce: 0,
      apiKey: sanitizeApiKey(localStorage.getItem(AI_KEY_STORAGE_KEY))
    }
  };

  const dom = {
    app: document.querySelector(".app-shell"),
    layout: document.querySelector(".layout"),
    chartZone: document.querySelector(".chart-zone"),
    indicatorSwitches: document.querySelector(".indicator-switches"),
    symbolInput: document.getElementById("symbol-input"),
    intervalGroup: document.getElementById("interval-group"),
    chartType: document.getElementById("chart-type"),
    multiCount: document.getElementById("multi-count"),
    reloadBtn: document.getElementById("reload-btn"),
    aiRefreshBtn: document.getElementById("ai-refresh-btn"),
    fullscreenBtn: document.getElementById("fullscreen-btn"),
    themeBtn: document.getElementById("theme-btn"),
    geminiKeyInput: document.getElementById("gemini-key-input"),
    saveKeyBtn: document.getElementById("save-key-btn"),
    clearKeyBtn: document.getElementById("clear-key-btn"),
    marketTitle: document.getElementById("market-title"),
    ohlcRow: document.getElementById("ohlc-row"),
    statusPill: document.getElementById("status-pill"),
    showVolume: document.getElementById("show-volume"),
    showSma: document.getElementById("show-sma"),
    showEma: document.getElementById("show-ema"),
    showBb: document.getElementById("show-bb"),
    showRsi: document.getElementById("show-rsi"),
    showMacd: document.getElementById("show-macd"),
    layoutMenu: document.getElementById("layout-menu"),
    layoutMenuToggle: document.getElementById("layout-menu-toggle"),
    layoutMenuPanel: document.getElementById("layout-menu-panel"),
    layoutOptions: document.querySelectorAll(".layout-option"),
    aiAuto: document.getElementById("ai-auto"),
    aiStatus: document.getElementById("ai-status"),
    aiTimeframes: document.getElementById("ai-timeframes"),
    pricePane: document.getElementById("price-pane"),
    rsiPane: document.getElementById("rsi-pane"),
    macdPane: document.getElementById("macd-pane"),
    priceChart: document.getElementById("price-chart"),
    rsiChart: document.getElementById("rsi-chart"),
    macdChart: document.getElementById("macd-chart"),
    multiGrid: document.getElementById("multi-grid"),
    orderbook: document.getElementById("orderbook"),
    trades: document.getElementById("trades")
  };

  const charts = {
    price: null,
    rsi: null,
    macd: null
  };

  const series = {
    candles: null,
    line: null,
    area: null,
    baseline: null,
    volume: null,
    sma: null,
    ema: null,
    bbUpper: null,
    bbLower: null,
    bbMiddle: null,
    rsi: null,
    rsiUpper: null,
    rsiLower: null,
    macdLine: null,
    macdSignal: null,
    macdHist: null
  };

  let resizeObserver;

  function init() {
    if (!window.LightweightCharts) {
      setStatus("disconnected", "Chart library failed");
      return;
    }

    if (!Number.isInteger(state.multiCount) || state.multiCount < 1 || state.multiCount > 4) {
      state.multiCount = 1;
    }

    document.body.classList.toggle("theme-dark", state.theme === "dark");
    document.body.classList.toggle("theme-light", state.theme === "light");
    state.ai.auto = localStorage.getItem("bitcharts-ai-auto") !== "0";

    dom.showVolume.checked = state.indicators.volume;
    dom.showSma.checked = state.indicators.sma;
    dom.showEma.checked = state.indicators.ema;
    dom.showBb.checked = state.indicators.bb;
    dom.showRsi.checked = state.indicators.rsi;
    dom.showMacd.checked = state.indicators.macd;
    dom.aiAuto.checked = state.ai.auto;
    dom.multiCount.value = String(state.multiCount);
    dom.geminiKeyInput.value = state.ai.apiKey;
    ensureMultiLayoutDefaults();
    updateLayoutMenuState();
    closeLayoutMenu();
    setAiStatus("neutral", "AI idle");
    renderAiCards();

    initCharts();
    bindEvents();
    setActiveIntervalButton();
    setViewMode(state.multiCount, true);
    syncFullscreenButton();
  }

  function bindEvents() {
    dom.symbolInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const symbol = sanitizeSymbol(dom.symbolInput.value);
        if (!symbol) {
          return;
        }
        state.symbol = symbol;
        if (isMultiMode()) {
          updatePrimaryMultiSymbol(symbol);
        } else {
          loadMarket();
        }
      }
    });

    dom.intervalGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-interval]");
      if (!button) {
        return;
      }
      const nextInterval = button.dataset.interval;
      if (nextInterval === state.interval) {
        return;
      }
      state.interval = nextInterval;
      setActiveIntervalButton();
      renderAiCards();
      applyAiForCurrentInterval();
      if (isMultiMode()) {
        state.multiCharts.forEach((slot) => updateMultiAiSummary(slot));
        reloadMultiCharts();
      } else {
        loadMarket();
      }
    });

    dom.chartType.addEventListener("change", () => {
      state.chartType = dom.chartType.value;
      renderPriceSeries();
      updateOhlcFromLast();
    });

    dom.reloadBtn.addEventListener("click", () => {
      const symbol = sanitizeSymbol(dom.symbolInput.value);
      if (symbol) {
        state.symbol = symbol;
      }
      if (isMultiMode()) {
        updatePrimaryMultiSymbol(state.symbol);
        reloadMultiCharts();
      } else {
        loadMarket();
      }
    });

    dom.aiRefreshBtn.addEventListener("click", () => {
      runAiAnalysis(true);
    });

    dom.aiAuto.addEventListener("change", () => {
      state.ai.auto = dom.aiAuto.checked;
      localStorage.setItem("bitcharts-ai-auto", state.ai.auto ? "1" : "0");
      if (state.ai.auto) {
        scheduleAiAnalysis(250);
      } else {
        clearAiTimer();
      }
    });

    dom.saveKeyBtn.addEventListener("click", () => {
      saveAiApiKey(dom.geminiKeyInput.value);
    });

    dom.clearKeyBtn.addEventListener("click", () => {
      saveAiApiKey("");
    });

    dom.geminiKeyInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      saveAiApiKey(dom.geminiKeyInput.value);
    });

    dom.multiCount.addEventListener("change", () => {
      const count = Number(dom.multiCount.value);
      setViewMode(count);
    });

    dom.layoutMenuToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (dom.layoutMenuPanel.hidden) {
        openLayoutMenu();
      } else {
        closeLayoutMenu();
      }
    });

    dom.layoutMenuPanel.addEventListener("click", (event) => {
      event.stopPropagation();
      const option = event.target.closest(".layout-option[data-count][data-layout]");
      if (!option) {
        return;
      }

      const count = Number(option.dataset.count);
      const layout = option.dataset.layout;
      setMultiLayoutPreset(count, layout);

      if (count !== state.multiCount) {
        setViewMode(count);
      } else if (isMultiMode()) {
        applyMultiLayoutToGrid();
        requestAnimationFrame(() => {
          resizeMultiCharts();
          requestAnimationFrame(resizeMultiCharts);
        });
      }

      closeLayoutMenu();
    });

    dom.fullscreenBtn.addEventListener("click", () => {
      toggleChartFullscreen();
    });

    dom.themeBtn.addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      localStorage.setItem("bitcharts-theme", state.theme);
      document.body.classList.toggle("theme-dark", state.theme === "dark");
      document.body.classList.toggle("theme-light", state.theme === "light");
      applyThemeToCharts();
      applyThemeToMultiCharts();
      renderAll();
      renderAiCards();
      applyAiForCurrentInterval();
    });

    dom.showVolume.addEventListener("change", () => {
      state.indicators.volume = dom.showVolume.checked;
      renderIndicators();
    });

    dom.showSma.addEventListener("change", () => {
      state.indicators.sma = dom.showSma.checked;
      renderIndicators();
    });

    dom.showEma.addEventListener("change", () => {
      state.indicators.ema = dom.showEma.checked;
      renderIndicators();
    });

    dom.showBb.addEventListener("change", () => {
      state.indicators.bb = dom.showBb.checked;
      renderIndicators();
    });

    dom.showRsi.addEventListener("change", () => {
      state.indicators.rsi = dom.showRsi.checked;
      updatePaneVisibility();
      renderIndicators();
    });

    dom.showMacd.addEventListener("change", () => {
      state.indicators.macd = dom.showMacd.checked;
      updatePaneVisibility();
      renderIndicators();
    });

    document.addEventListener("fullscreenchange", syncFullscreenButton);
    document.addEventListener("webkitfullscreenchange", syncFullscreenButton);
    document.addEventListener("click", (event) => {
      if (!dom.layoutMenu.contains(event.target)) {
        closeLayoutMenu();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeLayoutMenu();
      }
    });
  }

  function initCharts() {
    const palette = getPalette();

    charts.price = LightweightCharts.createChart(dom.priceChart, buildPriceChartOptions(palette));
    charts.rsi = LightweightCharts.createChart(dom.rsiChart, buildSubChartOptions(palette));
    charts.macd = LightweightCharts.createChart(dom.macdChart, buildSubChartOptions(palette));

    charts.price.priceScale("").applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0
      }
    });

    charts.rsi.priceScale("right").applyOptions({
      autoScale: true,
      mode: LightweightCharts.PriceScaleMode.Normal,
      scaleMargins: { top: 0.1, bottom: 0.1 }
    });

    charts.rsi.timeScale().applyOptions({ visible: false });
    charts.macd.timeScale().applyOptions({ visible: false });

    series.candles = charts.price.addCandlestickSeries(candleSeriesOptions(palette));
    series.line = charts.price.addLineSeries({
      color: palette.aux1,
      lineWidth: 2,
      priceLineVisible: false
    });
    series.area = charts.price.addAreaSeries({
      lineColor: palette.aux1,
      topColor: colorWithAlpha(palette.aux1, 0.35),
      bottomColor: colorWithAlpha(palette.aux1, 0.03),
      lineWidth: 2,
      priceLineVisible: false
    });
    series.baseline = charts.price.addBaselineSeries({
      baseValue: { type: "price", price: 0 },
      topLineColor: palette.up,
      topFillColor1: colorWithAlpha(palette.up, 0.28),
      topFillColor2: colorWithAlpha(palette.up, 0.03),
      bottomLineColor: palette.down,
      bottomFillColor1: colorWithAlpha(palette.down, 0.23),
      bottomFillColor2: colorWithAlpha(palette.down, 0.03),
      lineWidth: 2,
      priceLineVisible: false
    });

    series.volume = charts.price.addHistogramSeries({
      priceScaleId: "",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.sma = charts.price.addLineSeries({
      color: palette.accent,
      lineWidth: 1.6,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.ema = charts.price.addLineSeries({
      color: palette.aux2,
      lineWidth: 1.6,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.bbUpper = charts.price.addLineSeries({
      color: colorWithAlpha(palette.aux3, 0.95),
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.bbLower = charts.price.addLineSeries({
      color: colorWithAlpha(palette.aux3, 0.95),
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.bbMiddle = charts.price.addLineSeries({
      color: colorWithAlpha(palette.aux3, 0.95),
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.SparseDotted,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.rsi = charts.rsi.addLineSeries({
      color: palette.aux1,
      lineWidth: 1.8,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.rsiUpper = charts.rsi.addLineSeries({
      color: colorWithAlpha(palette.down, 0.9),
      lineStyle: LightweightCharts.LineStyle.Dashed,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.rsiLower = charts.rsi.addLineSeries({
      color: colorWithAlpha(palette.up, 0.9),
      lineStyle: LightweightCharts.LineStyle.Dashed,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false
    });
    applyRsiFixedScale();

    series.macdLine = charts.macd.addLineSeries({
      color: palette.aux1,
      lineWidth: 1.5,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.macdSignal = charts.macd.addLineSeries({
      color: palette.warn,
      lineWidth: 1.5,
      lastValueVisible: false,
      priceLineVisible: false
    });

    series.macdHist = charts.macd.addHistogramSeries({
      priceLineVisible: false,
      lastValueVisible: false
    });

    charts.price.subscribeCrosshairMove((param) => {
      if (!param || !param.time) {
        updateOhlcFromLast();
        return;
      }
      const time = normalizeTime(param.time);
      if (!time) {
        updateOhlcFromLast();
        return;
      }
      const candle = state.candleMap.get(time);
      if (!candle) {
        updateOhlcFromLast();
        return;
      }
      updateOhlc(candle);
    });

    charts.price.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) {
        return;
      }
      charts.rsi.timeScale().setVisibleLogicalRange(range);
      charts.macd.timeScale().setVisibleLogicalRange(range);
    });

    resizeObserver = new ResizeObserver(() => resizeCharts());
    resizeObserver.observe(dom.pricePane);
    resizeObserver.observe(dom.rsiPane);
    resizeObserver.observe(dom.macdPane);
    window.addEventListener("resize", resizeCharts);
    window.addEventListener("resize", updatePaneVisibility);
    window.addEventListener("resize", resizeMultiCharts);
    resizeCharts();
  }

  function buildPriceChartOptions(palette) {
    return {
      autoSize: true,
      layout: {
        textColor: palette.text,
        background: { type: "solid", color: "transparent" },
        fontFamily: "IBM Plex Mono"
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid }
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.2 }
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      },
      localization: {
        locale: "en-US"
      }
    };
  }

  function buildSubChartOptions(palette) {
    return {
      autoSize: true,
      layout: {
        textColor: palette.text,
        background: { type: "solid", color: "transparent" },
        fontFamily: "IBM Plex Mono"
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid }
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.08 }
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false
      }
    };
  }

  function candleSeriesOptions(palette) {
    return {
      upColor: palette.up,
      downColor: palette.down,
      borderVisible: false,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      priceLineVisible: false
    };
  }

  function resizeCharts() {
    if (!charts.price) {
      return;
    }

    if (dom.pricePane.clientWidth > 0 && dom.pricePane.clientHeight > 0) {
      charts.price.resize(dom.pricePane.clientWidth, dom.pricePane.clientHeight);
    }
    if (dom.rsiPane.clientWidth > 0 && dom.rsiPane.clientHeight > 0) {
      charts.rsi.resize(dom.rsiPane.clientWidth, dom.rsiPane.clientHeight);
    }
    if (dom.macdPane.clientWidth > 0 && dom.macdPane.clientHeight > 0) {
      charts.macd.resize(dom.macdPane.clientWidth, dom.macdPane.clientHeight);
    }
  }

  function updatePaneVisibility() {
    if (isMultiMode()) {
      return;
    }

    dom.pricePane.style.display = "block";
    dom.rsiPane.style.display = state.indicators.rsi ? "block" : "none";
    dom.macdPane.style.display = state.indicators.macd ? "block" : "none";
    dom.indicatorSwitches.style.display = "flex";
    dom.aiTimeframes.style.display = "grid";
    dom.aiStatus.parentElement.style.display = "flex";

    const isPhone = window.matchMedia("(max-width: 900px)").matches;
    const isCompact = window.matchMedia("(max-width: 1180px)").matches;
    const mainMin = isPhone ? 220 : isCompact ? 240 : 280;
    const rsiHeight = isPhone ? 100 : isCompact ? 115 : 130;
    const macdHeight = isPhone ? 115 : isCompact ? 130 : 150;

    const rows = ["auto", "auto", "auto", "auto", `minmax(${mainMin}px, 1fr)`];
    if (state.indicators.rsi) {
      rows.push(`${rsiHeight}px`);
    }
    if (state.indicators.macd) {
      rows.push(`${macdHeight}px`);
    }
    dom.chartZone.style.gridTemplateRows = rows.join(" ");

    requestAnimationFrame(resizeCharts);
  }

  async function loadMarket() {
    const symbol = sanitizeSymbol(dom.symbolInput.value) || state.symbol;
    state.symbol = symbol;
    dom.symbolInput.value = symbol;

    dom.marketTitle.textContent = `${state.symbol} • ${state.interval}`;
    state.ai.data = null;
    state.ai.nonce += 1;
    state.ai.loading = false;
    clearAiTimer();
    clearAiOverlays();
    renderAiCards();
    setAiStatus("neutral", "AI queued");

    const nonce = ++state.streamNonce;
    closeAllSockets();
    setStatus("neutral", "Loading");

    try {
      const [candles, depth, trades, ticker] = await Promise.all([
        fetchJson(`${REST_BASE}/klines?symbol=${state.symbol}&interval=${state.interval}&limit=${MAX_CANDLES}`),
        fetchJson(`${REST_BASE}/depth?symbol=${state.symbol}&limit=20`),
        fetchJson(`${REST_BASE}/trades?symbol=${state.symbol}&limit=60`),
        fetchJson(`${REST_BASE}/ticker/24hr?symbol=${state.symbol}`)
      ]);

      if (nonce !== state.streamNonce) {
        return;
      }

      state.candles = candles.map(toCandle).filter(Boolean);
      state.candleMap = new Map(state.candles.map((c) => [c.time, c]));
      state.depth = {
        bids: (depth.bids || []).map(([p, q]) => [Number(p), Number(q)]),
        asks: (depth.asks || []).map(([p, q]) => [Number(p), Number(q)])
      };
      state.trades = trades
        .map((t) => ({
          time: t.time,
          price: Number(t.price),
          qty: Number(t.qty),
          isBuyerMaker: Boolean(t.isBuyerMaker)
        }))
        .reverse();

      renderAll();
      resetPriceScaleToSymbolRange();
      renderOrderBook();
      renderTrades();

      const last = state.candles[state.candles.length - 1];
      const changePct = Number(ticker.priceChangePercent);
      const lastPriceText = last ? formatPrice(last.close) : "--";
      const pctText = Number.isFinite(changePct) ? `${changePct.toFixed(2)}%` : "--";
      dom.marketTitle.textContent = `${state.symbol} • ${state.interval} • ${lastPriceText} (${pctText})`;

      openSymbolStreams(nonce);
      startLivePolling();
      setStatus("connected", "Live");
      scheduleAiAnalysis(350);
    } catch (error) {
      setStatus("disconnected", "Load failed");
      dom.ohlcRow.textContent = "Unable to load symbol/interval from Binance.";
      dom.orderbook.innerHTML = `<div class=\"muted\">No order book data</div>`;
      dom.trades.innerHTML = `<div class=\"muted\">No trade data</div>`;
      setAiStatus("error", "AI waiting for market");
    }
  }

  function renderAll() {
    if (isMultiMode()) {
      return;
    }
    renderPriceSeries();
    renderIndicators();
    updateOhlcFromLast();
    charts.price.timeScale().fitContent();
    charts.rsi.timeScale().fitContent();
    charts.macd.timeScale().fitContent();
    applyAiForCurrentInterval();
  }

  function renderPriceSeries() {
    const closeData = state.candles.map((candle) => ({ time: candle.time, value: candle.close }));

    series.candles.setData(state.chartType === "candles" ? state.candles : []);
    series.line.setData(state.chartType === "line" ? closeData : []);
    series.area.setData(state.chartType === "area" ? closeData : []);

    if (state.chartType === "baseline") {
      const base = state.candles[0]?.close || 0;
      series.baseline.applyOptions({ baseValue: { type: "price", price: base } });
      series.baseline.setData(closeData);
    } else {
      series.baseline.setData([]);
    }
  }

  function resetPriceScaleToSymbolRange() {
    if (!state.candles.length) {
      return;
    }

    const scale = charts.price.priceScale("right");
    if (!scale) {
      return;
    }

    const low = Math.min(...state.candles.map((candle) => candle.low));
    const high = Math.max(...state.candles.map((candle) => candle.high));

    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      return;
    }

    const span = Math.max(high - low, 0);
    const pad = span > 0 ? span * 0.08 : Math.max(Math.abs(high) * 0.01, 0.01);
    const from = low - pad;
    const to = high + pad;

    requestAnimationFrame(() => {
      if (typeof scale.setAutoScale === "function") {
        scale.setAutoScale(false);
      } else {
        scale.applyOptions({ autoScale: false });
      }

      if (typeof scale.setVisibleRange === "function") {
        scale.setVisibleRange({ from, to });
      }

      if (typeof scale.setAutoScale === "function") {
        scale.setAutoScale(true);
      } else {
        scale.applyOptions({ autoScale: true });
      }

      charts.price.timeScale().fitContent();
      charts.rsi.timeScale().fitContent();
      charts.macd.timeScale().fitContent();
    });
  }

  function renderIndicators() {
    const palette = getPalette();

    if (state.indicators.volume) {
      series.volume.setData(
        state.candles.map((candle) => ({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? colorWithAlpha(palette.up, 0.82) : colorWithAlpha(palette.down, 0.82)
        }))
      );
    } else {
      series.volume.setData([]);
    }

    if (state.indicators.sma) {
      series.sma.setData(calcSma(state.candles, 20));
    } else {
      series.sma.setData([]);
    }

    if (state.indicators.ema) {
      series.ema.setData(calcEma(state.candles, 50));
    } else {
      series.ema.setData([]);
    }

    if (state.indicators.bb) {
      const bands = calcBollinger(state.candles, 20, 2);
      series.bbUpper.setData(bands.upper);
      series.bbLower.setData(bands.lower);
      series.bbMiddle.setData(bands.middle);
    } else {
      series.bbUpper.setData([]);
      series.bbLower.setData([]);
      series.bbMiddle.setData([]);
    }

    if (state.indicators.rsi) {
      const rsi = calcRsi(state.candles, 14);
      series.rsi.setData(rsi);
      series.rsiUpper.setData(state.candles.map((c) => ({ time: c.time, value: 70 })));
      series.rsiLower.setData(state.candles.map((c) => ({ time: c.time, value: 30 })));
      applyRsiFixedScale();
    } else {
      series.rsi.setData([]);
      series.rsiUpper.setData([]);
      series.rsiLower.setData([]);
    }

    if (state.indicators.macd) {
      const macd = calcMacd(state.candles, 12, 26, 9);
      series.macdLine.setData(macd.macd);
      series.macdSignal.setData(macd.signal);
      series.macdHist.setData(
        macd.hist.map((point) => ({
          time: point.time,
          value: point.value,
          color: point.value >= 0 ? palette.pos : palette.neg
        }))
      );
    } else {
      series.macdLine.setData([]);
      series.macdSignal.setData([]);
      series.macdHist.setData([]);
    }
  }

  function applyThemeToCharts() {
    const palette = getPalette();

    charts.price.applyOptions(buildPriceChartOptions(palette));
    charts.rsi.applyOptions(buildSubChartOptions(palette));
    charts.macd.applyOptions(buildSubChartOptions(palette));

    series.candles.applyOptions(candleSeriesOptions(palette));
    series.line.applyOptions({ color: palette.aux1 });
    series.area.applyOptions({
      lineColor: palette.aux1,
      topColor: colorWithAlpha(palette.aux1, 0.35),
      bottomColor: colorWithAlpha(palette.aux1, 0.03)
    });

    series.baseline.applyOptions({
      topLineColor: palette.up,
      bottomLineColor: palette.down,
      topFillColor1: colorWithAlpha(palette.up, 0.28),
      topFillColor2: colorWithAlpha(palette.up, 0.03),
      bottomFillColor1: colorWithAlpha(palette.down, 0.23),
      bottomFillColor2: colorWithAlpha(palette.down, 0.03)
    });

    series.sma.applyOptions({ color: palette.accent });
    series.ema.applyOptions({ color: palette.aux2 });
    series.bbUpper.applyOptions({ color: colorWithAlpha(palette.aux3, 0.95) });
    series.bbLower.applyOptions({ color: colorWithAlpha(palette.aux3, 0.95) });
    series.bbMiddle.applyOptions({ color: colorWithAlpha(palette.aux3, 0.95) });
    series.rsi.applyOptions({ color: palette.aux1 });
    series.rsiUpper.applyOptions({ color: colorWithAlpha(palette.down, 0.9) });
    series.rsiLower.applyOptions({ color: colorWithAlpha(palette.up, 0.9) });
    applyRsiFixedScale();
    series.macdLine.applyOptions({ color: palette.aux1 });
    series.macdSignal.applyOptions({ color: palette.warn });
  }

  function applyRsiFixedScale() {
    if (!charts.rsi || !series.rsi || !series.rsiUpper || !series.rsiLower) {
      return;
    }

    const fixedRange = () => ({
      priceRange: { minValue: 0, maxValue: 100 }
    });

    series.rsi.applyOptions({ autoscaleInfoProvider: fixedRange });
    series.rsiUpper.applyOptions({ autoscaleInfoProvider: fixedRange });
    series.rsiLower.applyOptions({ autoscaleInfoProvider: fixedRange });

    charts.rsi.priceScale("right").applyOptions({
      autoScale: true,
      mode: LightweightCharts.PriceScaleMode.Normal,
      scaleMargins: { top: 0.14, bottom: 0.14 }
    });
  }

  function scheduleAiAnalysis(delayMs = AI_REFRESH_DELAY_MS) {
    if (!state.ai.enabled || !state.ai.auto) {
      return;
    }

    clearAiTimer();
    state.ai.timer = setTimeout(() => {
      if (isMultiMode()) {
        runMultiAiAnalysis(false);
        return;
      }
      runAiAnalysis(false);
    }, delayMs);
  }

  function clearAiTimer() {
    if (!state.ai.timer) {
      return;
    }
    clearTimeout(state.ai.timer);
    state.ai.timer = null;
  }

  async function runAiAnalysis(force = false) {
    if (isMultiMode()) {
      await runMultiAiAnalysis(force);
      return;
    }

    if (!state.ai.enabled || state.ai.loading) {
      return;
    }

    const now = Date.now();
    if (!force && now - state.ai.lastRunAt < AI_MIN_REFRESH_MS) {
      return;
    }

    state.ai.loading = true;
    const nonce = ++state.ai.nonce;
    setAiStatus("neutral", "AI analyzing");

    try {
      const payload = await fetchAiPayload(state.symbol, state.interval);
      if (nonce !== state.ai.nonce) {
        return;
      }

      state.ai.data = payload;
      state.ai.lastRunAt = Date.now();

      const provider = payload.model?.provider === "gemini" ? "Gemini" : "Rules";
      setAiStatus("ready", `${provider} ${new Date().toLocaleTimeString()}`);
      renderAiCards();
      applyAiForCurrentInterval();
    } catch (error) {
      if (nonce !== state.ai.nonce) {
        return;
      }
      const label = String(error?.message || "AI unavailable").slice(0, 62);
      setAiStatus("error", label || "AI unavailable");
      // eslint-disable-next-line no-console
      console.error("AI analysis failed:", error);
    } finally {
      if (nonce !== state.ai.nonce) {
        return;
      }
      state.ai.loading = false;
      if (state.ai.auto && !isMultiMode()) {
        scheduleAiAnalysis(AI_MIN_REFRESH_MS);
      }
    }
  }

  async function runMultiAiAnalysis(force = false) {
    if (!isMultiMode() || !state.ai.enabled) {
      return;
    }

    if (state.ai.multiLoading) {
      return;
    }

    const now = Date.now();
    if (!force && now - state.ai.lastMultiRunAt < AI_MIN_REFRESH_MS) {
      return;
    }

    const slots = state.multiCharts.filter((slot) => slot?.chart && slot?.candles?.length);
    if (!slots.length) {
      return;
    }

    state.ai.multiLoading = true;
    state.ai.lastMultiRunAt = now;

    try {
      await Promise.allSettled(
        slots.map((slot) => runAiForMultiSlot(slot, force))
      );
    } finally {
      state.ai.multiLoading = false;
      if (state.ai.auto && isMultiMode()) {
        scheduleAiAnalysis(AI_MIN_REFRESH_MS);
      }
    }
  }

  async function fetchAiPayload(symbol, interval) {
    const headers = {};
    if (state.ai.apiKey) {
      headers[AI_KEY_HEADER] = state.ai.apiKey;
    }

    const response = await fetch(`/api/ai/analyze?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`, {
      headers
    });
    if (!response.ok) {
      throw new Error(await readAiErrorMessage(response));
    }

    const payload = await response.json();
    if (!payload?.ok || !payload?.analyses) {
      throw new Error("Invalid AI payload");
    }
    return payload;
  }

  async function readAiErrorMessage(response) {
    let message = `AI request failed (${response.status})`;
    try {
      const errorPayload = await response.json();
      if (errorPayload?.error) {
        message = `AI ${response.status}: ${errorPayload.error}`;
      }
    } catch {
      // Ignore non-JSON errors.
    }
    return message;
  }

  function setAiStatus(kind, label) {
    dom.aiStatus.className = `ai-status ${kind}`;
    dom.aiStatus.textContent = label;
  }

  async function runAiForMultiSlot(slot, force = false) {
    if (!slot?.chart || !slot?.candles?.length || !isMultiMode()) {
      return false;
    }

    if (slot.ai.loading) {
      return false;
    }

    const now = Date.now();
    if (!force && now - slot.ai.lastRunAt < AI_MIN_REFRESH_MS) {
      return false;
    }

    slot.ai.loading = true;
    const nonce = ++slot.ai.nonce;
    setMultiAiStatus(slot, "neutral", "AI...");

    try {
      const payload = await fetchAiPayload(slot.symbol, state.interval);
      if (nonce !== slot.ai.nonce || !isMultiMode()) {
        return false;
      }

      slot.ai.data = payload;
      slot.ai.lastRunAt = Date.now();
      applyAiForMultiSlotCurrentInterval(slot);
      updateMultiAiSummary(slot);

      const provider = payload.model?.provider === "gemini" ? "Gemini" : "Rules";
      setMultiAiStatus(slot, "ready", `${provider}`);
      return true;
    } catch (error) {
      if (nonce !== slot.ai.nonce) {
        return false;
      }
      clearMultiAiOverlays(slot);
      updateMultiAiSummary(slot);
      setMultiAiStatus(slot, "error", "AI err");
      // eslint-disable-next-line no-console
      console.error(`Multi AI failed for ${slot.symbol}:`, error);
      return false;
    } finally {
      if (nonce === slot.ai.nonce) {
        slot.ai.loading = false;
      }
    }
  }

  function setMultiAiStatus(slot, kind, label) {
    if (!slot?.aiStatusNode) {
      return;
    }
    slot.aiStatusNode.className = `multi-ai-status ${kind}`;
    slot.aiStatusNode.textContent = label;
  }

  function updateMultiAiSummary(slot) {
    if (!slot?.aiLevelsNode || !slot?.aiTimeframesNode) {
      return;
    }

    const current = slot.ai?.data?.analyses?.[state.interval];
    const support = Number(current?.support?.[0]?.price);
    const resistance = Number(current?.resistance?.[0]?.price);
    const confidence = Math.round((Number(current?.confidence) || 0) * 100);

    if (current) {
      slot.aiLevelsNode.textContent = `S ${formatPrice(support)} • R ${formatPrice(resistance)} • ${confidence}%`;
    } else {
      slot.aiLevelsNode.textContent = "S -- • R --";
    }

    slot.aiTimeframesNode.innerHTML = AI_TIMEFRAMES.map((timeframe) => {
      const item = slot.ai?.data?.analyses?.[timeframe];
      const bias = item?.bias || "neutral";
      const active = timeframe === state.interval ? "active" : "";
      const short = bias === "bullish" ? "B" : bias === "bearish" ? "S" : "N";
      return `<span class="multi-ai-pill ${bias} ${active}">${timeframe} ${short}</span>`;
    }).join("");
  }

  function applyAiForMultiSlotCurrentInterval(slot) {
    clearMultiAiOverlays(slot);

    const timeframe = slot.ai?.data?.analyses?.[state.interval];
    if (!timeframe || !slot.candles.length) {
      return;
    }

    const palette = getPalette();
    const firstTime = slot.candles[0].time;
    const lastTime = slot.candles[slot.candles.length - 1].time;

    const trendLines = timeframe.trendLines || [];
    for (const line of trendLines.slice(0, 4)) {
      const fromTime = nearestMultiCandleTime(slot, line.fromTime);
      const toTime = nearestMultiCandleTime(slot, line.toTime);
      const fromPrice = Number(line.fromPrice);
      const toPrice = Number(line.toPrice);
      if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || !Number.isFinite(fromPrice) || !Number.isFinite(toPrice)) {
        continue;
      }

      const trendSeries = slot.chart.addLineSeries({
        color: line.label === "downtrend" ? colorWithAlpha(palette.down, 0.92) : colorWithAlpha(palette.up, 0.92),
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false
      });
      trendSeries.setData([
        { time: fromTime, value: fromPrice },
        { time: toTime, value: toPrice }
      ]);
      slot.ai.overlaySeries.push(trendSeries);
    }

    const supportLevels = timeframe.support || [];
    for (const level of supportLevels.slice(0, 3)) {
      const price = Number(level.price);
      if (!Number.isFinite(price)) {
        continue;
      }
      const supportSeries = slot.chart.addLineSeries({
        color: colorWithAlpha(palette.up, 0.7),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false
      });
      supportSeries.setData([
        { time: firstTime, value: price },
        { time: lastTime, value: price }
      ]);
      slot.ai.overlaySeries.push(supportSeries);
    }

    const resistanceLevels = timeframe.resistance || [];
    for (const level of resistanceLevels.slice(0, 3)) {
      const price = Number(level.price);
      if (!Number.isFinite(price)) {
        continue;
      }
      const resistanceSeries = slot.chart.addLineSeries({
        color: colorWithAlpha(palette.down, 0.7),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false
      });
      resistanceSeries.setData([
        { time: firstTime, value: price },
        { time: lastTime, value: price }
      ]);
      slot.ai.overlaySeries.push(resistanceSeries);
    }

    const buyPoints = timeframe.buyPoints || [];
    for (const point of buyPoints.slice(0, 3)) {
      const price = Number(point.price);
      if (!Number.isFinite(price)) {
        continue;
      }
      const buyZone = slot.chart.addLineSeries({
        color: colorWithAlpha(palette.up, 0.46),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.SparseDotted,
        lastValueVisible: false,
        priceLineVisible: false
      });
      buyZone.setData([
        { time: firstTime, value: price },
        { time: lastTime, value: price }
      ]);
      slot.ai.overlaySeries.push(buyZone);
    }

    const sellPoints = timeframe.sellPoints || [];
    for (const point of sellPoints.slice(0, 3)) {
      const price = Number(point.price);
      if (!Number.isFinite(price)) {
        continue;
      }
      const sellZone = slot.chart.addLineSeries({
        color: colorWithAlpha(palette.down, 0.46),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.SparseDotted,
        lastValueVisible: false,
        priceLineVisible: false
      });
      sellZone.setData([
        { time: firstTime, value: price },
        { time: lastTime, value: price }
      ]);
      slot.ai.overlaySeries.push(sellZone);
    }

    const markers = [];
    for (const point of buyPoints.slice(0, 6)) {
      const markerTime = nearestMultiCandleTime(slot, point.time);
      const confidence = Math.round((Number(point.confidence) || 0) * 100);
      if (!Number.isFinite(markerTime)) {
        continue;
      }
      markers.push({
        time: markerTime,
        position: "belowBar",
        color: palette.up,
        shape: "arrowUp",
        text: `B ${confidence}%`
      });
    }

    for (const point of sellPoints.slice(0, 6)) {
      const markerTime = nearestMultiCandleTime(slot, point.time);
      const confidence = Math.round((Number(point.confidence) || 0) * 100);
      if (!Number.isFinite(markerTime)) {
        continue;
      }
      markers.push({
        time: markerTime,
        position: "aboveBar",
        color: palette.down,
        shape: "arrowDown",
        text: `S ${confidence}%`
      });
    }

    applyAiMarkersToSeries(slot.series, slot.ai, markers);
  }

  function clearMultiAiOverlays(slot) {
    if (!slot?.chart || !slot?.ai) {
      return;
    }

    for (const overlay of slot.ai.overlaySeries) {
      try {
        slot.chart.removeSeries(overlay);
      } catch {
        // Ignore if series already removed.
      }
    }
    slot.ai.overlaySeries = [];
    applyAiMarkersToSeries(slot.series, slot.ai, []);
  }

  function nearestMultiCandleTime(slot, rawTime) {
    const target = normalizeTime(rawTime);
    if (!Number.isFinite(target) || !slot?.candles?.length) {
      return NaN;
    }

    let nearest = slot.candles[0].time;
    let nearestDiff = Math.abs(nearest - target);
    for (const candle of slot.candles) {
      const diff = Math.abs(candle.time - target);
      if (diff < nearestDiff) {
        nearest = candle.time;
        nearestDiff = diff;
      }
    }
    return nearest;
  }

  function renderAiCards() {
    const analyses = state.ai.data?.analyses || {};
    const cards = AI_TIMEFRAMES.map((timeframe) => {
      const item = analyses[timeframe];
      const active = timeframe === state.interval ? "active" : "";

      if (!item) {
        return `<article class="ai-card ${active}"><div class="ai-card-head"><strong>${timeframe}</strong><span class="ai-card-bias neutral">--</span></div><div class="ai-card-levels">Waiting for AI data</div></article>`;
      }

      const support = item.support?.[0]?.price;
      const resistance = item.resistance?.[0]?.price;
      const confidence = Math.round((Number(item.confidence) || 0) * 100);
      const bias = item.bias || "neutral";

      return `<article class="ai-card ${active}"><div class="ai-card-head"><strong>${timeframe}</strong><span class="ai-card-bias ${bias}">${bias}</span></div><div class="ai-card-levels">S ${formatPrice(
        Number(support)
      )} • R ${formatPrice(Number(resistance))} • C ${confidence}%</div></article>`;
    });

    dom.aiTimeframes.innerHTML = cards.join("");
  }

  function applyAiForCurrentInterval() {
    clearAiOverlays();

    if (isMultiMode()) {
      return;
    }

    const timeframe = state.ai.data?.analyses?.[state.interval];
    if (!timeframe || !state.candles.length) {
      return;
    }

    const palette = getPalette();
    const firstTime = state.candles[0].time;
    const lastTime = state.candles[state.candles.length - 1].time;

    const trendLines = timeframe.trendLines || [];
    for (const line of trendLines) {
      const fromTime = nearestCandleTime(line.fromTime);
      const toTime = nearestCandleTime(line.toTime);
      const fromPrice = Number(line.fromPrice);
      const toPrice = Number(line.toPrice);
      if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || !Number.isFinite(fromPrice) || !Number.isFinite(toPrice)) {
        continue;
      }

      const trendSeries = charts.price.addLineSeries({
        color: line.label === "downtrend" ? colorWithAlpha(palette.down, 0.95) : colorWithAlpha(palette.up, 0.95),
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false
      });
      trendSeries.setData([
        { time: fromTime, value: fromPrice },
        { time: toTime, value: toPrice }
      ]);
      state.ai.overlaySeries.push(trendSeries);
    }

    const supportLevels = timeframe.support || [];
    for (const level of supportLevels.slice(0, 4)) {
      const price = Number(level.price);
      if (!Number.isFinite(price)) {
        continue;
      }
      const supportSeries = charts.price.addLineSeries({
        color: colorWithAlpha(palette.up, 0.72),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false
      });
      supportSeries.setData([
        { time: firstTime, value: price },
        { time: lastTime, value: price }
      ]);
      state.ai.overlaySeries.push(supportSeries);
    }

    const resistanceLevels = timeframe.resistance || [];
    for (const level of resistanceLevels.slice(0, 4)) {
      const price = Number(level.price);
      if (!Number.isFinite(price)) {
        continue;
      }
      const resistanceSeries = charts.price.addLineSeries({
        color: colorWithAlpha(palette.down, 0.72),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false
      });
      resistanceSeries.setData([
        { time: firstTime, value: price },
        { time: lastTime, value: price }
      ]);
      state.ai.overlaySeries.push(resistanceSeries);
    }

    const markers = [];
    const buyPoints = timeframe.buyPoints || [];
    for (const point of buyPoints.slice(0, 6)) {
      const markerTime = nearestCandleTime(point.time);
      const confidence = Math.round((Number(point.confidence) || 0) * 100);
      if (!Number.isFinite(markerTime)) {
        continue;
      }
      markers.push({
        time: markerTime,
        position: "belowBar",
        color: palette.up,
        shape: "arrowUp",
        text: `BUY ${confidence}%`
      });
    }

    const sellPoints = timeframe.sellPoints || [];
    for (const point of sellPoints.slice(0, 6)) {
      const markerTime = nearestCandleTime(point.time);
      const confidence = Math.round((Number(point.confidence) || 0) * 100);
      if (!Number.isFinite(markerTime)) {
        continue;
      }
      markers.push({
        time: markerTime,
        position: "aboveBar",
        color: palette.down,
        shape: "arrowDown",
        text: `SELL ${confidence}%`
      });
    }

    applyAiMarkers(markers);
  }

  function clearAiOverlays() {
    if (!charts.price) {
      return;
    }

    for (const overlay of state.ai.overlaySeries) {
      try {
        charts.price.removeSeries(overlay);
      } catch {
        // Ignore if series already removed.
      }
    }
    state.ai.overlaySeries = [];
    applyAiMarkersToSeries(series.candles, state.ai, []);
  }

  function applyAiMarkers(markers) {
    applyAiMarkersToSeries(series.candles, state.ai, markers);
  }

  function applyAiMarkersToSeries(targetSeries, markerStore, markers) {
    if (!targetSeries || !markerStore) {
      return;
    }

    if (typeof targetSeries.setMarkers === "function") {
      targetSeries.setMarkers(markers);
      return;
    }

    if (typeof LightweightCharts.createSeriesMarkers === "function") {
      if (!markerStore.markerApi) {
        markerStore.markerApi = LightweightCharts.createSeriesMarkers(targetSeries, markers);
        return;
      }
      if (typeof markerStore.markerApi.setMarkers === "function") {
        markerStore.markerApi.setMarkers(markers);
      }
    }
  }

  function nearestCandleTime(rawTime) {
    const target = normalizeTime(rawTime);
    if (!Number.isFinite(target) || !state.candles.length) {
      return NaN;
    }

    if (state.candleMap.has(target)) {
      return target;
    }

    let nearest = state.candles[0].time;
    let nearestDiff = Math.abs(nearest - target);
    for (const candle of state.candles) {
      const diff = Math.abs(candle.time - target);
      if (diff < nearestDiff) {
        nearest = candle.time;
        nearestDiff = diff;
      }
    }
    return nearest;
  }

  function loadMultiLayouts() {
    const fallback = {
      1: MULTI_LAYOUT_DEFAULTS[1],
      2: MULTI_LAYOUT_DEFAULTS[2],
      3: MULTI_LAYOUT_DEFAULTS[3],
      4: MULTI_LAYOUT_DEFAULTS[4]
    };

    const raw = localStorage.getItem(MULTI_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return fallback;
      }

      for (const count of [1, 2, 3, 4]) {
        fallback[count] = normalizeLayoutPreset(count, parsed[count]);
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  function ensureMultiLayoutDefaults() {
    if (!state.multiLayouts || typeof state.multiLayouts !== "object") {
      state.multiLayouts = loadMultiLayouts();
      persistMultiLayouts();
      return;
    }

    for (const count of [1, 2, 3, 4]) {
      state.multiLayouts[count] = normalizeLayoutPreset(count, state.multiLayouts[count]);
    }
    persistMultiLayouts();
  }

  function normalizeLayoutPreset(count, layout) {
    const allowed = MULTI_LAYOUT_PRESETS[count];
    if (!allowed || !allowed.length) {
      return MULTI_LAYOUT_DEFAULTS[1];
    }

    if (typeof layout === "string" && allowed.includes(layout)) {
      return layout;
    }
    return MULTI_LAYOUT_DEFAULTS[count];
  }

  function resolveLayoutForCount(count) {
    return normalizeLayoutPreset(count, state.multiLayouts[count]);
  }

  function persistMultiLayouts() {
    localStorage.setItem(MULTI_LAYOUT_STORAGE_KEY, JSON.stringify(state.multiLayouts));
  }

  function setMultiLayoutPreset(count, layout) {
    if (!Number.isInteger(count) || count < 1 || count > 4) {
      return;
    }

    state.multiLayouts[count] = normalizeLayoutPreset(count, layout);
    persistMultiLayouts();
    updateLayoutMenuState();
    if (state.multiCount === count) {
      applyMultiLayoutToGrid();
    }
  }

  function applyMultiLayoutToGrid() {
    const layout = resolveLayoutForCount(state.multiCount);
    dom.multiGrid.dataset.layout = layout;
  }

  function updateLayoutMenuState() {
    const activeLayout = resolveLayoutForCount(state.multiCount);
    dom.layoutOptions.forEach((option) => {
      const count = Number(option.dataset.count);
      const layout = option.dataset.layout;
      option.classList.toggle("active", count === state.multiCount && layout === activeLayout);
    });
  }

  function openLayoutMenu() {
    updateLayoutMenuState();
    dom.layoutMenuPanel.hidden = false;
    dom.layoutMenuToggle.setAttribute("aria-expanded", "true");
  }

  function closeLayoutMenu() {
    dom.layoutMenuPanel.hidden = true;
    dom.layoutMenuToggle.setAttribute("aria-expanded", "false");
  }

  function isMultiMode() {
    return state.multiCount > 1;
  }

  function setViewMode(nextCount, isInitial = false) {
    const normalized = Number.isInteger(nextCount) && nextCount >= 1 && nextCount <= 4 ? nextCount : 1;
    state.multiCount = normalized;
    localStorage.setItem("bitcharts-multi-count", String(state.multiCount));
    dom.multiCount.value = String(state.multiCount);
    applyMultiLayoutToGrid();
    updateLayoutMenuState();

    const multi = isMultiMode();
    dom.layout.classList.toggle("multi-view", multi);
    dom.chartZone.classList.toggle("multi-view", multi);
    dom.multiGrid.hidden = !multi;
    dom.aiRefreshBtn.disabled = false;

    if (multi) {
      closeAllSockets();
      dom.chartZone.style.gridTemplateRows = "auto minmax(0, 1fr)";
      dom.indicatorSwitches.style.display = "none";
      dom.aiStatus.parentElement.style.display = "none";
      dom.aiTimeframes.style.display = "none";
      dom.pricePane.style.display = "none";
      dom.rsiPane.style.display = "none";
      dom.macdPane.style.display = "none";
      clearAiTimer();
      clearAiOverlays();
      buildMultiCharts();
      if (state.ai.auto) {
        scheduleAiAnalysis(450);
      }
      setStatus("neutral", `${state.multiCount} Charts`);
    } else {
      state.ai.multiLoading = false;
      dom.chartZone.style.removeProperty("grid-template-rows");
      destroyMultiCharts();
      updatePaneVisibility();
      loadMarket();
      renderAiCards();
    }

    if (!isInitial) {
      requestAnimationFrame(() => {
        resizeCharts();
        resizeMultiCharts();
        requestAnimationFrame(resizeMultiCharts);
      });
    }
  }

  function buildMultiCharts() {
    const symbols = resolveMultiSymbols(state.multiCount);
    destroyMultiCharts();

    dom.multiGrid.dataset.count = String(state.multiCount);
    applyMultiLayoutToGrid();
    dom.multiGrid.innerHTML = symbols
      .map(
        (symbol, index) => `
          <article class="multi-card" data-slot="${index}">
            <div class="multi-card-head">
              <input class="multi-symbol" type="text" value="${symbol}" spellcheck="false" autocomplete="off" />
              <span class="multi-status">Loading</span>
            </div>
            <div class="multi-ai-head">
              <span class="multi-ai-status neutral">AI idle</span>
              <span class="multi-ai-levels">S -- • R --</span>
            </div>
            <div class="multi-ai-timeframes"></div>
            <div class="multi-chart"></div>
          </article>
        `
      )
      .join("");

    const palette = getPalette();
    const cards = Array.from(dom.multiGrid.querySelectorAll(".multi-card"));
    state.multiCharts = cards.map((card, index) => {
      const symbolInput = card.querySelector(".multi-symbol");
      const statusNode = card.querySelector(".multi-status");
      const aiStatusNode = card.querySelector(".multi-ai-status");
      const aiLevelsNode = card.querySelector(".multi-ai-levels");
      const aiTimeframesNode = card.querySelector(".multi-ai-timeframes");
      const chartNode = card.querySelector(".multi-chart");

      const chart = LightweightCharts.createChart(chartNode, buildPriceChartOptions(palette));
      const candleSeries = chart.addCandlestickSeries(candleSeriesOptions(palette));
      chart.timeScale().applyOptions({ rightOffset: 3 });

      const slot = {
        index,
        symbol: sanitizeSymbol(symbolInput.value) || MULTI_DEFAULT_SYMBOLS[index] || "BTCUSDT",
        candles: [],
        chart,
        series: candleSeries,
        chartNode,
        symbolInput,
        statusNode,
        aiStatusNode,
        aiLevelsNode,
        aiTimeframesNode,
        ws: null,
        reconnectTimer: null,
        nonce: 0,
        ai: {
          loading: false,
          lastRunAt: 0,
          nonce: 0,
          data: null,
          overlaySeries: [],
          markerApi: null
        }
      };

      setMultiAiStatus(slot, "neutral", "AI idle");
      updateMultiAiSummary(slot);

      symbolInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        const nextSymbol = sanitizeSymbol(symbolInput.value);
        if (!nextSymbol) {
          return;
        }

        slot.symbol = nextSymbol;
        symbolInput.value = nextSymbol;

        if (slot.index === 0) {
          state.symbol = nextSymbol;
          dom.symbolInput.value = nextSymbol;
        }

        loadMultiSlot(slot);
      });

      return slot;
    });

    state.multiCharts.forEach((slot) => loadMultiSlot(slot));
    requestAnimationFrame(() => {
      resizeMultiCharts();
      requestAnimationFrame(resizeMultiCharts);
    });
  }

  function resolveMultiSymbols(count) {
    const primary = sanitizeSymbol(dom.symbolInput.value) || state.symbol;
    const existing = state.multiCharts.map((slot) => slot.symbol).filter(Boolean);
    const seed = [primary, ...existing, ...MULTI_DEFAULT_SYMBOLS];
    const symbols = [];

    for (const candidate of seed) {
      const symbol = sanitizeSymbol(candidate);
      if (!symbol) {
        continue;
      }
      if (symbols.includes(symbol)) {
        continue;
      }
      symbols.push(symbol);
      if (symbols.length === count) {
        break;
      }
    }

    while (symbols.length < count) {
      symbols.push(MULTI_DEFAULT_SYMBOLS[symbols.length % MULTI_DEFAULT_SYMBOLS.length]);
    }

    return symbols;
  }

  function updatePrimaryMultiSymbol(symbol) {
    if (!isMultiMode() || !state.multiCharts.length) {
      return;
    }
    const slot = state.multiCharts[0];
    slot.symbol = symbol;
    slot.symbolInput.value = symbol;
    loadMultiSlot(slot);
  }

  function reloadMultiCharts() {
    if (!isMultiMode()) {
      return;
    }
    state.multiCharts.forEach((slot) => loadMultiSlot(slot));
  }

  async function loadMultiSlot(slot) {
    if (!isMultiMode()) {
      return;
    }

    const symbol = sanitizeSymbol(slot.symbolInput.value) || slot.symbol;
    slot.symbol = symbol;
    slot.symbolInput.value = symbol;

    const nonce = ++slot.nonce;
    closeMultiSlotSocket(slot);
    slot.ai.nonce += 1;
    slot.ai.data = null;
    clearMultiAiOverlays(slot);
    updateMultiAiSummary(slot);
    setMultiAiStatus(slot, "neutral", "AI idle");
    slot.statusNode.textContent = "Loading";

    try {
      const candles = await fetchJson(`${REST_BASE}/klines?symbol=${slot.symbol}&interval=${state.interval}&limit=${MAX_CANDLES}`);
      if (nonce !== slot.nonce || !isMultiMode()) {
        return;
      }

      slot.candles = candles.map(toCandle).filter(Boolean);
      slot.series.setData(slot.candles);
      slot.chart.timeScale().fitContent();

      const last = slot.candles[slot.candles.length - 1];
      slot.statusNode.textContent = last ? `${formatPrice(last.close)} • ${state.interval}` : `No data • ${state.interval}`;
      runAiForMultiSlot(slot, true);
      openMultiSlotSocket(slot, nonce);
    } catch {
      if (nonce !== slot.nonce) {
        return;
      }
      slot.statusNode.textContent = "Load failed";
      setMultiAiStatus(slot, "error", "AI wait");
    }
  }

  function openMultiSlotSocket(slot, nonce) {
    const stream = `${slot.symbol.toLowerCase()}@kline_${state.interval}`;
    const ws = new WebSocket(`${WS_BASE}/${stream}`);
    slot.ws = ws;

    ws.addEventListener("open", () => {
      if (slot.nonce !== nonce) {
        return;
      }
      slot.statusNode.textContent = `Live • ${state.interval}`;
    });

    ws.addEventListener("message", (event) => {
      if (slot.nonce !== nonce) {
        return;
      }

      try {
        const payload = JSON.parse(event.data);
        const kline = payload.k;
        if (!kline) {
          return;
        }

        const candle = {
          time: Math.floor(Number(kline.t) / 1000),
          open: Number(kline.o),
          high: Number(kline.h),
          low: Number(kline.l),
          close: Number(kline.c),
          volume: Number(kline.v)
        };

        upsertMultiSlotCandle(slot, candle);
        slot.series.update(candle);
        if (kline.x && state.ai.auto) {
          scheduleAiAnalysis(220);
        }
      } catch {
        // Ignore malformed payloads.
      }
    });

    ws.addEventListener("error", () => {
      ws.close();
    });

    ws.addEventListener("close", () => {
      if (slot.ws === ws) {
        slot.ws = null;
      }

      if (slot.nonce !== nonce || !isMultiMode()) {
        return;
      }

      slot.reconnectTimer = setTimeout(() => {
        if (slot.nonce !== nonce || !isMultiMode()) {
          return;
        }
        openMultiSlotSocket(slot, nonce);
      }, RECONNECT_DELAY_MS);
    });
  }

  function upsertMultiSlotCandle(slot, candle) {
    const last = slot.candles[slot.candles.length - 1];

    if (!last || candle.time > last.time) {
      slot.candles.push(candle);
      if (slot.candles.length > MAX_CANDLES) {
        slot.candles.shift();
      }
      return;
    }

    if (candle.time === last.time) {
      slot.candles[slot.candles.length - 1] = candle;
    }
  }

  function closeMultiSlotSocket(slot) {
    if (slot.reconnectTimer) {
      clearTimeout(slot.reconnectTimer);
      slot.reconnectTimer = null;
    }

    if (!slot.ws) {
      return;
    }

    if (slot.ws.readyState === WebSocket.OPEN || slot.ws.readyState === WebSocket.CONNECTING) {
      slot.ws.close();
    }
    slot.ws = null;
  }

  function destroyMultiCharts() {
    state.multiCharts.forEach((slot) => {
      closeMultiSlotSocket(slot);
      clearMultiAiOverlays(slot);
      if (slot.chart) {
        slot.chart.remove();
      }
    });

    state.multiCharts = [];
    dom.multiGrid.innerHTML = "";
  }

  function resizeMultiCharts() {
    if (!isMultiMode()) {
      return;
    }

    state.multiCharts.forEach((slot) => {
      if (!slot.chartNode || !slot.chart) {
        return;
      }
      const width = slot.chartNode.clientWidth;
      const height = slot.chartNode.clientHeight;
      if (width > 0 && height > 0) {
        slot.chart.resize(width, height);
      }
    });
  }

  function applyThemeToMultiCharts() {
    if (!state.multiCharts.length) {
      return;
    }

    const palette = getPalette();
    state.multiCharts.forEach((slot) => {
      slot.chart.applyOptions(buildPriceChartOptions(palette));
      slot.series.applyOptions(candleSeriesOptions(palette));
      if (slot.ai?.data) {
        applyAiForMultiSlotCurrentInterval(slot);
        updateMultiAiSummary(slot);
      }
    });
  }

  function isChartFullscreen() {
    return document.fullscreenElement === dom.chartZone || document.webkitFullscreenElement === dom.chartZone;
  }

  function syncFullscreenButton() {
    dom.fullscreenBtn.textContent = isChartFullscreen() ? "Exit Fullscreen" : "Fullscreen";
    closeLayoutMenu();
    requestAnimationFrame(() => {
      resizeCharts();
      resizeMultiCharts();
    });
  }

  function toggleChartFullscreen() {
    if (isChartFullscreen()) {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      return;
    }

    if (dom.chartZone.requestFullscreen) {
      dom.chartZone.requestFullscreen();
    } else if (dom.chartZone.webkitRequestFullscreen) {
      dom.chartZone.webkitRequestFullscreen();
    }
  }

  function openSymbolStreams(nonce) {
    const lower = state.symbol.toLowerCase();
    openSocket(
      "kline",
      `${WS_BASE}/${lower}@kline_${state.interval}`,
      (payload) => {
        const k = payload.k;
        if (!k) {
          return;
        }
        const candle = {
          time: Math.floor(Number(k.t) / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v)
        };
        upsertCandle(candle);
        renderPriceSeries();
        renderIndicators();
        updateOhlcFromLast();
        if (k.x) {
          scheduleAiAnalysis(250);
        }
      },
      nonce
    );

    openSocket(
      "depth",
      `${WS_BASE}/${lower}@depth20@100ms`,
      (payload) => {
        const asks = payload.asks || payload.a || [];
        const bids = payload.bids || payload.b || [];
        state.depth = {
          asks: asks.map(([price, qty]) => [Number(price), Number(qty)]),
          bids: bids.map(([price, qty]) => [Number(price), Number(qty)])
        };
        renderOrderBook();
      },
      nonce
    );

    openSocket(
      "trade",
      `${WS_BASE}/${lower}@trade`,
      (payload) => {
        const trade = {
          time: Number(payload.T),
          price: Number(payload.p),
          qty: Number(payload.q),
          isBuyerMaker: Boolean(payload.m)
        };

        state.trades.unshift(trade);
        if (state.trades.length > 80) {
          state.trades.length = 80;
        }
        renderTrades();
      },
      nonce
    );
  }

  function openSocket(key, url, onMessage, nonce) {
    if (state.reconnectTimers[key]) {
      clearTimeout(state.reconnectTimers[key]);
      state.reconnectTimers[key] = null;
    }

    const ws = new WebSocket(url);
    state.sockets[key] = ws;

    ws.addEventListener("open", () => updateSocketBadge());

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        onMessage(payload);
      } catch {
        // Ignore invalid stream payloads.
      }
    });

    ws.addEventListener("error", () => {
      ws.close();
    });

    ws.addEventListener("close", () => {
      if (state.sockets[key] === ws) {
        delete state.sockets[key];
      }
      updateSocketBadge();

      if (nonce !== state.streamNonce) {
        return;
      }

      state.reconnectTimers[key] = setTimeout(() => {
        if (nonce !== state.streamNonce) {
          return;
        }
        openSocket(key, url, onMessage, nonce);
      }, RECONNECT_DELAY_MS);
    });
  }

  function closeAllSockets() {
    stopLivePolling();

    Object.values(state.reconnectTimers).forEach((timer) => {
      if (timer) {
        clearTimeout(timer);
      }
    });

    state.reconnectTimers = {};

    Object.values(state.sockets).forEach((ws) => {
      if (!ws) {
        return;
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    });

    state.sockets = {};
    updateSocketBadge();
  }

  function startLivePolling() {
    stopLivePolling();
    state.livePollTimer = setInterval(() => {
      pollLatestSingleCandle();
    }, 3500);
  }

  function stopLivePolling() {
    if (!state.livePollTimer) {
      return;
    }
    clearInterval(state.livePollTimer);
    state.livePollTimer = null;
  }

  async function pollLatestSingleCandle() {
    if (isMultiMode()) {
      return;
    }

    const symbol = state.symbol;
    const interval = state.interval;

    if (!symbol || !interval) {
      return;
    }

    try {
      const raw = await fetchJson(`${REST_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=3`);
      if (isMultiMode() || symbol !== state.symbol || interval !== state.interval) {
        return;
      }

      const latest = (raw || []).map(toCandle).filter(Boolean).slice(-2);
      if (!latest.length) {
        return;
      }

      latest.forEach((candle) => upsertCandle(candle));
      renderPriceSeries();
      renderIndicators();
      updateOhlcFromLast();
    } catch {
      // Ignore polling failures; websocket remains primary source.
    }
  }

  function updateSocketBadge() {
    if (isMultiMode()) {
      return;
    }

    const sockets = Object.values(state.sockets);
    const openCount = sockets.filter((ws) => ws.readyState === WebSocket.OPEN).length;

    if (openCount >= 3) {
      setStatus("connected", "Live");
      return;
    }

    if (openCount > 0) {
      setStatus("neutral", `Connecting ${openCount}/3`);
      return;
    }

    setStatus("disconnected", "Disconnected");
  }

  function upsertCandle(candle) {
    const last = state.candles[state.candles.length - 1];

    if (!last || candle.time > last.time) {
      state.candles.push(candle);
      if (state.candles.length > MAX_CANDLES) {
        const removed = state.candles.shift();
        if (removed) {
          state.candleMap.delete(removed.time);
        }
      }
    } else if (candle.time === last.time) {
      state.candles[state.candles.length - 1] = candle;
    }

    state.candleMap.set(candle.time, candle);
  }

  function renderOrderBook() {
    if (!state.depth.bids.length || !state.depth.asks.length) {
      dom.orderbook.innerHTML = `<div class=\"muted\">No order book data</div>`;
      return;
    }

    const asks = state.depth.asks
      .filter(([, qty]) => qty > 0)
      .sort((a, b) => a[0] - b[0])
      .slice(0, 12);

    const bids = state.depth.bids
      .filter(([, qty]) => qty > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 12);

    let askTotal = 0;
    const askRows = [];
    for (let i = asks.length - 1; i >= 0; i -= 1) {
      const [price, qty] = asks[i];
      askTotal += qty;
      askRows.push(bookRowHtml("ask", price, qty, askTotal));
    }

    let bidTotal = 0;
    const bidRows = [];
    for (const [price, qty] of bids) {
      bidTotal += qty;
      bidRows.push(bookRowHtml("bid", price, qty, bidTotal));
    }

    const bestAsk = asks[0]?.[0];
    const bestBid = bids[0]?.[0];
    const spread = Number.isFinite(bestAsk) && Number.isFinite(bestBid) ? bestAsk - bestBid : null;

    const spreadRow = `<div class=\"book-row muted\"><span>Spread</span><span>${
      spread === null ? "--" : formatPrice(spread)
    }</span><span></span></div>`;

    dom.orderbook.innerHTML = `${askRows.join("")}${spreadRow}${bidRows.join("")}`;
  }

  function renderTrades() {
    if (!state.trades.length) {
      dom.trades.innerHTML = `<div class=\"muted\">No trades</div>`;
      return;
    }

    dom.trades.innerHTML = state.trades
      .slice(0, 60)
      .map((trade) => {
        const sideClass = trade.isBuyerMaker ? "sell" : "buy";
        return `<div class=\"trade-row ${sideClass}\">\n            <span>${formatClock(trade.time)}</span>\n            <span>${formatPrice(trade.price)}</span>\n            <span>${formatQty(trade.qty)}</span>\n          </div>`;
      })
      .join("");
  }

  function bookRowHtml(type, price, qty, total) {
    return `<div class=\"book-row ${type}\">\n        <span>${formatPrice(price)}</span>\n        <span>${formatQty(qty)}</span>\n        <span>${formatQty(total)}</span>\n      </div>`;
  }

  function updateOhlcFromLast() {
    const last = state.candles[state.candles.length - 1];
    if (!last) {
      dom.ohlcRow.textContent = "Waiting for data...";
      return;
    }
    updateOhlc(last);
  }

  function updateOhlc(candle) {
    const delta = candle.close - candle.open;
    const deltaPct = candle.open ? (delta / candle.open) * 100 : 0;
    const deltaText = `${delta >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%`;

    dom.ohlcRow.textContent = `O ${formatPrice(candle.open)}   H ${formatPrice(candle.high)}   L ${formatPrice(
      candle.low
    )}   C ${formatPrice(candle.close)}   V ${formatQty(candle.volume)}   Δ ${deltaText}`;
  }

  function calcSma(candles, period) {
    if (candles.length < period) {
      return [];
    }

    const output = [];
    let sum = 0;

    for (let i = 0; i < candles.length; i += 1) {
      sum += candles[i].close;
      if (i >= period) {
        sum -= candles[i - period].close;
      }

      if (i >= period - 1) {
        output.push({
          time: candles[i].time,
          value: sum / period
        });
      }
    }

    return output;
  }

  function calcEma(candles, period) {
    if (candles.length < period) {
      return [];
    }

    const output = [];
    let seed = 0;

    for (let i = 0; i < period; i += 1) {
      seed += candles[i].close;
    }

    let ema = seed / period;
    output.push({ time: candles[period - 1].time, value: ema });

    const k = 2 / (period + 1);
    for (let i = period; i < candles.length; i += 1) {
      ema = candles[i].close * k + ema * (1 - k);
      output.push({ time: candles[i].time, value: ema });
    }

    return output;
  }

  function calcBollinger(candles, period, stdev) {
    if (candles.length < period) {
      return { upper: [], lower: [], middle: [] };
    }

    const upper = [];
    const lower = [];
    const middle = [];

    for (let i = period - 1; i < candles.length; i += 1) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j += 1) {
        sum += candles[j].close;
      }

      const mean = sum / period;

      let varianceSum = 0;
      for (let j = i - period + 1; j <= i; j += 1) {
        const diff = candles[j].close - mean;
        varianceSum += diff * diff;
      }

      const std = Math.sqrt(varianceSum / period);
      const time = candles[i].time;

      upper.push({ time, value: mean + stdev * std });
      lower.push({ time, value: mean - stdev * std });
      middle.push({ time, value: mean });
    }

    return { upper, lower, middle };
  }

  function calcRsi(candles, period) {
    if (candles.length <= period) {
      return [];
    }

    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= period; i += 1) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff >= 0) {
        gain += diff;
      } else {
        loss += Math.abs(diff);
      }
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;

    const output = [];
    output.push({
      time: candles[period].time,
      value: rsiValue(avgGain, avgLoss)
    });

    for (let i = period + 1; i < candles.length; i += 1) {
      const diff = candles[i].close - candles[i - 1].close;
      const nextGain = diff > 0 ? diff : 0;
      const nextLoss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + nextGain) / period;
      avgLoss = (avgLoss * (period - 1) + nextLoss) / period;

      output.push({
        time: candles[i].time,
        value: rsiValue(avgGain, avgLoss)
      });
    }

    return output;
  }

  function rsiValue(avgGain, avgLoss) {
    if (avgLoss === 0) {
      return 100;
    }
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  function calcMacd(candles, fastPeriod, slowPeriod, signalPeriod) {
    if (candles.length < slowPeriod + signalPeriod) {
      return { macd: [], signal: [], hist: [] };
    }

    const fast = emaSequence(candles, fastPeriod);
    const slow = emaSequence(candles, slowPeriod);

    const macd = candles.map((candle, idx) => ({
      time: candle.time,
      value: fast[idx] - slow[idx]
    }));

    const signalValues = emaOnValues(macd.map((point) => point.value), signalPeriod);
    const signal = [];
    const hist = [];

    for (let i = 0; i < macd.length; i += 1) {
      const signalIdx = i - (signalPeriod - 1);
      if (signalIdx < 0) {
        continue;
      }
      const signalValue = signalValues[signalIdx];
      signal.push({ time: macd[i].time, value: signalValue });
      hist.push({ time: macd[i].time, value: macd[i].value - signalValue });
    }

    return {
      macd: macd.slice(signalPeriod - 1),
      signal,
      hist
    };
  }

  function emaSequence(candles, period) {
    const values = candles.map((candle) => candle.close);
    return emaOnValues(values, period, true);
  }

  function emaOnValues(values, period, fillInitial = false) {
    if (!values.length) {
      return [];
    }

    const output = new Array(values.length);
    const k = 2 / (period + 1);

    let seed = 0;
    const seedLimit = Math.min(period, values.length);
    for (let i = 0; i < seedLimit; i += 1) {
      seed += values[i];
    }

    let ema = seed / seedLimit;

    for (let i = 0; i < values.length; i += 1) {
      if (i < period - 1) {
        output[i] = fillInitial ? ema : NaN;
        continue;
      }

      if (i === period - 1) {
        output[i] = ema;
        continue;
      }

      ema = values[i] * k + ema * (1 - k);
      output[i] = ema;
    }

    if (fillInitial) {
      for (let i = 0; i < period - 1 && i < output.length; i += 1) {
        output[i] = output[period - 1];
      }
    }

    return output.filter((value) => Number.isFinite(value));
  }

  function formatPrice(value) {
    if (!Number.isFinite(value)) {
      return "--";
    }
    const abs = Math.abs(value);
    const decimals = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : 6;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatQty(value) {
    if (!Number.isFinite(value)) {
      return "--";
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    });
  }

  function formatClock(timestamp) {
    if (!Number.isFinite(timestamp)) {
      return "--";
    }
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour12: false
    });
  }

  function normalizeTime(time) {
    if (typeof time === "number") {
      return time;
    }

    if (typeof time === "string") {
      return Number(time);
    }

    if (time && typeof time === "object" && Number.isInteger(time.year)) {
      const date = Date.UTC(time.year, time.month - 1, time.day);
      return Math.floor(date / 1000);
    }

    return null;
  }

  function toCandle(entry) {
    if (!Array.isArray(entry) || entry.length < 6) {
      return null;
    }

    return {
      time: Math.floor(Number(entry[0]) / 1000),
      open: Number(entry[1]),
      high: Number(entry[2]),
      low: Number(entry[3]),
      close: Number(entry[4]),
      volume: Number(entry[5])
    };
  }

  function sanitizeSymbol(raw) {
    if (!raw) {
      return null;
    }
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cleaned || cleaned.length < 5 || cleaned.length > 20) {
      return null;
    }
    return cleaned;
  }

  function sanitizeApiKey(raw) {
    if (!raw) {
      return "";
    }

    const condensed = String(raw).replace(/\s+/g, "").trim();
    if (condensed.length < 12 || condensed.length > 240) {
      return "";
    }
    return condensed;
  }

  function saveAiApiKey(rawKey) {
    const key = sanitizeApiKey(rawKey);
    state.ai.apiKey = key;
    dom.geminiKeyInput.value = key;

    if (key) {
      localStorage.setItem(AI_KEY_STORAGE_KEY, key);
      setAiStatus("neutral", "API key saved");
      scheduleAiAnalysis(120);
      return;
    }

    localStorage.removeItem(AI_KEY_STORAGE_KEY);
    setAiStatus("neutral", "API key cleared");
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
  }

  function setActiveIntervalButton() {
    const buttons = dom.intervalGroup.querySelectorAll("button[data-interval]");
    buttons.forEach((button) => {
      button.classList.toggle("active", button.dataset.interval === state.interval);
    });
  }

  function setStatus(kind, label) {
    dom.statusPill.className = `status-pill ${kind}`;
    dom.statusPill.textContent = label;
  }

  function getPalette() {
    return PALETTES[state.theme];
  }

  function colorWithAlpha(hex, alpha) {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  init();
})();
