'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');

loadEnv(path.join(process.cwd(), '.env'));

const PORT = Number(process.env.PORT || 8080);
const ROOT_DIR = process.cwd();
const BINANCE_REST_BASE = 'https://data-api.binance.vision/api/v3';
const BINANCE_NEWS_API = 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=10';
const COINBASE_STATUS_ATOM = 'https://status.coinbase.com/history.atom';
const COINDESK_RSS = 'https://www.coindesk.com/arc/outboundfeeds/rss/';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const TELEGRAM_CHANNELS = (process.env.TELEGRAM_CHANNELS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .slice(0, 6);

async function handleNodeRequest(req, res) {
  try {
    const requestUrl = createRequestUrl(req);

    if (requestUrl.pathname === '/api/ai/analyze' && req.method === 'GET') {
      await handleAiAnalyze(req, requestUrl, res);
      return;
    }

    if (requestUrl.pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, buildHealthPayload());
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }

    await serveStatic(requestUrl.pathname, res, req.method === 'HEAD');
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error?.message || 'Internal server error' });
  }
}

function createRequestUrl(req) {
  const host = req.headers?.host || 'localhost';
  return new URL(req.url || '/', `http://${host}`);
}

function buildHealthPayload() {
  return {
    ok: true,
    now: new Date().toISOString(),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  };
}

async function handleAiAnalyze(req, requestUrl, res) {
  const symbol = sanitizeSymbol(requestUrl.searchParams.get('symbol')) || 'BTCUSDT';
  const requestedInterval = normalizeInterval(requestUrl.searchParams.get('interval')) || '1m';
  const intervals = DEFAULT_INTERVALS;
  const requestApiKey = resolveGeminiApiKey(req.headers['x-gemini-api-key']);

  try {
    const [candlesByInterval, newsBundle] = await Promise.all([
      loadCandlesByInterval(symbol, intervals, 260),
      loadNewsBundle(symbol)
    ]);

    const deterministic = buildDeterministicAnalyses(symbol, candlesByInterval, intervals, newsBundle);
    const aiResult = await callGeminiForAnalysis(symbol, intervals, deterministic, newsBundle, requestApiKey);
    const merged = mergeAnalysis(deterministic, aiResult?.analysis || null);

    sendJson(res, 200, {
      ok: true,
      symbol,
      generatedAt: new Date().toISOString(),
      requestedInterval,
      intervals,
      model: {
        provider: aiResult ? 'gemini' : 'rules',
        name: aiResult?.model || null,
        fallbackUsed: !aiResult
      },
      news: newsBundle,
      analyses: merged,
      disclaimer:
        'AI analysis is probabilistic and for educational use. It is not financial advice. Always perform your own risk management.'
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error?.message || 'Unable to compute analysis',
      symbol,
      interval: requestedInterval
    });
  }
}

