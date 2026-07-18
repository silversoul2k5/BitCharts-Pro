'use client';

import { useMemo, useState } from 'react';
import { Bar, TickerSnapshot } from '@/lib/types';
import { computeTechnicalSummary, rsi } from '@/lib/indicators';
import { formatPrice, formatPercent, formatVolume, ratingClass } from '@/lib/format';
import { prettySymbol } from '@/lib/symbols';

interface ScreenerProps {
  symbols: string[];
  tickers: Record<string, TickerSnapshot>;
  barsBySymbol: Record<string, Bar[]>;
  onSelect: (symbol: string) => void;
}

type SortKey = 'symbol' | 'price' | 'changePct' | 'rsiVal' | 'rating' | 'volume';

interface Row {
  symbol: string;
  base: string;
  quote: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  rsiVal: number | null;
  rating: string | null;
}

export default function Screener({ symbols, tickers, barsBySymbol, onSelect }: ScreenerProps) {
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const rows: Row[] = useMemo(() => {
    return symbols.map((symbol) => {
      const t = tickers[symbol];
      const bars = barsBySymbol[symbol] || [];
      const rsiArr = bars.length ? rsi(bars, 14) : [];
      const rsiVal = rsiArr.length ? rsiArr[rsiArr.length - 1] : null;
      const summary = bars.length ? computeTechnicalSummary(bars) : null;
      const { base, quote } = prettySymbol(symbol);
      return {
        symbol,
        base,
        quote,
        price: t ? t.lastPrice : null,
        changePct: t ? t.priceChangePercent : null,
        volume: t ? t.quoteVolume : null,
        rsiVal,
        rating: summary ? summary.rating : null,
      };
    });
  }, [symbols, tickers, barsBySymbol]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av ?? '').localeCompare(String(bv ?? '')) * sortDir;
      }
      const an = av == null ? -Infinity : av;
      const bn = bv == null ? -Infinity : bv;
      return (an - bn) * sortDir;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  return (
    <table className="screener-table">
      <thead>
        <tr>
          <th onClick={() => handleSort('symbol')}>Symbol</th>
          <th onClick={() => handleSort('price')}>Price</th>
          <th onClick={() => handleSort('changePct')}>Change</th>
          <th onClick={() => handleSort('rsiVal')}>RSI</th>
          <th onClick={() => handleSort('rating')}>Rating</th>
          <th onClick={() => handleSort('volume')}>Volume</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.symbol} onClick={() => onSelect(r.symbol)}>
            <td>
              <span className="screener-symbol">{r.base}</span>
              <span className="screener-name">/{r.quote}</span>
            </td>
            <td>{r.price != null ? formatPrice(r.price) : '…'}</td>
            <td className={r.changePct != null && r.changePct >= 0 ? 'positive' : 'negative'}>
              {r.changePct != null ? formatPercent(r.changePct) : '…'}
            </td>
            <td>{r.rsiVal != null ? r.rsiVal.toFixed(1) : '…'}</td>
            <td>
              {r.rating ? <span className={`rating-pill rating-${ratingClass(r.rating)}`}>{r.rating}</span> : '…'}
            </td>
            <td>{r.volume != null ? formatVolume(r.volume) : '…'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
