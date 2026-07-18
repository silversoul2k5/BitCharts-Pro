'use client';

import { useEffect, useRef, useState } from 'react';
import { Bar, OrderBookSnapshot, TickerSnapshot, Trade } from './types';

const WS_BASE = 'wss://stream.binance.com:9443/stream';

/**
 * Live data for the currently active symbol/interval: forming candle updates,
 * recent trades, and a top-of-book depth snapshot. Reconnects whenever
 * symbol or interval changes.
 */
export function useActiveMarketSocket(symbol: string, interval: string) {
  const [kline, setKline] = useState<Bar | null>(null);
  const [klineClosed, setKlineClosed] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const tradeBufferRef = useRef<Trade[]>([]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: drop stale data immediately on symbol/interval change, before the new socket connects
    setKline(null);
    setTrades([]);
    tradeBufferRef.current = [];
    setOrderBook(null);

    function connect() {
      if (cancelled) return;
      const lower = symbol.toLowerCase();
      const streams = [`${lower}@kline_${interval}`, `${lower}@trade`, `${lower}@depth20@100ms`].join('/');
      ws = new WebSocket(`${WS_BASE}?streams=${streams}`);

      ws.onopen = () => { if (!cancelled) setConnected(true); };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => { ws?.close(); };
      ws.onmessage = (event) => {
        if (cancelled) return;
        let msg: { stream?: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        const stream = msg.stream || '';
        const data = msg.data as Record<string, unknown> | undefined;
        if (!data) return;

        if (stream.includes('@kline_')) {
          const k = data.k as Record<string, unknown>;
          setKline({
            time: Math.floor((k.t as number) / 1000),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
          });
          setKlineClosed(Boolean(k.x));
        } else if (stream.includes('@trade')) {
          const t: Trade = {
            id: data.t as number,
            price: Number(data.p),
            qty: Number(data.q),
            time: data.T as number,
            isBuyerMaker: Boolean(data.m),
          };
          tradeBufferRef.current = [t, ...tradeBufferRef.current].slice(0, 40);
        } else if (stream.includes('@depth')) {
          const bids = (data.bids as [string, string][]) || [];
          const asks = (data.asks as [string, string][]) || [];
          setOrderBook({
            bids: bids.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
            asks: asks.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
          });
        }
      };
    }

    connect();
    const flushTrades = setInterval(() => setTrades(tradeBufferRef.current), 250);

    return () => {
      cancelled = true;
      clearInterval(flushTrades);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [symbol, interval]);

  return { kline, klineClosed, trades, orderBook, connected };
}

/**
 * Live 24h ticker updates for a fixed watchlist of symbols, combined into a
 * single multiplexed connection. Long-lived; only reconnects if the symbol
 * list itself changes.
 */
export function useWatchlistSocket(symbols: string[]) {
  const [tickers, setTickers] = useState<Record<string, TickerSnapshot>>({});
  const [connected, setConnected] = useState(false);
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    function connect() {
      if (cancelled) return;
      const streams = symbols.map((s) => `${s.toLowerCase()}@ticker`).join('/');
      ws = new WebSocket(`${WS_BASE}?streams=${streams}`);

      ws.onopen = () => { if (!cancelled) setConnected(true); };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => { ws?.close(); };
      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);
          const d = msg.data;
          if (!d || !d.s) return;
          setTickers((prev) => ({
            ...prev,
            [d.s]: {
              symbol: d.s,
              lastPrice: Number(d.c),
              priceChangePercent: Number(d.P),
              highPrice: Number(d.h),
              lowPrice: Number(d.l),
              quoteVolume: Number(d.q),
            },
          }));
        } catch {
          // ignore malformed message
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
    // symbols is intentionally represented by symbolsKey to avoid reconnecting on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  return { tickers, connected };
}