async function loadCandlesByInterval(symbol, intervals, limit) {
  const result = {};
  await Promise.all(
    intervals.map(async (interval) => {
      const url = `${BINANCE_REST_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const raw = await fetchJson(url, { timeoutMs: 9000 });
      result[interval] = (raw || []).map(toCandle).filter(Boolean);
    })
  );
  return result;
}

async function loadNewsBundle(symbol) {
  const baseAsset = baseFromSymbol(symbol);

  const [binanceItems, coinbaseItems, coindeskItems, telegramItems] = await Promise.all([
    fetchBinanceAnnouncements(),
    fetchCoinbaseStatus(),
    fetchCoinDeskHeadlines(),
    fetchTelegramSignals()
  ]);

  const allItems = [...binanceItems, ...coinbaseItems, ...coindeskItems, ...telegramItems]
    .filter((item) => item && item.title)
    .sort((a, b) => toMs(b.time) - toMs(a.time));

  const relevant = allItems.filter((item) => {
    const text = `${item.title} ${item.summary || ''}`.toLowerCase();
    return text.includes(baseAsset.toLowerCase()) || text.includes(symbol.toLowerCase());
  });

  const curated = (relevant.length ? relevant : allItems).slice(0, 20);

  return {
    sources: {
      binance: binanceItems.length,
      coinbase: coinbaseItems.length,
      coindesk: coindeskItems.length,
      telegram: telegramItems.length
    },
    sentimentScore: computeSentimentScore(curated),
    items: curated
  };
}

function buildDeterministicAnalyses(symbol, candlesByInterval, intervals, newsBundle) {
  const sentiment = Number(newsBundle.sentimentScore || 0);
  const output = {};

  for (const interval of intervals) {
    const candles = candlesByInterval[interval] || [];
    output[interval] = analyzeTimeframe(symbol, interval, candles, sentiment);
  }

  return output;
}

function analyzeTimeframe(symbol, interval, candles, sentimentScore) {
  if (!candles || candles.length < 80) {
    return {
      timeframe: interval,
      bias: 'neutral',
      confidence: 0.2,
      summary: 'Not enough market data for stable analysis.',
      trendLines: [],
      support: [],
      resistance: [],
      buyPoints: [],
      sellPoints: []
    };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2] || lastCandle;

  const emaFast = calcEma(closes, 20);
  const emaSlow = calcEma(closes, 50);
  const rsiSeries = calcRsi(closes, 14);
  const macdObj = calcMacd(closes, 12, 26, 9);
  const atrSeries = calcAtr(candles, 14);

  const lastEmaFast = emaFast[emaFast.length - 1] ?? lastCandle.close;
  const lastEmaSlow = emaSlow[emaSlow.length - 1] ?? lastCandle.close;
  const lastRsi = rsiSeries[rsiSeries.length - 1] ?? 50;
  const lastMacd = macdObj.macd[macdObj.macd.length - 1] ?? 0;
  const lastSignal = macdObj.signal[macdObj.signal.length - 1] ?? 0;
  const macdHist = lastMacd - lastSignal;
  const atr = atrSeries[atrSeries.length - 1] ?? Math.max(lastCandle.high - lastCandle.low, 0.0001);

  const swings = findSwingPoints(candles, 2);
  const levels = deriveSupportResistance(candles, swings, 3);
  const trendLines = deriveTrendLines(candles, swings);

  let biasScore = 0;
  if (lastEmaFast > lastEmaSlow) {
    biasScore += 1;
  } else {
    biasScore -= 1;
  }

  if (lastRsi > 56) {
    biasScore += 0.7;
  } else if (lastRsi < 44) {
    biasScore -= 0.7;
  }

  if (macdHist > 0) {
    biasScore += 0.8;
  } else {
    biasScore -= 0.8;
  }

  const momentum = (lastCandle.close - prevCandle.close) / Math.max(prevCandle.close, 1e-8);
  biasScore += clamp(momentum * 30, -0.7, 0.7);
  biasScore += clamp(sentimentScore * 0.5, -0.6, 0.6);

  const bias = biasScore > 0.5 ? 'bullish' : biasScore < -0.5 ? 'bearish' : 'neutral';

  const buyPoints = [];
  const sellPoints = [];

  const recentSignals = detectTradeSignals(candles, rsiSeries, macdObj.histogram);
  for (const signal of recentSignals) {
    if (signal.action === 'buy') {
      buyPoints.push(signal);
    } else {
      sellPoints.push(signal);
    }
  }

  if (buyPoints.length === 0 && levels.support.length > 0) {
    buyPoints.push({
      time: lastCandle.time,
      price: levels.support[0].price,
      confidence: clamp(0.56 + sentimentScore * 0.15, 0.25, 0.9),
      reason: 'Nearest support zone'
    });
  }

  if (sellPoints.length === 0 && levels.resistance.length > 0) {
    sellPoints.push({
      time: lastCandle.time,
      price: levels.resistance[0].price,
      confidence: clamp(0.56 - sentimentScore * 0.15, 0.25, 0.9),
      reason: 'Nearest resistance zone'
    });
  }

  const confidence = clamp(
    0.45 + Math.min(Math.abs(biasScore) * 0.12, 0.35) + Math.min(Math.abs(lastCandle.close - levels.mid) / Math.max(atr, 1e-8) * 0.03, 0.15),
    0.25,
    0.95
  );

  return {
    timeframe: interval,
    bias,
    confidence,
    summary: buildSummaryText({ bias, lastRsi, macdHist, sentimentScore, interval }),
    trendLines,
    support: levels.support,
    resistance: levels.resistance,
    buyPoints: buyPoints.slice(0, 4),
    sellPoints: sellPoints.slice(0, 4),
    indicators: {
      ema20: round(lastEmaFast),
      ema50: round(lastEmaSlow),
      rsi14: round(lastRsi),
      macdHistogram: round(macdHist),
      atr14: round(atr)
    }
  };
}

function buildSummaryText({ bias, lastRsi, macdHist, sentimentScore, interval }) {
  const momentumTag = macdHist > 0 ? 'positive' : 'negative';
  const rsiTag = lastRsi > 70 ? 'overbought' : lastRsi < 30 ? 'oversold' : 'balanced';
  const newsTag = sentimentScore > 0.15 ? 'news tailwind' : sentimentScore < -0.15 ? 'news headwind' : 'mixed news';
  return `${interval} shows ${bias} structure with ${momentumTag} momentum, RSI ${rsiTag}, and ${newsTag}.`;
}

function mergeAnalysis(base, aiAnalysis) {
  if (!aiAnalysis || typeof aiAnalysis !== 'object') {
    return base;
  }

  const merged = {};

  for (const timeframe of DEFAULT_INTERVALS) {
    const baseTf = base[timeframe] || {};
    const aiTf = aiAnalysis[timeframe];

    if (!aiTf || typeof aiTf !== 'object') {
      merged[timeframe] = baseTf;
      continue;
    }

    merged[timeframe] = {
      timeframe,
      bias: normalizeBias(aiTf.bias) || baseTf.bias,
      confidence: normalizeConfidence(aiTf.confidence, baseTf.confidence),
      summary: sanitizeText(aiTf.summary) || baseTf.summary,
      trendLines: normalizeTrendLines(aiTf.trendLines, baseTf.trendLines),
      support: normalizeLevels(aiTf.support, baseTf.support),
      resistance: normalizeLevels(aiTf.resistance, baseTf.resistance),
      buyPoints: normalizePoints(aiTf.buyPoints, baseTf.buyPoints, 'buy'),
      sellPoints: normalizePoints(aiTf.sellPoints, baseTf.sellPoints, 'sell'),
      indicators: baseTf.indicators
    };
  }

  return merged;
}

async function callGeminiForAnalysis(symbol, intervals, deterministic, newsBundle, requestApiKey) {
  const apiKey = resolveGeminiApiKey(requestApiKey) || resolveGeminiApiKey(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    return null;
  }

  const models = [
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash',
    'gemini-2.0-flash'
  ]
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const payload = {
    symbol,
    intervals,
    deterministic,
    news: {
      sentimentScore: newsBundle.sentimentScore,
      items: newsBundle.items.slice(0, 12)
    }
  };

  const prompt = [
    'You are a crypto market analyst.',
    'Task: refine a deterministic multi-timeframe analysis using the provided indicators and news.',
    'Rules:',
    '- Return STRICT JSON only. No markdown.',
    '- Keep exactly these keys at top level: 1m,5m,15m,1h,4h,1d',
    '- For each timeframe return keys:',
    '  bias (bullish|bearish|neutral), confidence (0..1), summary (short),',
    '  trendLines[{label,fromTime,toTime,fromPrice,toPrice,confidence}],',
    '  support[{price,confidence,note}], resistance[{price,confidence,note}],',
    '  buyPoints[{time,price,confidence,reason}], sellPoints[{time,price,confidence,reason}]',
    '- Keep prices realistic for each timeframe close range.',
    '- Do not produce empty arrays unless data is truly missing.',
    '- Be conservative when confidence is low.',
    '',
    JSON.stringify(payload)
  ].join('\n');

  for (const model of models) {
    try {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        }),
        signal: AbortSignal.timeout(18000)
      });

      if (!response.ok) {
        continue;
      }

      const raw = await response.json();
      const text =
        raw?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('')?.trim() || '';

      if (!text) {
        continue;
      }

      const parsed = parseJsonFromModel(text);
      if (!parsed || typeof parsed !== 'object') {
        continue;
      }

      return {
        model,
        analysis: parsed
      };
    } catch {
      // Try next model.
    }
  }

  return null;
}

async function fetchBinanceAnnouncements() {
  try {
    const data = await fetchJson(BINANCE_NEWS_API, { timeoutMs: 9000 });
    const catalogs = data?.data?.catalogs || [];
    const articles = catalogs.flatMap((catalog) => catalog?.articles || []);

    return articles.slice(0, 12).map((article) => ({
      source: 'Binance',
      title: article.title || '',
      summary: '',
      time: toIso(article.releaseDate),
      url: article.code ? `https://www.binance.com/en/support/announcement/detail/${article.code}` : null
    }));
  } catch {
    return [];
  }
}

