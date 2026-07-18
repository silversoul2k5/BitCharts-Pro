import { Bar, TickerSnapshot } from './types';

export async function fetchKlines(symbol: string, interval: string, limit = 500): Promise<Bar[]> {
  const res = await fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`klines request failed (${res.status})`);
  const data = await res.json();
  return data.bars as Bar[];
}

export async function fetchTopTickers(limit = 60): Promise<TickerSnapshot[]> {
  const res = await fetch(`/api/tickers?limit=${limit}`);
  if (!res.ok) throw new Error(`tickers request failed (${res.status})`);
  const data = await res.json();
  return data.tickers as TickerSnapshot[];
}

export async function fetchTickers(symbols: string[]): Promise<TickerSnapshot[]> {
  if (!symbols.length) return [];
  const res = await fetch(`/api/tickers?symbols=${symbols.join(',')}`);
  if (!res.ok) throw new Error(`tickers request failed (${res.status})`);
  const data = await res.json();
  return data.tickers as TickerSnapshot[];
}


