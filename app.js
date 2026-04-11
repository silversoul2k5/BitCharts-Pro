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
  const BINANCE_SYMBOLS_CACHE_KEY = "bitcharts-binance-symbols";
  const BINANCE_SYMBOLS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  const BINANCE_EXCHANGE_INFO_URLS = [`${REST_BASE}/exchangeInfo`, "https://api.binance.com/api/v3/exchangeInfo"];
  const BINANCE_ALPHA_CACHE_KEY = "bitcharts-binance-alpha-symbols";
  const BINANCE_ALPHA_TOKEN_LIST_URL =
    "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list";
  const BINANCE_ALPHA_EXCHANGE_INFO_URL =
    "https://www.binance.com/bapi/defi/v1/public/alpha-trade/get-exchange-info";
  const BINANCE_ALPHA_KLINES_URL = "https://www.binance.com/bapi/defi/v1/public/alpha-trade/klines";
  const BINANCE_ALPHA_TICKER_URL = "https://www.binance.com/bapi/defi/v1/public/alpha-trade/ticker";
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
    market: {
      marketType: "spot",
      displaySymbol: "BTCUSDT",
      requestSymbol: "BTCUSDT"
    },
    multiCharts: [],
    symbolCatalog: {
      loaded: false,
      loading: false,
      items: [],
      index: new Set()
    },
    alphaCatalog: {
      loaded: false,
      loading: false,
      items: [],
      index: new Set(),
      byDisplay: new Map()
    },
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
    symbolList: document.getElementById("symbol-list"),
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
    configureSymbolInput(dom.symbolInput);
    updateLayoutMenuState();
    closeLayoutMenu();
    setAiStatus("neutral", "AI idle");
    renderAiCards();

    initCharts();
    bindEvents();
    hydrateCachedBinanceSymbols();
    hydrateCachedAlphaSymbols();
    loadBinanceSymbols();
    loadAlphaSymbols();
    setActiveIntervalButton();
    setViewMode(state.multiCount, true);
    syncFullscreenButton();
  }

  function bindEvents() {
    dom.symbolInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitPrimarySymbolInput();
      }
    });

    dom.symbolInput.addEventListener("change", () => {
      commitPrimarySymbolInput();
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
      if (isMultiMode()) {
        renderMultiPriceSeriesAll();
        state.multiCharts.forEach((slot) => {
          if (slot.ai?.data) {
            applyAiForMultiSlotCurrentInterval(slot);
          }
        });
        return;
      }
      renderPriceSeries();
      updateOhlcFromLast();
      applyAiForCurrentInterval();
    });

    dom.reloadBtn.addEventListener("click", () => {
      const symbol = normalizeSymbolInputValue(dom.symbolInput.value);
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
      if (isMultiMode()) {
        renderMultiIndicatorsAll();
        return;
      }
      renderIndicators();
    });

    dom.showSma.addEventListener("change", () => {
      state.indicators.sma = dom.showSma.checked;
      if (isMultiMode()) {
        renderMultiIndicatorsAll();
        return;
      }
      renderIndicators();
    });

    dom.showEma.addEventListener("change", () => {
      state.indicators.ema = dom.showEma.checked;
      if (isMultiMode()) {
        renderMultiIndicatorsAll();
        return;
      }
      renderIndicators();
    });

    dom.showBb.addEventListener("change", () => {
      state.indicators.bb = dom.showBb.checked;
      if (isMultiMode()) {
        renderMultiIndicatorsAll();
        return;
      }
      renderIndicators();
    });

    dom.showRsi.addEventListener("change", () => {
      state.indicators.rsi = dom.showRsi.checked;
      if (isMultiMode()) {
        updateMultiPaneVisibility();
        renderMultiIndicatorsAll();
        return;
      }
      updatePaneVisibility();
      renderIndicators();
    });

    dom.showMacd.addEventListener("change", () => {
      state.indicators.macd = dom.showMacd.checked;
      if (isMultiMode()) {
        updateMultiPaneVisibility();
        renderMultiIndicatorsAll();
        return;
      }
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
    window.addEventListener("resize", updateMultiPaneVisibility);
    window.addEventListener("resize", resizeMultiCharts);
    resizeCharts();
  }

  function configureSymbolInput(input) {
    if (!input) {
      return;
    }

    input.setAttribute("list", "symbol-list");
    input.setAttribute("autocapitalize", "characters");
    if (!input.placeholder) {
      input.placeholder = "Search Binance pair";
    }
  }

  function commitPrimarySymbolInput() {
    const symbol = normalizeSymbolInputValue(dom.symbolInput.value);
    if (!symbol) {
      return;
    }

    state.symbol = symbol;
    dom.symbolInput.value = symbol;

    if (isMultiMode()) {
      updatePrimaryMultiSymbol(symbol);
      return;
    }

    loadMarket();
  }

  function commitMultiSymbolInput(slot) {
    if (!slot?.symbolInput) {
      return;
    }

    const symbol = normalizeSymbolInputValue(slot.symbolInput.value);
    if (!symbol) {
      return;
    }

    slot.symbol = symbol;
    slot.symbolInput.value = symbol;

    if (slot.index === 0) {
      state.symbol = symbol;
      dom.symbolInput.value = symbol;
    }

    loadMultiSlot(slot);
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
    dom.indicatorSwitches.style.display = "none";
    dom.aiTimeframes.style.display = "none";
    dom.aiStatus.parentElement.style.display = "none";

    const isPhone = window.matchMedia("(max-width: 900px)").matches;
    const isCompact = window.matchMedia("(max-width: 1180px)").matches;
    const mainMin = isPhone ? 220 : isCompact ? 240 : 280;
    const rsiHeight = isPhone ? 100 : isCompact ? 115 : 130;
    const macdHeight = isPhone ? 115 : isCompact ? 130 : 150;

    const rows = ["auto", `minmax(${mainMin}px, 1fr)`];
    if (state.indicators.rsi) {
      rows.push(`${rsiHeight}px`);
    }
    if (state.indicators.macd) {
      rows.push(`${macdHeight}px`);
    }
    dom.chartZone.style.gridTemplateRows = rows.join(" ");

    requestAnimationFrame(resizeCharts);
  }

  function updateMultiPaneVisibility() {
    if (!isMultiMode()) {
      return;
    }

    const isPhone = window.matchMedia("(max-width: 900px)").matches;
    const isCompact = window.matchMedia("(max-width: 1180px)").matches;
    const count = state.multiCount;

    const mainMin = isPhone
      ? count >= 3
        ? 128
        : 160
      : isCompact
        ? count >= 3
          ? 146
          : 176
        : count === 4
          ? 150
          : count === 3
            ? 170
            : 210;

    const rsiHeight = isPhone ? 58 : isCompact ? 64 : 78;
    const macdHeight = isPhone ? 66 : isCompact ? 76 : 92;

    state.multiCharts.forEach((slot) => {
      if (!slot?.card) {
        return;
      }

      if (slot.rsiPane) {
        slot.rsiPane.style.display = state.indicators.rsi ? "block" : "none";
      }
      if (slot.macdPane) {
        slot.macdPane.style.display = state.indicators.macd ? "block" : "none";
      }

      const rows = ["auto", "auto", "auto", `minmax(${mainMin}px, 1fr)`];
      if (state.indicators.rsi) {
        rows.push(`${rsiHeight}px`);
      }
      if (state.indicators.macd) {
        rows.push(`${macdHeight}px`);
      }
      slot.card.style.gridTemplateRows = rows.join(" ");
    });

    requestAnimationFrame(resizeMultiCharts);
  }

  async function fetchMarketSnapshot(market, interval) {
    if (market?.marketType === "alpha") {
      const [klinePayload, tickerPayload] = await Promise.all([
        fetchJson(`${BINANCE_ALPHA_KLINES_URL}?symbol=${encodeURIComponent(market.requestSymbol)}&interval=${encodeURIComponent(interval)}&limit=${MAX_CANDLES}`),
        fetchJson(`${BINANCE_ALPHA_TICKER_URL}?symbol=${encodeURIComponent(market.requestSymbol)}`)
      ]);

      return {
        candles: Array.isArray(klinePayload?.data) ? klinePayload.data : [],
        depth: { bids: [], asks: [] },
        trades: [],
        ticker: tickerPayload?.data || {}
      };
    }

    const [candles, ticker] = await Promise.all([
      fetchJson(`${REST_BASE}/klines?symbol=${market.requestSymbol}&interval=${interval}&limit=${MAX_CANDLES}`),
      fetchJson(`${REST_BASE}/ticker/24hr?symbol=${market.requestSymbol}`)
    ]);

    return {
      candles,
      depth: { bids: [], asks: [] },
      trades: [],
      ticker
    };
  }

  async function fetchLatestMarketCandles(market, interval, limit = 3) {
    if (market?.marketType === "alpha") {
      const payload = await fetchJson(
        `${BINANCE_ALPHA_KLINES_URL}?symbol=${encodeURIComponent(market.requestSymbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
      );
      return Array.isArray(payload?.data) ? payload.data : [];
    }

    return fetchJson(`${REST_BASE}/klines?symbol=${market.requestSymbol}&interval=${interval}&limit=${limit}`);
  }

  async function fetchMarketTicker(market) {
    if (market?.marketType === "alpha") {
      const payload = await fetchJson(`${BINANCE_ALPHA_TICKER_URL}?symbol=${encodeURIComponent(market.requestSymbol)}`);
      return payload?.data || {};
    }

    return fetchJson(`${REST_BASE}/ticker/24hr?symbol=${market.requestSymbol}`);
  }

  function clearSingleMarketData() {
    state.candles = [];
    state.candleMap = new Map();
    state.depth = { bids: [], asks: [] };
    state.trades = [];
    renderAll();
    renderOrderBook();
    renderTrades();
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
      const market = await resolveMarketSymbol(state.symbol);
      if (nonce !== state.streamNonce) {
        return;
      }

      if (!market) {
        state.market = {
          marketType: "spot",
          displaySymbol: state.symbol,
          requestSymbol: state.symbol
        };
        clearSingleMarketData();
        dom.ohlcRow.textContent = `${state.symbol} is not available on Binance Spot or Binance Alpha.`;
        setStatus("disconnected", "Invalid symbol");
        setAiStatus("error", "AI waiting for valid pair");
        return;
      }

      state.market = market;
      state.symbol = market.displaySymbol;
      dom.symbolInput.value = market.displaySymbol;
      dom.marketTitle.textContent = `${market.displaySymbol} • ${state.interval}`;

      const { candles, depth, trades, ticker } = await fetchMarketSnapshot(market, state.interval);

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
      const marketTag = market.marketType === "alpha" ? " • Alpha" : "";
      dom.marketTitle.textContent = `${market.displaySymbol} • ${state.interval} • ${lastPriceText} (${pctText})${marketTag}`;

      if (market.marketType === "spot") {
        openSymbolStreams(nonce);
      }
      startLivePolling();
      setStatus("connected", market.marketType === "alpha" ? "Alpha Live" : "Live");
      if (market.marketType === "alpha") {
        setAiStatus("neutral", "AI unavailable for Alpha");
      } else {
        scheduleAiAnalysis(350);
      }
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

  function buildCloseData(candles) {
    return candles.map((candle) => ({ time: candle.time, value: candle.close }));
  }

  function getMainSeriesTargets(target) {
    if (!target) {
      return null;
    }

    return {
      candles: target.candleSeries || target.candles || null,
      line: target.lineSeries || target.line || null,
      area: target.areaSeries || target.area || null,
      baseline: target.baselineSeries || target.baseline || null
    };
  }

  function getSingleVisibleMainSeries() {
    const targets = getMainSeriesTargets(series);
    if (!targets) {
      return null;
    }

    if (state.chartType === "line") {
      return targets.line;
    }
    if (state.chartType === "area") {
      return targets.area;
    }
    if (state.chartType === "baseline") {
      return targets.baseline;
    }
    return targets.candles;
  }

  function getMultiVisibleMainSeries(slot) {
    const targets = getMainSeriesTargets(slot);
    if (!targets) {
      return null;
    }

    if (state.chartType === "line") {
      return targets.line;
    }
    if (state.chartType === "area") {
      return targets.area;
    }
    if (state.chartType === "baseline") {
      return targets.baseline;
    }
    return targets.candles;
  }

  function setMainSeriesData(target, candles) {
    const targets = getMainSeriesTargets(target);
    if (!targets) {
      return;
    }

    const closeData = buildCloseData(candles);

    targets.candles?.setData(state.chartType === "candles" ? candles : []);
    targets.line?.setData(state.chartType === "line" ? closeData : []);
    targets.area?.setData(state.chartType === "area" ? closeData : []);

    if (state.chartType === "baseline") {
      const base = candles[0]?.close || 0;
      targets.baseline?.applyOptions({ baseValue: { type: "price", price: base } });
      targets.baseline?.setData(closeData);
    } else {
      targets.baseline?.setData([]);
    }
  }

  function renderPriceSeries() {
    setMainSeriesData(series, state.candles);
  }

  function renderMultiPriceSeriesForSlot(slot) {
    if (!slot) {
      return;
    }
    setMainSeriesData(slot, slot.candles || []);
  }

  function renderMultiPriceSeriesAll() {
    if (!isMultiMode()) {
      return;
    }

    state.multiCharts.forEach((slot) => {
      renderMultiPriceSeriesForSlot(slot);
    });
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

  function renderMultiIndicatorsAll() {
    if (!isMultiMode()) {
      return;
    }

    state.multiCharts.forEach((slot) => {
      renderMultiIndicatorsForSlot(slot);
    });

    requestAnimationFrame(resizeMultiCharts);
  }

  function renderMultiIndicatorsForSlot(slot) {
    if (!slot || !slot.candleSeries) {
      return;
    }

    const palette = getPalette();
    const candles = slot.candles || [];

    if (!candles.length) {
      slot.volumeSeries.setData([]);
      slot.smaSeries.setData([]);
      slot.emaSeries.setData([]);
      slot.bbUpperSeries.setData([]);
      slot.bbLowerSeries.setData([]);
      slot.bbMiddleSeries.setData([]);
      slot.rsiSeries.setData([]);
      slot.rsiUpperSeries.setData([]);
      slot.rsiLowerSeries.setData([]);
      slot.macdLineSeries.setData([]);
      slot.macdSignalSeries.setData([]);
      slot.macdHistSeries.setData([]);
      return;
    }

    if (state.indicators.volume) {
      slot.volumeSeries.setData(
        candles.map((candle) => ({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? colorWithAlpha(palette.up, 0.82) : colorWithAlpha(palette.down, 0.82)
        }))
      );
    } else {
      slot.volumeSeries.setData([]);
    }

    if (state.indicators.sma) {
      slot.smaSeries.setData(calcSma(candles, 20));
    } else {
      slot.smaSeries.setData([]);
    }

    if (state.indicators.ema) {
      slot.emaSeries.setData(calcEma(candles, 50));
    } else {
      slot.emaSeries.setData([]);
    }

    if (state.indicators.bb) {
      const bands = calcBollinger(candles, 20, 2);
      slot.bbUpperSeries.setData(bands.upper);
      slot.bbLowerSeries.setData(bands.lower);
      slot.bbMiddleSeries.setData(bands.middle);
    } else {
      slot.bbUpperSeries.setData([]);
      slot.bbLowerSeries.setData([]);
      slot.bbMiddleSeries.setData([]);
    }

    if (state.indicators.rsi) {
      const rsi = calcRsi(candles, 14);
      slot.rsiSeries.setData(rsi);
      slot.rsiUpperSeries.setData(candles.map((candle) => ({ time: candle.time, value: 70 })));
      slot.rsiLowerSeries.setData(candles.map((candle) => ({ time: candle.time, value: 30 })));
      applyMultiRsiFixedScale(slot);
    } else {
      slot.rsiSeries.setData([]);
      slot.rsiUpperSeries.setData([]);
      slot.rsiLowerSeries.setData([]);
    }

    if (state.indicators.macd) {
      const macd = calcMacd(candles, 12, 26, 9);
      slot.macdLineSeries.setData(macd.macd);
      slot.macdSignalSeries.setData(macd.signal);
      slot.macdHistSeries.setData(
        macd.hist.map((point) => ({
          time: point.time,
          value: point.value,
          color: point.value >= 0 ? palette.pos : palette.neg
        }))
      );
    } else {
      slot.macdLineSeries.setData([]);
      slot.macdSignalSeries.setData([]);
      slot.macdHistSeries.setData([]);
    }
  }

  function applyMultiRsiFixedScale(slot) {
    if (!slot?.rsiChart || !slot?.rsiSeries || !slot?.rsiUpperSeries || !slot?.rsiLowerSeries) {
      return;
    }

    const fixedRange = () => ({
      priceRange: { minValue: 0, maxValue: 100 }
    });

    slot.rsiSeries.applyOptions({ autoscaleInfoProvider: fixedRange });
    slot.rsiUpperSeries.applyOptions({ autoscaleInfoProvider: fixedRange });
    slot.rsiLowerSeries.applyOptions({ autoscaleInfoProvider: fixedRange });

    slot.rsiChart.priceScale("right").applyOptions({
      autoScale: true,
      mode: LightweightCharts.PriceScaleMode.Normal,
      scaleMargins: { top: 0.14, bottom: 0.14 }
    });
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

    if (state.market?.marketType === "alpha") {
      setAiStatus("neutral", "AI unavailable for Alpha");
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

    if (slot.market?.marketType === "alpha") {
      setMultiAiStatus(slot, "neutral", "AI Alpha off");
      updateMultiAiSummary(slot);
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

    applyAiMarkersToSeries(getMultiVisibleMainSeries(slot), slot.ai, markers);
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
    applyAiMarkersToSeries(getMultiVisibleMainSeries(slot), slot.ai, []);
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
    applyAiMarkersToSeries(getSingleVisibleMainSeries(), state.ai, []);
  }

  function applyAiMarkers(markers) {
    applyAiMarkersToSeries(getSingleVisibleMainSeries(), state.ai, markers);
  }

  function applyAiMarkersToSeries(targetSeries, markerStore, markers) {
    if (!targetSeries || !markerStore) {
      return;
    }

    if (markerStore.markerTarget && markerStore.markerTarget !== targetSeries) {
      if (typeof markerStore.markerTarget.setMarkers === "function") {
        markerStore.markerTarget.setMarkers([]);
      }
      if (markerStore.markerApi && typeof markerStore.markerApi.setMarkers === "function") {
        markerStore.markerApi.setMarkers([]);
      }
      markerStore.markerApi = null;
    }

    markerStore.markerTarget = targetSeries;

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

  function hydrateCachedBinanceSymbols() {
    try {
      const cached = JSON.parse(localStorage.getItem(BINANCE_SYMBOLS_CACHE_KEY) || "null");
      if (!cached || !Array.isArray(cached.items) || !cached.items.length) {
        return;
      }

      const age = Date.now() - Number(cached.savedAt || 0);
      if (!Number.isFinite(age) || age > BINANCE_SYMBOLS_CACHE_TTL_MS) {
        return;
      }

      applyBinanceSymbols(cached.items);
    } catch {
      // Ignore corrupted cache and fetch a fresh catalog.
    }
  }

  function hydrateCachedAlphaSymbols() {
    try {
      const cached = JSON.parse(localStorage.getItem(BINANCE_ALPHA_CACHE_KEY) || "null");
      if (!cached || !Array.isArray(cached.items) || !cached.items.length) {
        return;
      }

      const age = Date.now() - Number(cached.savedAt || 0);
      if (!Number.isFinite(age) || age > BINANCE_SYMBOLS_CACHE_TTL_MS) {
        return;
      }

      applyAlphaSymbols(cached.items);
    } catch {
      // Ignore corrupted cache and fetch a fresh alpha catalog on demand.
    }
  }

  async function loadBinanceSymbols(force = false) {
    if (!force && (state.symbolCatalog.loading || state.symbolCatalog.loaded)) {
      return;
    }

    state.symbolCatalog.loading = true;

    try {
      const payload = await fetchFirstJson(BINANCE_EXCHANGE_INFO_URLS);
      const items = normalizeBinanceSymbols(payload?.symbols);
      if (!items.length) {
        return;
      }

      applyBinanceSymbols(items);
      localStorage.setItem(
        BINANCE_SYMBOLS_CACHE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          items
        })
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unable to load Binance symbols:", error);
    } finally {
      state.symbolCatalog.loading = false;
    }
  }

  async function loadAlphaSymbols(force = false) {
    if (!force && (state.alphaCatalog.loading || state.alphaCatalog.loaded)) {
      return;
    }

    state.alphaCatalog.loading = true;

    try {
      const [tokenPayload, exchangePayload] = await Promise.all([
        fetchJson(BINANCE_ALPHA_TOKEN_LIST_URL),
        fetchJson(BINANCE_ALPHA_EXCHANGE_INFO_URL)
      ]);

      const items = normalizeAlphaSymbols(tokenPayload?.data, exchangePayload?.data?.symbols);
      if (!items.length) {
        return;
      }

      applyAlphaSymbols(items);
      localStorage.setItem(
        BINANCE_ALPHA_CACHE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          items
        })
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unable to load Binance Alpha symbols:", error);
    } finally {
      state.alphaCatalog.loading = false;
    }
  }

  async function fetchFirstJson(urls) {
    let lastError = null;

    for (const url of urls) {
      try {
        return await fetchJson(url);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Request failed");
  }

  function normalizeBinanceSymbols(rawSymbols) {
    if (!Array.isArray(rawSymbols)) {
      return [];
    }

    const items = rawSymbols
      .filter((entry) => {
        if (!entry || entry.status !== "TRADING") {
          return false;
        }

        if (entry.isSpotTradingAllowed === false) {
          return false;
        }

        if (Array.isArray(entry.permissions) && entry.permissions.length && !entry.permissions.includes("SPOT")) {
          return false;
        }

        return Boolean(entry.symbol && entry.baseAsset && entry.quoteAsset);
      })
      .map((entry) => ({
        marketType: "spot",
        displaySymbol: String(entry.symbol).toUpperCase(),
        requestSymbol: String(entry.symbol).toUpperCase(),
        symbol: String(entry.symbol).toUpperCase(),
        baseAsset: String(entry.baseAsset).toUpperCase(),
        quoteAsset: String(entry.quoteAsset).toUpperCase()
      }))
      .sort((left, right) => left.symbol.localeCompare(right.symbol));

    return items;
  }

  function normalizeAlphaSymbols(rawTokens, rawExchangeSymbols) {
    if (!Array.isArray(rawTokens) || !Array.isArray(rawExchangeSymbols)) {
      return [];
    }

    const alphaNames = new Map();
    for (const token of rawTokens) {
      const alphaId = String(token?.alphaId || "").toUpperCase();
      const humanSymbol = String(token?.symbol || "").toUpperCase();
      if (!alphaId || !humanSymbol) {
        continue;
      }
      alphaNames.set(alphaId, humanSymbol);
    }

    const items = rawExchangeSymbols
      .filter((entry) => entry?.status === "TRADING")
      .map((entry) => {
        const baseAsset = String(entry?.baseAsset || "").toUpperCase();
        const quoteAsset = String(entry?.quoteAsset || "").toUpperCase();
        const exchangeSymbol = String(entry?.symbol || "").toUpperCase();
        const humanBase = alphaNames.get(baseAsset);
        if (!humanBase || !quoteAsset || !exchangeSymbol) {
          return null;
        }

        return {
          marketType: "alpha",
          displaySymbol: `${humanBase}${quoteAsset}`,
          requestSymbol: exchangeSymbol,
          symbol: `${humanBase}${quoteAsset}`,
          baseAsset: humanBase,
          quoteAsset
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.displaySymbol.localeCompare(right.displaySymbol));

    return items;
  }

  function applyBinanceSymbols(items) {
    state.symbolCatalog.items = items;
    state.symbolCatalog.index = new Set(items.map((item) => item.symbol));
    state.symbolCatalog.loaded = items.length > 0;
    renderSymbolDatalist();
    updateSymbolInputHints();
  }

  function applyAlphaSymbols(items) {
    state.alphaCatalog.items = items;
    state.alphaCatalog.index = new Set(items.map((item) => item.displaySymbol));
    state.alphaCatalog.byDisplay = new Map(items.map((item) => [item.displaySymbol, item]));
    state.alphaCatalog.loaded = items.length > 0;
    renderSymbolDatalist();
    updateSymbolInputHints();
  }

  function renderSymbolDatalist() {
    if (!dom.symbolList) {
      return;
    }

    const seen = new Set();
    const items = [];

    for (const item of state.symbolCatalog.items) {
      if (seen.has(item.displaySymbol)) {
        continue;
      }
      seen.add(item.displaySymbol);
      items.push(item);
    }

    for (const item of state.alphaCatalog.items) {
      if (seen.has(item.displaySymbol)) {
        continue;
      }
      seen.add(item.displaySymbol);
      items.push(item);
    }

    dom.symbolList.innerHTML = items
      .map((item) => {
        const marketLabel = item.marketType === "alpha" ? "Binance Alpha" : "Binance Spot";
        return `<option value="${item.displaySymbol}" label="${item.baseAsset}/${item.quoteAsset} • ${marketLabel}"></option>`;
      })
      .join("");
  }

  function updateSymbolInputHints() {
    const count = state.symbolCatalog.items.length + state.alphaCatalog.items.length;
    const hint = count ? `Search ${count} Binance pairs and Alpha markets` : "Search Binance pair";

    configureSymbolInput(dom.symbolInput);
    dom.symbolInput.placeholder = hint;
    dom.symbolInput.title = hint;

    state.multiCharts.forEach((slot) => {
      if (!slot?.symbolInput) {
        return;
      }
      configureSymbolInput(slot.symbolInput);
      slot.symbolInput.placeholder = hint;
      slot.symbolInput.title = hint;
    });
  }

  function normalizeSymbolInputValue(raw) {
    const symbol = sanitizeSymbol(raw);
    if (!symbol) {
      return null;
    }

    return symbol;
  }

  async function resolveMarketSymbol(symbol) {
    const normalized = normalizeSymbolInputValue(symbol);
    if (!normalized) {
      return null;
    }

    if (state.symbolCatalog.index.has(normalized)) {
      return {
        marketType: "spot",
        displaySymbol: normalized,
        requestSymbol: normalized
      };
    }

    await loadBinanceSymbols(true);
    if (state.symbolCatalog.index.has(normalized)) {
      return {
        marketType: "spot",
        displaySymbol: normalized,
        requestSymbol: normalized
      };
    }

    await loadAlphaSymbols(true);
    const alphaItem = state.alphaCatalog.byDisplay.get(normalized);
    if (alphaItem) {
      return {
        marketType: "alpha",
        displaySymbol: alphaItem.displaySymbol,
        requestSymbol: alphaItem.requestSymbol
      };
    }

    return null;
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
              <input class="multi-symbol" type="text" value="${symbol}" spellcheck="false" autocomplete="off" list="symbol-list" />
              <span class="multi-status">Loading</span>
            </div>
            <div class="multi-ai-head">
              <span class="multi-ai-status neutral">AI idle</span>
              <span class="multi-ai-levels">S -- • R --</span>
            </div>
            <div class="multi-ai-timeframes"></div>
            <div class="multi-pane multi-pane-main">
              <div class="multi-chart"></div>
            </div>
            <div class="multi-pane multi-pane-sub multi-rsi-pane">
              <div class="multi-rsi-chart"></div>
            </div>
            <div class="multi-pane multi-pane-sub multi-macd-pane">
              <div class="multi-macd-chart"></div>
            </div>
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
      const mainPane = card.querySelector(".multi-pane-main");
      const rsiPane = card.querySelector(".multi-rsi-pane");
      const macdPane = card.querySelector(".multi-macd-pane");
      const chartNode = card.querySelector(".multi-chart");
      const rsiNode = card.querySelector(".multi-rsi-chart");
      const macdNode = card.querySelector(".multi-macd-chart");
      configureSymbolInput(symbolInput);

      const chart = LightweightCharts.createChart(chartNode, buildPriceChartOptions(palette));
      chart.priceScale("").applyOptions({
        scaleMargins: {
          top: 0.78,
          bottom: 0
        }
      });

      const candleSeries = chart.addCandlestickSeries(candleSeriesOptions(palette));
      const lineSeries = chart.addLineSeries({
        color: palette.aux1,
        lineWidth: 2,
        priceLineVisible: false
      });
      const areaSeries = chart.addAreaSeries({
        lineColor: palette.aux1,
        topColor: colorWithAlpha(palette.aux1, 0.35),
        bottomColor: colorWithAlpha(palette.aux1, 0.03),
        lineWidth: 2,
        priceLineVisible: false
      });
      const baselineSeries = chart.addBaselineSeries({
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
      const volumeSeries = chart.addHistogramSeries({
        priceScaleId: "",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false
      });
      const smaSeries = chart.addLineSeries({
        color: palette.accent,
        lineWidth: 1.5,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const emaSeries = chart.addLineSeries({
        color: palette.aux2,
        lineWidth: 1.5,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const bbUpperSeries = chart.addLineSeries({
        color: colorWithAlpha(palette.aux3, 0.95),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const bbLowerSeries = chart.addLineSeries({
        color: colorWithAlpha(palette.aux3, 0.95),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const bbMiddleSeries = chart.addLineSeries({
        color: colorWithAlpha(palette.aux3, 0.95),
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.SparseDotted,
        lastValueVisible: false,
        priceLineVisible: false
      });

      const rsiChart = LightweightCharts.createChart(rsiNode, buildSubChartOptions(palette));
      rsiChart.timeScale().applyOptions({ visible: false });
      const rsiSeries = rsiChart.addLineSeries({
        color: palette.aux1,
        lineWidth: 1.5,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const rsiUpperSeries = rsiChart.addLineSeries({
        color: colorWithAlpha(palette.down, 0.9),
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const rsiLowerSeries = rsiChart.addLineSeries({
        color: colorWithAlpha(palette.up, 0.9),
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false
      });

      const macdChart = LightweightCharts.createChart(macdNode, buildSubChartOptions(palette));
      macdChart.timeScale().applyOptions({ visible: false });
      const macdLineSeries = macdChart.addLineSeries({
        color: palette.aux1,
        lineWidth: 1.5,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const macdSignalSeries = macdChart.addLineSeries({
        color: palette.warn,
        lineWidth: 1.5,
        lastValueVisible: false,
        priceLineVisible: false
      });
      const macdHistSeries = macdChart.addHistogramSeries({
        priceLineVisible: false,
        lastValueVisible: false
      });

      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) {
          return;
        }
        rsiChart.timeScale().setVisibleLogicalRange(range);
        macdChart.timeScale().setVisibleLogicalRange(range);
      });
      chart.timeScale().applyOptions({ rightOffset: 3 });

      const slot = {
        index,
        symbol: sanitizeSymbol(symbolInput.value) || MULTI_DEFAULT_SYMBOLS[index] || "BTCUSDT",
        candles: [],
        card,
        mainPane,
        rsiPane,
        macdPane,
        chart,
        rsiChart,
        macdChart,
        chartNode,
        rsiNode,
        macdNode,
        candleSeries,
        lineSeries,
        areaSeries,
        baselineSeries,
        volumeSeries,
        smaSeries,
        emaSeries,
        bbUpperSeries,
        bbLowerSeries,
        bbMiddleSeries,
        rsiSeries,
        rsiUpperSeries,
        rsiLowerSeries,
        macdLineSeries,
        macdSignalSeries,
        macdHistSeries,
        symbolInput,
        statusNode,
        aiStatusNode,
        aiLevelsNode,
        aiTimeframesNode,
        market: {
          marketType: "spot",
          displaySymbol: sanitizeSymbol(symbolInput.value) || MULTI_DEFAULT_SYMBOLS[index] || "BTCUSDT",
          requestSymbol: sanitizeSymbol(symbolInput.value) || MULTI_DEFAULT_SYMBOLS[index] || "BTCUSDT"
        },
        ws: null,
        pollTimer: null,
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

      applyMultiRsiFixedScale(slot);
      setMultiAiStatus(slot, "neutral", "AI idle");
      updateMultiAiSummary(slot);

      symbolInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        commitMultiSymbolInput(slot);
      });

      symbolInput.addEventListener("change", () => {
        commitMultiSymbolInput(slot);
      });

      return slot;
    });

    updateSymbolInputHints();
    updateMultiPaneVisibility();
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
      const market = await resolveMarketSymbol(slot.symbol);
      if (nonce !== slot.nonce || !isMultiMode()) {
        return;
      }

      if (!market) {
        slot.market = {
          marketType: "spot",
          displaySymbol: slot.symbol,
          requestSymbol: slot.symbol
        };
        slot.candles = [];
        renderMultiPriceSeriesForSlot(slot);
        renderMultiIndicatorsForSlot(slot);
        slot.statusNode.textContent = "Not on Binance";
        slot.statusNode.title = `${slot.symbol} is not available on Binance Spot or Binance Alpha.`;
        setMultiAiStatus(slot, "error", "AI wait");
        return;
      }

      slot.market = market;
      slot.symbol = market.displaySymbol;
      slot.symbolInput.value = market.displaySymbol;
      if (slot.index === 0) {
        state.symbol = market.displaySymbol;
        dom.symbolInput.value = market.displaySymbol;
      }

      const { candles, ticker } = await fetchMarketSnapshot(market, state.interval);
      if (nonce !== slot.nonce || !isMultiMode()) {
        return;
      }

      slot.candles = candles.map(toCandle).filter(Boolean);
      renderMultiPriceSeriesForSlot(slot);
      renderMultiIndicatorsForSlot(slot);
      slot.chart.timeScale().fitContent();
      slot.rsiChart.timeScale().fitContent();
      slot.macdChart.timeScale().fitContent();

      const last = slot.candles[slot.candles.length - 1];
      const marketTag = market.marketType === "alpha" ? " • Alpha" : "";
      const changePct = Number(ticker?.priceChangePercent);
      const pctText = Number.isFinite(changePct) ? ` • ${changePct.toFixed(2)}%` : "";
      slot.statusNode.textContent = last ? `${formatPrice(last.close)} • ${state.interval}${marketTag}${pctText}` : `No data • ${state.interval}`;
      slot.statusNode.title = market.marketType === "alpha" ? `${market.displaySymbol} via Binance Alpha` : market.displaySymbol;
      if (market.marketType === "alpha") {
        setMultiAiStatus(slot, "neutral", "AI Alpha off");
        openMultiSlotPoller(slot, nonce);
      } else {
        runAiForMultiSlot(slot, true);
        openMultiSlotSocket(slot, nonce);
      }
    } catch {
      if (nonce !== slot.nonce) {
        return;
      }
      slot.statusNode.textContent = "Load failed";
      setMultiAiStatus(slot, "error", "AI wait");
    }
  }

  function openMultiSlotSocket(slot, nonce) {
    if (slot.market?.marketType === "alpha") {
      return;
    }

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
        renderMultiPriceSeriesForSlot(slot);
        renderMultiIndicatorsForSlot(slot);
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

  function openMultiSlotPoller(slot, nonce) {
    if (slot.pollTimer) {
      clearInterval(slot.pollTimer);
    }

    slot.pollTimer = setInterval(async () => {
      if (slot.nonce !== nonce || !isMultiMode() || slot.market?.marketType !== "alpha") {
        return;
      }

      try {
        const [raw, ticker] = await Promise.all([
          fetchLatestMarketCandles(slot.market, state.interval, 3),
          fetchMarketTicker(slot.market)
        ]);

        if (slot.nonce !== nonce || !isMultiMode() || slot.market?.marketType !== "alpha") {
          return;
        }

        const latest = (raw || []).map(toCandle).filter(Boolean).slice(-2);
        latest.forEach((candle) => upsertMultiSlotCandle(slot, candle));
        renderMultiPriceSeriesForSlot(slot);
        renderMultiIndicatorsForSlot(slot);

        const last = slot.candles[slot.candles.length - 1];
        const changePct = Number(ticker?.priceChangePercent);
        const pctText = Number.isFinite(changePct) ? ` • ${changePct.toFixed(2)}%` : "";
        slot.statusNode.textContent = last
          ? `${formatPrice(last.close)} • ${state.interval} • Alpha${pctText}`
          : `No data • ${state.interval}`;
      } catch {
        // Ignore polling errors and keep the last rendered alpha state.
      }
    }, 4000);
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
    if (slot.pollTimer) {
      clearInterval(slot.pollTimer);
      slot.pollTimer = null;
    }

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
      slot.chart?.remove();
      slot.rsiChart?.remove();
      slot.macdChart?.remove();
    });

    state.multiCharts = [];
    dom.multiGrid.innerHTML = "";
  }

  function resizeMultiCharts() {
    if (!isMultiMode()) {
      return;
    }

    state.multiCharts.forEach((slot) => {
      if (slot.chartNode && slot.chart) {
        const width = slot.chartNode.clientWidth;
        const height = slot.chartNode.clientHeight;
        if (width > 0 && height > 0) {
          slot.chart.resize(width, height);
        }
      }

      if (state.indicators.rsi && slot.rsiNode && slot.rsiChart) {
        const rsiWidth = slot.rsiNode.clientWidth;
        const rsiHeight = slot.rsiNode.clientHeight;
        if (rsiWidth > 0 && rsiHeight > 0) {
          slot.rsiChart.resize(rsiWidth, rsiHeight);
        }
      }

      if (state.indicators.macd && slot.macdNode && slot.macdChart) {
        const macdWidth = slot.macdNode.clientWidth;
        const macdHeight = slot.macdNode.clientHeight;
        if (macdWidth > 0 && macdHeight > 0) {
          slot.macdChart.resize(macdWidth, macdHeight);
        }
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
      slot.candleSeries.applyOptions(candleSeriesOptions(palette));
      slot.lineSeries.applyOptions({ color: palette.aux1 });
      slot.areaSeries.applyOptions({
        lineColor: palette.aux1,
        topColor: colorWithAlpha(palette.aux1, 0.35),
        bottomColor: colorWithAlpha(palette.aux1, 0.03)
      });
      slot.baselineSeries.applyOptions({
        topLineColor: palette.up,
        bottomLineColor: palette.down,
        topFillColor1: colorWithAlpha(palette.up, 0.28),
        topFillColor2: colorWithAlpha(palette.up, 0.03),
        bottomFillColor1: colorWithAlpha(palette.down, 0.23),
        bottomFillColor2: colorWithAlpha(palette.down, 0.03)
      });
      slot.volumeSeries.applyOptions({});
      slot.smaSeries.applyOptions({ color: palette.accent });
      slot.emaSeries.applyOptions({ color: palette.aux2 });
      slot.bbUpperSeries.applyOptions({ color: colorWithAlpha(palette.aux3, 0.95) });
      slot.bbLowerSeries.applyOptions({ color: colorWithAlpha(palette.aux3, 0.95) });
      slot.bbMiddleSeries.applyOptions({ color: colorWithAlpha(palette.aux3, 0.95) });
      slot.rsiChart.applyOptions(buildSubChartOptions(palette));
      slot.macdChart.applyOptions(buildSubChartOptions(palette));
      slot.rsiSeries.applyOptions({ color: palette.aux1 });
      slot.rsiUpperSeries.applyOptions({ color: colorWithAlpha(palette.down, 0.9) });
      slot.rsiLowerSeries.applyOptions({ color: colorWithAlpha(palette.up, 0.9) });
      slot.macdLineSeries.applyOptions({ color: palette.aux1 });
      slot.macdSignalSeries.applyOptions({ color: palette.warn });
      renderMultiPriceSeriesForSlot(slot);
      applyMultiRsiFixedScale(slot);
      renderMultiIndicatorsForSlot(slot);
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
    if (state.market?.marketType === "alpha") {
      return;
    }

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
    const market = state.market;

    if (!symbol || !interval || !market?.requestSymbol) {
      return;
    }

    try {
      const [raw, ticker] = await Promise.all([fetchLatestMarketCandles(market, interval, 3), fetchMarketTicker(market)]);
      if (
        isMultiMode() ||
        symbol !== state.symbol ||
        interval !== state.interval ||
        market.requestSymbol !== state.market?.requestSymbol
      ) {
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
      const last = state.candles[state.candles.length - 1];
      const changePct = Number(ticker?.priceChangePercent);
      const lastPriceText = last ? formatPrice(last.close) : "--";
      const pctText = Number.isFinite(changePct) ? `${changePct.toFixed(2)}%` : "--";
      const marketTag = market.marketType === "alpha" ? " • Alpha" : "";
      dom.marketTitle.textContent = `${state.symbol} • ${state.interval} • ${lastPriceText} (${pctText})${marketTag}`;
    } catch {
      // Ignore polling failures; websocket remains primary source.
    }
  }

  function updateSocketBadge() {
    if (isMultiMode()) {
      return;
    }

    if (state.market?.marketType === "alpha") {
      setStatus("connected", "Alpha Live");
      return;
    }

    const sockets = Object.values(state.sockets);
    const openCount = sockets.filter((ws) => ws.readyState === WebSocket.OPEN).length;

    if (openCount >= 1) {
      setStatus("connected", "Live");
      return;
    }

    if (openCount > 0) {
      setStatus("neutral", `Connecting ${openCount}/1`);
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
    if (!dom.orderbook) {
      return;
    }

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
    if (!dom.trades) {
      return;
    }

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