async function fetchCoinbaseStatus() {
  try {
    const xml = await fetchText(COINBASE_STATUS_ATOM, { timeoutMs: 9000 });
    const entries = parseAtomEntries(xml, 8);

    return entries.map((entry) => ({
      source: 'Coinbase',
      title: entry.title,
      summary: entry.summary || '',
      time: entry.time,
      url: entry.url
    }));
  } catch {
    return [];
  }
}

async function fetchCoinDeskHeadlines() {
  try {
    const xml = await fetchText(COINDESK_RSS, { timeoutMs: 9000 });
    const items = parseRssItems(xml, 10);

    return items.map((item) => ({
      source: 'CoinDesk',
      title: item.title,
      summary: item.summary || '',
      time: item.time,
      url: item.url
    }));
  } catch {
    return [];
  }
}

async function fetchTelegramSignals() {
  if (!TELEGRAM_CHANNELS.length) {
    return [];
  }

  const collected = await Promise.all(
    TELEGRAM_CHANNELS.map(async (channel) => {
      try {
        const html = await fetchText(`https://t.me/s/${encodeURIComponent(channel)}`, { timeoutMs: 9000 });
        const messages = parseTelegramMessages(html, channel).slice(0, 4);
        return messages;
      } catch {
        return [];
      }
    })
  );

  return collected.flat();
}

