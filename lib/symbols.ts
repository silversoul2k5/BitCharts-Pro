// Curated default watchlist. Any valid Binance spot symbol can still be
// searched/entered manually - this list just seeds the watchlist and screener
// so the app has something useful to show immediately on load.
export const DEFAULT_WATCHLIST: string[] = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'TONUSDT',
  'DOTUSDT',
  'MATICUSDT',
];

export const DEFAULT_SYMBOL = 'BTCUSDT';

export function prettySymbol(symbol: string): { base: string; quote: string } {
  const knownQuotes = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB', 'TRY', 'EUR'];
  for (const q of knownQuotes) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      return { base: symbol.slice(0, -q.length), quote: q };
    }
  }
  return { base: symbol, quote: '' };
}
