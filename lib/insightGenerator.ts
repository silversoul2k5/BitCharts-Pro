import { Bar, TechnicalSummary } from './types';
import { rsi, macd, atr, supertrend, sma, ema } from './indicators';
import { formatPrice } from './format';

function pick(options: string[]): string {
  return options[Math.floor(Math.random() * options.length)];
}

function ratingOpeners(rating: TechnicalSummary['rating'], symbol: string, buy: number, sell: number, total: number): string {
  const opts: Record<TechnicalSummary['rating'], string[]> = {
    'Strong Buy': [
      `${symbol} is showing broad-based strength right now, with ${buy} of ${total} tracked signals leaning bullish.`,
      `The technical picture for ${symbol} is firmly bullish at the moment — ${buy} of ${total} indicators are aligned to the upside.`,
      `Momentum and trend readings are mostly in agreement here: ${symbol} comes out as a Strong Buy across ${buy} of ${total} signals.`,
    ],
    Buy: [
      `${symbol} leans bullish overall, with more indicators pointing up than down (${buy} buy vs ${sell} sell).`,
      `The setup here favors buyers on balance — ${buy} of ${total} signals are constructive, though it isn't unanimous.`,
      `There's a modest bullish tilt to the indicator mix for ${symbol} right now.`,
    ],
    Neutral: [
      `${symbol} is sitting in a fairly balanced spot technically, with signals split close to evenly between buy and sell.`,
      `No strong directional lean here: ${buy} bullish signals against ${sell} bearish ones points to a wait-and-see setup.`,
      `The indicator mix for ${symbol} isn't offering a clear edge either way at the moment.`,
    ],
    Sell: [
      `${symbol} leans bearish on balance, with ${sell} of ${total} signals pointing down against ${buy} pointing up.`,
      `There's a modest bearish tilt here — more indicators are flashing caution than confidence.`,
      `The setup favors sellers on balance right now for ${symbol}.`,
    ],
    'Strong Sell': [
      `${symbol} is under broad technical pressure, with ${sell} of ${total} signals leaning bearish.`,
      `The picture here is firmly bearish — most trend and momentum readings are aligned to the downside.`,
      `Sellers are clearly in control of the indicator mix for ${symbol} right now.`,
    ],
  };
  return pick(opts[rating]);
}

function trendSentence(score: number): string {
  // score: 3 = above SMA20, EMA50, and Supertrend bullish; down to 0 = none
  if (score >= 3) {
    return pick([
      'Price is trading above both its 20 and 50-period moving averages, and the Supertrend indicator is confirming the uptrend too.',
      'The short and medium-term trend structure is clearly bullish here — price is holding above its key moving averages.',
      'Trend-following indicators are stacked in favor of the bulls at this timeframe.',
    ]);
  }
  if (score === 2) {
    return pick([
      'The broader trend leans up, though not every trend indicator is fully aligned yet.',
      'Price is holding above at least one key moving average, keeping the near-term trend tilted bullish.',
    ]);
  }
  if (score === 1) {
    return pick([
      'Trend signals are mixed here — price is chopping around its key moving averages without a clear direction.',
      "It's a choppier trend picture at the moment, with price straddling its short-term averages.",
    ]);
  }
  return pick([
    'Price is trading below its key moving averages, and the Supertrend indicator has flipped bearish.',
    'The trend structure here is clearly bearish — price is under its short and medium-term averages.',
  ]);
}

function momentumSentence(rsiVal: number | null, macdBullish: boolean | null): string {
  const parts: string[] = [];
  if (rsiVal != null) {
    if (rsiVal < 30) {
      parts.push(
        pick([
          `RSI at ${rsiVal.toFixed(1)} is in oversold territory, which can sometimes precede a bounce — though oversold readings can also persist through strong downtrends.`,
          `At ${rsiVal.toFixed(1)}, RSI is deep in oversold territory.`,
        ])
      );
    } else if (rsiVal > 70) {
      parts.push(
        pick([
          `RSI at ${rsiVal.toFixed(1)} is in overbought territory, suggesting the recent move may be due for a pause.`,
          `RSI has pushed up to ${rsiVal.toFixed(1)}, an overbought reading worth watching for exhaustion.`,
        ])
      );
    } else {
      parts.push(
        pick([
          `RSI is sitting at a fairly neutral ${rsiVal.toFixed(1)}, not flagging either extreme.`,
          `At ${rsiVal.toFixed(1)}, RSI isn't near either overbought or oversold levels.`,
        ])
      );
    }
  }
  if (macdBullish != null) {
    parts.push(
      macdBullish
        ? pick(['The MACD line is above its signal line, a modestly bullish momentum tell.', 'MACD is reading bullish, with the line above signal.'])
        : pick(['The MACD line is below its signal line, a modestly bearish momentum tell.', 'MACD is reading bearish, with the line under signal.'])
    );
  }
  return parts.join(' ');
}