function parseTelegramMessages(html, channel) {
  const messageBlocks = [...html.matchAll(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g)];
  const dateBlocks = [...html.matchAll(/<time[^>]*datetime="([^"]+)"/g)];

  const messages = [];
  for (let i = 0; i < Math.min(messageBlocks.length, dateBlocks.length); i += 1) {
    const text = stripTags(messageBlocks[i][1] || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      continue;
    }

    messages.push({
      source: `Telegram:${channel}`,
      title: text.slice(0, 180),
      summary: text,
      time: toIso(dateBlocks[i][1]),
      url: `https://t.me/s/${channel}`
    });
  }

  return messages;
}

function parseRssItems(xml, maxItems) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return items.slice(0, maxItems).map((match) => {
    const block = match[1] || '';
    return {
      title: decodeEntities(getTagValue(block, 'title')),
      summary: decodeEntities(getTagValue(block, 'description')),
      time: toIso(getTagValue(block, 'pubDate')),
      url: decodeEntities(getTagValue(block, 'link'))
    };
  });
}

function parseAtomEntries(xml, maxItems) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.slice(0, maxItems).map((match) => {
    const block = match[1] || '';
    const hrefMatch = block.match(/<link[^>]*href="([^"]+)"/);
    const rawContent = decodeEntities(getTagValue(block, 'content'));

    return {
      title: decodeEntities(getTagValue(block, 'title')),
      summary: stripTags(rawContent).replace(/\s+/g, ' ').trim(),
      time: toIso(getTagValue(block, 'updated') || getTagValue(block, 'published')),
      url: hrefMatch ? hrefMatch[1] : ''
    };
  });
}

