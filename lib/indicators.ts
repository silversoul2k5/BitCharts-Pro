import { Bar, TechnicalSummary } from './types';

export type Series = (number | null)[];

export function sma(bars: Bar[], period: number): Series {
  const result: Series = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

export function smaOnArray(arr: Series, period: number): Series {
  const result: Series = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) continue;
    let sum = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (j < 0 || arr[j] == null) { valid = false; break; }
      sum += arr[j] as number;
    }
    if (valid) result[i] = sum / period;
  }
  return result;
}

export function ema(bars: Bar[], period: number): Series {
  const result: Series = new Array(bars.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += bars[j].close;
      prev = sum / period;
      result[i] = prev;
    } else if (i >= period && prev != null) {
      prev = (bars[i].close - prev) * k + prev;
      result[i] = prev;
    }
  }
  return result;
}

export function bollinger(bars: Bar[], period: number, mult: number) {
  const mid = sma(bars, period);
  const upper: Series = new Array(bars.length).fill(null);
  const lower: Series = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    let sumSq = 0;
    const midVal = mid[i] as number;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(bars[j].close - midVal, 2);
    const std = Math.sqrt(sumSq / period);
    upper[i] = midVal + mult * std;
    lower[i] = midVal - mult * std;
  }
  return { mid, upper, lower };
}

export function rsi(bars: Bar[], period = 14): Series {
  const result: Series = new Array(bars.length).fill(null);
  if (bars.length <= period) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = bars[i].close - bars[i - 1].close;
    gainSum += Math.max(change, 0);
    lossSum += Math.max(-change, 0);
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = Math.max(change, 0), loss = Math.max(-change, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function macd(bars: Bar[], fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(bars, fast);
  const emaSlow = ema(bars, slow);
  const macdLine: Series = bars.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  );
  const signal: Series = new Array(bars.length).fill(null);
  const k = 2 / (signalPeriod + 1);
  let prev: number | null = null;
  let count = 0;
  for (let i = 0; i < bars.length; i++) {
    if (macdLine[i] == null) continue;
    count++;
    if (count === signalPeriod) {
      let sum = 0;
      for (let j = i - signalPeriod + 1; j <= i; j++) sum += macdLine[j] as number;
      prev = sum / signalPeriod;
      signal[i] = prev;
    } else if (count > signalPeriod && prev != null) {
      prev = ((macdLine[i] as number) - prev) * k + prev;
      signal[i] = prev;
    }
  }
  const histogram: Series = bars.map((_, i) =>
    macdLine[i] != null && signal[i] != null ? (macdLine[i] as number) - (signal[i] as number) : null
  );
  return { macdLine, signal, histogram };
}

export function stochastic(bars: Bar[], period = 14, smoothK = 3, smoothD = 3) {
  const rawK: Series = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j].high);
      ll = Math.min(ll, bars[j].low);
    }
    rawK[i] = hh === ll ? 50 : ((bars[i].close - ll) / (hh - ll)) * 100;
  }
  const k = smaOnArray(rawK, smoothK);
  const d = smaOnArray(k, smoothD);
  return { k, d };
}

export function vwap(bars: Bar[], resetDaily: boolean): Series {
  const result: Series = new Array(bars.length).fill(null);
  let cumPV = 0, cumV = 0, lastDay: string | null = null;
  for (let i = 0; i < bars.length; i++) {
    if (resetDaily) {
      const day = new Date(bars[i].time * 1000).toDateString();
      if (day !== lastDay) { cumPV = 0; cumV = 0; lastDay = day; }
    }
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumPV += tp * bars[i].volume;
    cumV += bars[i].volume;
    result[i] = cumV === 0 ? null : cumPV / cumV;
  }
  return result;
}

export function atr(bars: Bar[], period = 14): Series {
  const tr = bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))
  );
  const result: Series = new Array(bars.length).fill(null);
  if (bars.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let prev = sum / period;
  result[period - 1] = prev;
  for (let i = period; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    result[i] = prev;
  }
  return result;
}

/** Supertrend: returns the line value plus a +1/-1 trend direction per bar. */
export function supertrend(bars: Bar[], period = 10, multiplier = 3) {
  const atrArr = atr(bars, period);
  const value: Series = new Array(bars.length).fill(null);
  const direction: (1 | -1 | null)[] = new Array(bars.length).fill(null);
  let finalUpper: number | null = null;
  let finalLower: number | null = null;
  let dir: 1 | -1 = 1;

  for (let i = 0; i < bars.length; i++) {
    const a = atrArr[i];
    if (a == null) continue;
    const mid = (bars[i].high + bars[i].low) / 2;
    const basicUpper = mid + multiplier * a;
    const basicLower = mid - multiplier * a;

    if (finalUpper == null || finalLower == null) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      dir = bars[i].close >= mid ? 1 : -1;
      value[i] = dir === 1 ? finalLower : finalUpper;
      direction[i] = dir;
      continue;
    }

    const prevClose = bars[i - 1].close;
    finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
    finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

    if (dir === 1) {
      dir = bars[i].close < finalLower ? -1 : 1;
    } else {
      dir = bars[i].close > finalUpper ? 1 : -1;
    }

    value[i] = dir === 1 ? finalLower : finalUpper;
    direction[i] = dir;
  }
  return { value, direction };
}

export function computeTechnicalSummary(bars: Bar[]): TechnicalSummary {
  const signals: ('buy' | 'sell' | 'neutral')[] = [];
  const lastClose = bars.length ? bars[bars.length - 1].close : null;
  if (lastClose == null) return { buy: 0, sell: 0, neutral: 0, total: 0, score: 0, rating: 'Neutral' };

  [10, 20, 50, 100, 200].forEach((p) => {
    if (bars.length > p) {
      const s = sma(bars, p);
      const sv = s[s.length - 1];
      if (sv != null) signals.push(lastClose > sv * 1.001 ? 'buy' : lastClose < sv * 0.999 ? 'sell' : 'neutral');
      const e = ema(bars, p);
      const ev = e[e.length - 1];
      if (ev != null) signals.push(lastClose > ev * 1.001 ? 'buy' : lastClose < ev * 0.999 ? 'sell' : 'neutral');
    }
  });

  const rsiArr = rsi(bars, 14);
  const rv = rsiArr[rsiArr.length - 1];
  if (rv != null) signals.push(rv < 30 ? 'buy' : rv > 70 ? 'sell' : 'neutral');

  const { macdLine, signal } = macd(bars);
  const mv = macdLine[macdLine.length - 1];
  const sv2 = signal[signal.length - 1];
  if (mv != null && sv2 != null) signals.push(mv > sv2 ? 'buy' : mv < sv2 ? 'sell' : 'neutral');

  const { k } = stochastic(bars);
  const kv = k[k.length - 1];
  if (kv != null) signals.push(kv < 20 ? 'buy' : kv > 80 ? 'sell' : 'neutral');

  const buy = signals.filter((s) => s === 'buy').length;
  const sell = signals.filter((s) => s === 'sell').length;
  const neutral = signals.filter((s) => s === 'neutral').length;
  const total = signals.length || 1;
  const score = (buy - sell) / total;

  let rating: TechnicalSummary['rating'];
  if (score > 0.55) rating = 'Strong Buy';
  else if (score > 0.15) rating = 'Buy';
  else if (score >= -0.15) rating = 'Neutral';
  else if (score >= -0.55) rating = 'Sell';
  else rating = 'Strong Sell';

  return { buy, sell, neutral, total: signals.length, score, rating };
}
