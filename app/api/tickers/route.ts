import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;

interface BinanceTicker24hr {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
}

function mapTicker(t: BinanceTicker24hr) {
  return {
    symbol: t.symbol,
    lastPrice: Number(t.lastPrice),
    priceChangePercent: Number(t.priceChangePercent),
    highPrice: Number(t.highPrice),
    lowPrice: Number(t.lowPrice),
    quoteVolume: Number(t.quoteVolume),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols'); // comma separated
  const limit = Math.min(150, Math.max(1, Number(searchParams.get('limit')) || 60));

  try {
    if (symbolsParam) {
      const symbols = symbolsParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SYMBOL_RE.test(s))
        .slice(0, 50);
      if (!symbols.length) return NextResponse.json({ error: 'no valid symbols' }, { status: 400 });

      const url = `https://api.binance.us/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return NextResponse.json({ error: 'binance error' }, { status: res.status });
      const raw: BinanceTicker24hr[] = await res.json();
      return NextResponse.json(
        { tickers: raw.map(mapTicker) },
        { headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=15' } }
      );
    }

    // No specific symbols requested: return top-N USDT pairs by quote volume.
    const res = await fetch('https://api.binance.us/api/v3/ticker/24hr', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return NextResponse.json({ error: 'binance error' }, { status: res.status });
    const raw: BinanceTicker24hr[] = await res.json();
    const top = raw
      .filter((t) => t.symbol.endsWith('USDT') && !t.symbol.includes('UPUSDT') && !t.symbol.includes('DOWNUSDT'))
      .map(mapTicker)
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, limit);

    return NextResponse.json(
      { tickers: top },
      { headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' } }
    );
  } catch {
    return NextResponse.json({ error: 'failed to reach Binance' }, { status: 502 });
  }
}