function findSwingPoints(candles, width) {
  const highs = [];
  const lows = [];

  for (let i = width; i < candles.length - width; i += 1) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = i - width; j <= i + width; j += 1) {
      if (j === i) {
        continue;
      }
      if (candles[j].high >= current.high) {
        isHigh = false;
      }
      if (candles[j].low <= current.low) {
        isLow = false;
      }
    }

    if (isHigh) {
      highs.push({ index: i, time: current.time, price: current.high });
    }

    if (isLow) {
      lows.push({ index: i, time: current.time, price: current.low });
    }
  }

  return { highs, lows };
}

function deriveSupportResistance(candles, swings, targetCount) {
  const closes = candles.map((c) => c.close);
  const current = closes[closes.length - 1] || 0;
  const avg = current || 1;
  const tolerance = Math.max(avg * 0.004, 1e-8);

  const supportClusters = clusterLevels(swings.lows.map((point) => point.price), tolerance)
    .sort((a, b) => b.hits - a.hits)
    .map((cluster) => cluster.price)
    .filter((price) => price <= current)
    .slice(0, targetCount);

  const resistanceClusters = clusterLevels(swings.highs.map((point) => point.price), tolerance)
    .sort((a, b) => b.hits - a.hits)
    .map((cluster) => cluster.price)
    .filter((price) => price >= current)
    .slice(0, targetCount);

  const support = (supportClusters.length ? supportClusters : [Math.min(...closes)])
    .slice(0, targetCount)
    .map((price, idx) => ({
      price: round(price),
      confidence: round(clamp(0.55 - idx * 0.08, 0.3, 0.88)),
      note: idx === 0 ? 'Nearest support' : 'Secondary support'
    }));

  const resistance = (resistanceClusters.length ? resistanceClusters : [Math.max(...closes)])
    .slice(0, targetCount)
    .map((price, idx) => ({
      price: round(price),
      confidence: round(clamp(0.55 - idx * 0.08, 0.3, 0.88)),
      note: idx === 0 ? 'Nearest resistance' : 'Secondary resistance'
    }));

  return {
    support,
    resistance,
    mid: current
  };
}

function deriveTrendLines(candles, swings) {
  const lines = [];

  const recentLows = swings.lows.slice(-6);
  const recentHighs = swings.highs.slice(-6);

  const upPair = findSlopePair(recentLows, (a, b) => b.price > a.price);
  if (upPair) {
    lines.push({
      label: 'uptrend',
      fromTime: upPair.from.time,
      toTime: upPair.to.time,
      fromPrice: round(upPair.from.price),
      toPrice: round(upPair.to.price),
      confidence: round(upPair.confidence)
    });
  }

  const downPair = findSlopePair(recentHighs, (a, b) => b.price < a.price);
  if (downPair) {
    lines.push({
      label: 'downtrend',
      fromTime: downPair.from.time,
      toTime: downPair.to.time,
      fromPrice: round(downPair.from.price),
      toPrice: round(downPair.to.price),
      confidence: round(downPair.confidence)
    });
  }

  if (!lines.length) {
    const first = candles[Math.max(0, candles.length - 30)];
    const last = candles[candles.length - 1];
    lines.push({
      label: 'price-drift',
      fromTime: first.time,
      toTime: last.time,
      fromPrice: round(first.close),
      toPrice: round(last.close),
      confidence: 0.4
    });
  }

  return lines;
}

function findSlopePair(points, validator) {
  if (points.length < 2) {
    return null;
  }

  for (let i = points.length - 2; i >= 0; i -= 1) {
    for (let j = points.length - 1; j > i; j -= 1) {
      const from = points[i];
      const to = points[j];
      if (!validator(from, to)) {
        continue;
      }

      const bars = Math.max(to.index - from.index, 1);
      const slope = Math.abs((to.price - from.price) / bars);
      const confidence = clamp(0.45 + Math.min(slope / Math.max(from.price, 1e-8) * 400, 0.4), 0.35, 0.9);
      return { from, to, confidence };
    }
  }

  return null;
}

