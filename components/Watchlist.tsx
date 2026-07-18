'use client';

import { TickerSnapshot } from '@/lib/types';
import { prettySymbol } from '@/lib/symbols';
import { formatPrice, formatPercent } from '@/lib/format';

interface WatchlistProps {
  symbols: string[];
  tickers: Record<string, TickerSnapshot>;
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  filter: string;
}

export default function Watchlist({ symbols, tickers, activeSymbol, onSelect, filter }: WatchlistProps) {
  const q = filter.trim().toUpperCase();
  const filtered = q ? symbols.filter((s) => s.includes(q)) : symbols;

  return (
    <div className="watchlist-items">
      {filtered.map((symbol) => {
        const t = tickers[symbol];
        const { base, quote } = prettySymbol(symbol);
        const up = t ? t.priceChangePercent >= 0 : true;
        return (
          <div
            key={symbol}
            className={`watchlist-item${symbol === activeSymbol ? ' active' : ''}`}
            onClick={() => onSelect(symbol)}
          >
            <div className="wl-left">
              <span className="wl-symbol">{base}</span>
              <span className="wl-name">/{quote || '?'}</span>
            </div>
            <div className="wl-right">
              <span className="wl-price">{t ? formatPrice(t.lastPrice) : '…'}</span>
              <span className={`wl-change ${up ? 'positive' : 'negative'}`}>
                {t ? formatPercent(t.priceChangePercent) : ''}
              </span>
            </div>
          </div>
        );
      })}
      {filtered.length === 0 && (
        <div style={{ padding: '20px 14px', color: 'var(--text-dim)', fontSize: 12.5 }}>
          No matches. Try a symbol like ETHUSDT.
        </div>
      )}
    </div>
  );
}
