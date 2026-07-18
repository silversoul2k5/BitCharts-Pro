// Shared types used across the app.

export interface Bar {
  time: number; // seconds (UTCTimestamp) - matches lightweight-charts' Time
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export interface SymbolMeta {
  symbol: string; // e.g. BTCUSDT
  base: string; // e.g. BTC
  quote: string; // e.g. USDT
}

export interface TickerSnapshot {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
}

export interface Trade {
  id: number;
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean; // true = sell (taker sold into bid), false = buy
}

export interface OrderBookLevel {
  price: number;
  qty: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export type DrawingTool =
  | 'cursor'
  | 'trendline'
  | 'hline'
  | 'hray'
  | 'vline'
  | 'rectangle'
  | 'fib'
  | 'channel'
  | 'text'
  | 'arrow';

export interface DrawingPoint {
  logical: number;
  price: number;
}

export interface Drawing {
  id: string;
  type: DrawingTool;
  points: DrawingPoint[];
  text?: string;
  color?: string;
  done: boolean;
}

export interface IndicatorState {
  sma20: boolean;
  ema50: boolean;
  bb: boolean;
  vwap: boolean;
  supertrend: boolean;
}

export interface OscillatorState {
  rsi: boolean;
  macd: boolean;
  stoch: boolean;
}

export interface TechnicalSummary {
  buy: number;
  sell: number;
  neutral: number;
  total: number;
  score: number;
  rating: 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';
}
