import { NextResponse } from 'next/server';

export const revalidate = 30; // Revalidate every 30 seconds

const VALID_INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);
const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;

// Raw Binance kline tuple shape (REST /api/v3/klines):
// [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  const interval = searchParams.get('interval') || '1h';
  const limit = Math.min(1000, Math.max(1, Number(searchParams.get('limit')) || 500));

  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: 'invalid symbol' }, { status: 400 });
  }
  if (!VALID_INTERVALS.has(interval)) {
    return NextResponse.json({ error: 'invalid interval' }, { status: 400 });
  }

  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: 'binance error', detail: body }, { status: res.status });
    }
    const raw: BinanceKline[] = await res.json();
    const bars = raw.map((k) => ({
      time: Math.floor(k[0] / 1000), // seconds, for lightweight-charts
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));

    // The `revalidate` export handles caching. No need for Cache-Control headers here.
    return NextResponse.json({ symbol, interval, bars });
  } catch {
    return NextResponse.json({ error: 'failed to reach Binance' }, { status: 502 });
  }
}
