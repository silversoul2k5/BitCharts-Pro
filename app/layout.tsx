import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChartForge Live — Real-Time Crypto Charting',
  description: 'Live Binance market data, TradingView-style charting (lightweight-charts), indicators, drawing tools, and AI insight.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
