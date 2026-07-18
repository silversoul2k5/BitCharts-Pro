'use client';

import { TechnicalSummary } from '@/lib/types';
import { ratingClass } from '@/lib/format';

export default function Gauge({ summary }: { summary: TechnicalSummary }) {
  const angle = Math.max(-1, Math.min(1, summary.score)) * 80;
  return (
    <div className="gauge-wrap">
      <svg viewBox="0 0 200 118" className="gauge-svg">
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef5350" />
            <stop offset="50%" stopColor="#f0b042" />
            <stop offset="100%" stopColor="#26a69a" />
          </linearGradient>
        </defs>
        <path d="M12,100 A88,88 0 0,1 188,100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="11" strokeLinecap="round" />
        <text x="20" y="115" className="gauge-zone-label">SELL</text>
        <text x="100" y="13" className="gauge-zone-label" textAnchor="middle">NEUTRAL</text>
        <text x="180" y="115" className="gauge-zone-label" textAnchor="end">BUY</text>
        <line
          x1="100" y1="100" x2="100" y2="24"
          stroke="#e7eaf3" strokeWidth="3" strokeLinecap="round"
          style={{ transformOrigin: '100px 100px', transition: 'transform 0.7s cubic-bezier(.34,1.56,.64,1)', transform: `rotate(${angle}deg)` }}
        />
        <circle cx="100" cy="100" r="9" fill="none" stroke="#e7eaf3" strokeOpacity="0.15" strokeWidth="2" />
        <circle cx="100" cy="100" r="5" fill="#e7eaf3" />
      </svg>
      <div className={`gauge-rating rating-${ratingClass(summary.rating)}`}>{summary.rating}</div>
      <div className="gauge-counts">
        <span className="count-buy">Buy <b>{summary.buy}</b></span>
        <span className="count-neutral">Neutral <b>{summary.neutral}</b></span>
        <span className="count-sell">Sell <b>{summary.sell}</b></span>
      </div>
    </div>
  );
}