function volatilitySentence(atrPct: number | null): string {
  if (atrPct == null) return '';
  if (atrPct > 3) {
    return pick([
      `Volatility is running hot (ATR near ${atrPct.toFixed(1)}% of price), so expect bigger swings in either direction.`,
      `Expect wider-than-usual moves — ATR is elevated at about ${atrPct.toFixed(1)}% of price.`,
    ]);
  }
  return pick([
    `Volatility looks fairly contained right now (ATR around ${atrPct.toFixed(1)}% of price).`,
    `Price swings have been fairly measured lately, with ATR near ${atrPct.toFixed(1)}% of price.`,
  ]);
}

function watchSentence(price: number, recentHigh: number, recentLow: number): string {
  const distToHigh = Math.abs(recentHigh - price);
  const distToLow = Math.abs(price - recentLow);
  if (distToHigh <= distToLow) {
    return pick([
      `Worth watching: a clean break above ${formatPrice(recentHigh)} would strengthen the bullish case, while losing ${formatPrice(recentLow)} would flip the picture bearish.`,
      `Keep an eye on ${formatPrice(recentHigh)} as near-term resistance — a break there is the more bullish tell.`,
    ]);
  }
  return pick([
    `Worth watching: a slide under ${formatPrice(recentLow)} would confirm more downside, while reclaiming ${formatPrice(recentHigh)} would flip the picture bullish.`,
    `Keep an eye on ${formatPrice(recentLow)} as near-term support — losing it is the more bearish tell.`,
  ]);
}

export function generateInsight(symbol: string, interval: string, bars: Bar[], summary: TechnicalSummary): string {
  if (bars.length < 20) {
    return `Not enough live history has loaded yet for ${symbol} on the ${interval} chart to generate a reliable summary — try again in a moment, or switch to a longer timeframe.`;
  }

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const changePct = prev?.close ? ((last.close - prev.close) / prev.close) * 100 : 0;

  const rsiArr = rsi(bars, 14);
  const rsiVal = rsiArr[rsiArr.length - 1];

  const { macdLine, signal } = macd(bars);
  const mLast = macdLine[macdLine.length - 1];
  const sLast = signal[signal.length - 1];
  const macdBullish = mLast != null && sLast != null ? mLast > sLast : null;

  const atrArr = atr(bars, 14);
  const atrVal = atrArr[atrArr.length - 1];
  const atrPct = atrVal != null && last.close ? (atrVal / last.close) * 100 : null;

  const smaArr = sma(bars, 20);
  const emaArr = ema(bars, 50);
  const st = supertrend(bars, 10, 3);
  const stDir = st.direction[st.direction.length - 1];
  let trendScore = 0;
  const smaLast = smaArr[smaArr.length - 1];
  const emaLast = emaArr[emaArr.length - 1];
  if (smaLast != null && last.close > smaLast) trendScore++;
  if (emaLast != null && last.close > emaLast) trendScore++;
  if (stDir === 1) trendScore++;

  const recent = bars.slice(-20);
  const recentHigh = Math.max(...recent.map((b) => b.high));
  const recentLow = Math.min(...recent.map((b) => b.low));

  const lead = `${symbol} is trading at ${formatPrice(last.close)} on the ${interval.toUpperCase()} chart, ${
    changePct >= 0 ? 'up' : 'down'
  } ${Math.abs(changePct).toFixed(2)}% over the last candle.`;

  const sentences = [
    lead,
    ratingOpeners(summary.rating, symbol, summary.buy, summary.sell, summary.total),
    trendSentence(trendScore),
    momentumSentence(rsiVal, macdBullish),
    volatilitySentence(atrPct),
    watchSentence(last.close, recentHigh, recentLow),
    'This is a rule-based summary generated from the live indicator values above, not financial advice — crypto markets are highly volatile.',
  ].filter(Boolean);

  return sentences.join(' ');
}