function detectTradeSignals(candles, rsiSeries, macdHistogram) {
  const out = [];

  for (let i = 2; i < candles.length; i += 1) {
    const rsi = rsiSeries[i] ?? 50;
    const hist = macdHistogram[i] ?? 0;
    const prevHist = macdHistogram[i - 1] ?? hist;

    if (rsi < 37 && hist > 0 && prevHist <= 0) {
      out.push({
        action: 'buy',
        time: candles[i].time,
        price: round(candles[i].close),
        confidence: round(clamp(0.58 + (37 - rsi) * 0.01, 0.3, 0.92)),
        reason: 'RSI recovery with bullish MACD crossover'
      });
      continue;
    }

    if (rsi > 63 && hist < 0 && prevHist >= 0) {
      out.push({
        action: 'sell',
        time: candles[i].time,
        price: round(candles[i].close),
        confidence: round(clamp(0.58 + (rsi - 63) * 0.01, 0.3, 0.92)),
        reason: 'RSI elevated with bearish MACD crossover'
      });
    }
  }

  return out.slice(-6);
}

function clusterLevels(levels, tolerance) {
  const clusters = [];

  for (const level of levels) {
    const existing = clusters.find((cluster) => Math.abs(cluster.price - level) <= tolerance);
    if (!existing) {
      clusters.push({ price: level, hits: 1 });
      continue;
    }
    existing.price = (existing.price * existing.hits + level) / (existing.hits + 1);
    existing.hits += 1;
  }

  return clusters;
}

function calcEma(values, period) {
  if (!values.length) {
    return [];
  }

  const result = new Array(values.length);
  const k = 2 / (period + 1);
  let seed = 0;
  const seedCount = Math.min(period, values.length);

  for (let i = 0; i < seedCount; i += 1) {
    seed += values[i];
  }

  let ema = seed / seedCount;

  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      result[i] = ema;
      continue;
    }

    if (i === period - 1) {
      result[i] = ema;
      continue;
    }

    ema = values[i] * k + ema * (1 - k);
    result[i] = ema;
  }

  return result;
}

function calcRsi(closes, period) {
  if (closes.length <= period) {
    return closes.map(() => 50);
  }

  const result = new Array(closes.length).fill(50);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      gains += diff;
    } else {
      losses += Math.abs(diff);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < closes.length; i += 1) {
    if (i > period) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

function calcMacd(closes, fast, slow, signal) {
  const fastEma = calcEma(closes, fast);
  const slowEma = calcEma(closes, slow);
  const macd = closes.map((_, index) => (fastEma[index] ?? closes[index]) - (slowEma[index] ?? closes[index]));
  const signalLine = calcEma(macd, signal);
  const histogram = macd.map((value, index) => value - (signalLine[index] ?? 0));

  return {
    macd,
    signal: signalLine,
    histogram
  };
}

function calcAtr(candles, period) {
  if (!candles.length) {
    return [];
  }

  const trueRanges = [];
  for (let i = 0; i < candles.length; i += 1) {
    const current = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : current.close;

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );

    trueRanges.push(tr);
  }

  return calcEma(trueRanges, period);
}

function computeSentimentScore(items) {
  if (!items.length) {
    return 0;
  }

  const positive = ['surge', 'rally', 'bull', 'approval', 'partnership', 'launch', 'growth', 'record', 'recovery'];
  const negative = ['hack', 'drop', 'bear', 'outage', 'delay', 'lawsuit', 'ban', 'exploit', 'liquidation'];

  let score = 0;
  for (const item of items) {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();

    for (const word of positive) {
      if (text.includes(word)) {
        score += 1;
      }
    }

    for (const word of negative) {
      if (text.includes(word)) {
        score -= 1;
      }
    }
  }

  return clamp(score / Math.max(items.length * 3, 1), -1, 1);
}

