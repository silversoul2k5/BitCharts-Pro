'use client';

import { useState } from 'react';
import { OrderBookSnapshot, Trade } from '@/lib/types';
import { formatPrice, formatQty } from '@/lib/format';

interface MarketDepthPanelProps {
  orderBook: OrderBookSnapshot | null;
  trades: Trade[];
}

export default function MarketDepthPanel({ orderBook, trades }: MarketDepthPanelProps) {
  const [tab, setTab] = useState<'book' | 'trades'>('book');

  return (
    <aside className="market-depth-panel">
      <div className="depth-tabs">
        <button className={`depth-tab${tab === 'book' ? ' active' : ''}`} onClick={() => setTab('book')}>
          Order Book
        </button>
        <button className={`depth-tab${tab === 'trades' ? ' active' : ''}`} onClick={() => setTab('trades')}>
          Trades
        </button>
      </div>
      {tab === 'book' ? <OrderBookView book={orderBook} /> : <TradesView trades={trades} />}
    </aside>
  );
}

function OrderBookView({ book }: { book: OrderBookSnapshot | null }) {
  if (!book || !book.bids.length || !book.asks.length) {
    return <div className="chart-loading" style={{ position: 'static', height: 200 }}>Connecting…</div>;
  }
  const asks = book.asks.slice(0, 12);
  const bids = book.bids.slice(0, 12);
  const maxQty = Math.max(...asks.map((a) => a.qty), ...bids.map((b) => b.qty), 0.0001);
  const bestAsk = asks[0]?.price ?? 0;
  const bestBid = bids[0]?.price ?? 0;
  const spread = bestAsk - bestBid;
  const spreadPct = bestBid ? (spread / bestBid) * 100 : 0;

  return (
    <>
      <div className="ob-header"><span>Price</span><span>Qty</span></div>
      <div className="ob-rows">
        {[...asks].reverse().map((a, i) => (
          <div className="ob-row ask" key={`ask-${i}`}>
            <div className="ob-bar" style={{ width: `${(a.qty / maxQty) * 100}%` }} />
            <span className="ob-price">{formatPrice(a.price)}</span>
            <span className="ob-qty">{formatQty(a.qty)}</span>
          </div>
        ))}
        <div className="ob-spread">spread {formatPrice(spread)} ({spreadPct.toFixed(3)}%)</div>
        {bids.map((b, i) => (
          <div className="ob-row bid" key={`bid-${i}`}>
            <div className="ob-bar" style={{ width: `${(b.qty / maxQty) * 100}%` }} />
            <span className="ob-price">{formatPrice(b.price)}</span>
            <span className="ob-qty">{formatQty(b.qty)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function TradesView({ trades }: { trades: Trade[] }) {
  if (!trades.length) {
    return <div className="chart-loading" style={{ position: 'static', height: 200 }}>Waiting for trades…</div>;
  }
  return (
    <>
      <div className="trade-header"><span>Price</span><span>Qty</span><span>Time</span></div>
      <div className="trade-rows">
        {trades.map((t) => {
          // isBuyerMaker true => the taker was a seller (sold into the bid) => shown as a "sell" print
          const isSell = t.isBuyerMaker;
          return (
            <div className="trade-row" key={t.id}>
              <span className={`t-price ${isSell ? 'sell' : 'buy'}`}>{formatPrice(t.price)}</span>
              <span>{formatQty(t.qty)}</span>
              <span className="t-time">{new Date(t.time).toLocaleTimeString(undefined, { hour12: false })}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
