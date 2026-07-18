'use client';

import { useMemo, useState } from 'react';
import { Bar } from '@/lib/types';
import { computeTechnicalSummary, atr } from '@/lib/indicators';
import { formatPrice, formatVolume } from '@/lib/format';
import { generateInsight } from '@/lib/insightGenerator';
import Gauge from './Gauge';

interface AnalysisPanelProps {
  symbol: string;
  interval: string;
  bars: Bar[];
}

export default function AnalysisPanel({ symbol, interval, bars }: AnalysisPanelProps) {
  const [commentary, setCommentary] = useState<string | null>(null);

  const summary = useMemo(() => computeTechnicalSummary(bars), [bars]);
  const atrVal = useMemo(() => {
    if (!bars.length) return null;
    const a = atr(bars, 14);
    return a[a.length - 1];
  }, [bars]);

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

  function handleGenerate() {
    setCommentary(generateInsight(symbol, interval, bars, summary));
  }

  return (
    <aside className="analysis-panel">
      <div className="panel-title">Technical Analysis</div>
      <Gauge summary={summary} />

      <div className="key-stats">
        <div className="stat-row"><span>Prev Close</span><b>{prev ? formatPrice(prev.close) : '—'}</b></div>
        <div className="stat-row"><span>24h Range</span><b>{last ? `${formatPrice(last.low)} – ${formatPrice(last.high)}` : '—'}</b></div>
        <div className="stat-row"><span>Volume</span><b>{last ? formatVolume(last.volume) : '—'}</b></div>
        <div className="stat-row"><span>ATR (14)</span><b>{atrVal != null ? formatPrice(atrVal) : '—'}</b></div>
      </div>

      <div className="ai-panel">
        <div className="panel-title" style={{ padding: '8px 0 4px' }}>Market Commentary</div>
        <button className="ai-btn" onClick={handleGenerate} disabled={!bars.length}>
          {commentary ? '✦ Regenerate Commentary' : '✦ Generate Commentary'}
        </button>
        <div className="ai-output">
          {!commentary && <div className="ai-placeholder">Click generate for a written technical summary of the current symbol — computed instantly and locally, free.</div>}
          {commentary && <div className="ai-result">{commentary}</div>}
        </div>
        <div className="ai-disclaimer">Educational only — not financial advice. Rule-based summary computed from the live indicator values above, no external API calls.</div>
      </div>
    </aside>
  );
}