function parseJsonFromModel(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

function normalizeTrendLines(input, fallback) {
  if (!Array.isArray(input)) {
    return fallback || [];
  }

  const normalized = input
    .map((line) => ({
      label: sanitizeText(line?.label) || 'trend',
      fromTime: normalizeUnix(line?.fromTime),
      toTime: normalizeUnix(line?.toTime),
      fromPrice: normalizeNumber(line?.fromPrice),
      toPrice: normalizeNumber(line?.toPrice),
      confidence: normalizeConfidence(line?.confidence, 0.5)
    }))
    .filter(
      (line) =>
        Number.isFinite(line.fromTime) &&
        Number.isFinite(line.toTime) &&
        Number.isFinite(line.fromPrice) &&
        Number.isFinite(line.toPrice)
    );

  return normalized.length ? normalized.slice(0, 5) : fallback || [];
}

function normalizeLevels(input, fallback) {
  if (!Array.isArray(input)) {
    return fallback || [];
  }

  const normalized = input
    .map((level) => ({
      price: normalizeNumber(level?.price),
      confidence: normalizeConfidence(level?.confidence, 0.45),
      note: sanitizeText(level?.note) || ''
    }))
    .filter((level) => Number.isFinite(level.price));

  return normalized.length ? normalized.slice(0, 6) : fallback || [];
}

function normalizePoints(input, fallback, side) {
  if (!Array.isArray(input)) {
    return fallback || [];
  }

  const normalized = input
    .map((point) => ({
      time: normalizeUnix(point?.time),
      price: normalizeNumber(point?.price),
      confidence: normalizeConfidence(point?.confidence, 0.45),
      reason: sanitizeText(point?.reason) || `${side.toUpperCase()} setup`
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price));

  return normalized.length ? normalized.slice(0, 6) : fallback || [];
}

function normalizeBias(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const lowered = value.toLowerCase();
  if (lowered === 'bullish' || lowered === 'bearish' || lowered === 'neutral') {
    return lowered;
  }

  return null;
}

function normalizeConfidence(value, fallback) {
  const normalized = normalizeNumber(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return clamp(normalized, 0, 1);
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function normalizeUnix(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return NaN;
  }
  if (number > 1e12) {
    return Math.floor(number / 1000);
  }
  return Math.floor(number);
}

function sanitizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function normalizeInterval(raw) {
  if (!raw) {
    return null;
  }
  const lowered = String(raw).toLowerCase();
  return DEFAULT_INTERVALS.includes(lowered) ? lowered : null;
}

function resolveGeminiApiKey(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\s+/g, '').trim();
  if (normalized.length < 12 || normalized.length > 240) {
    return '';
  }
  return normalized;
}

function sanitizeSymbol(raw) {
  if (!raw) {
    return null;
  }

  const cleaned = String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (cleaned.length < 5 || cleaned.length > 20) {
    return null;
  }

  return cleaned;
}

function baseFromSymbol(symbol) {
  const quotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB'];
  for (const quote of quotes) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return symbol.slice(0, -quote.length);
    }
  }
  return symbol;
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

async function serveStatic(requestPath, res, headOnly) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const targetPath = path.resolve(ROOT_DIR, `.${normalizedPath}`);

  if (!targetPath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }

  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType =
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon'
    }[ext] || 'application/octet-stream';

  const data = fs.readFileSync(targetPath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache'
  });

  if (headOnly) {
    res.end();
    return;
  }

  res.end(data);
}

async function fetchJson(url, { timeoutMs = 9000 } = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'BitCharts-Pro/1.0'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function fetchText(url, { timeoutMs = 9000 } = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'BitCharts-Pro/1.0'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.text();
}

function getTagValue(block, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = block.match(regex);
  return match ? match[1] : '';
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function toIso(value) {
  const time = new Date(value || Date.now());
  if (Number.isNaN(time.getTime())) {
    return new Date().toISOString();
  }
  return time.toISOString();
}

function toMs(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function round(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(8));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.setHeader?.('Cache-Control', 'no-store');
    res.status(statusCode).json(payload);
    return;
  }

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const idx = line.indexOf('=');
    if (idx <= 0) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

if (require.main === module) {
  const server = http.createServer(handleNodeRequest);
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`BitCharts Pro server listening on http://localhost:${PORT}`);
  });
}

module.exports = {
  buildHealthPayload,
  createRequestUrl,
  handleAiAnalyze,
  handleNodeRequest,
  sendJson
};
