'use client';

import { useState } from 'react';
import { DrawingTool, IndicatorState, Interval, OscillatorState, INTERVALS } from '@/lib/types';

interface ToolbarProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  onClear: () => void;
  onReset: () => void;
  interval: Interval;
  onIntervalChange: (i: Interval) => void;
  indicators: IndicatorState;
  onIndicatorsChange: (next: IndicatorState) => void;
  oscillators: OscillatorState;
  onOscillatorsChange: (next: OscillatorState) => void;
}

const TOOLS: { tool: DrawingTool; label: string; title: string }[] = [
  { tool: 'cursor', label: '↖', title: 'Cursor / Pan' },
  { tool: 'trendline', label: '╱', title: 'Trend Line' },
  { tool: 'hline', label: '―', title: 'Horizontal Line' },
  { tool: 'hray', label: '→', title: 'Horizontal Ray' },
  { tool: 'vline', label: '│', title: 'Vertical Line' },
  { tool: 'rectangle', label: '▭', title: 'Rectangle' },
  { tool: 'fib', label: 'F', title: 'Fibonacci Retracement' },
  { tool: 'channel', label: '≠', title: 'Parallel Channel' },
  { tool: 'arrow', label: '↗', title: 'Arrow' },
  { tool: 'text', label: 'T', title: 'Text Note' },
];

export default function Toolbar({
  activeTool, onToolChange, onClear, onReset,
  interval, onIntervalChange,
  indicators, onIndicatorsChange,
  oscillators, onOscillatorsChange,
}: ToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="chart-toolbar">
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`tool-btn${activeTool === t.tool ? ' active' : ''}`}
            title={t.title}
            onClick={() => onToolChange(t.tool)}
          >
            {t.label}
          </button>
        ))}
        <button className="tool-btn" title="Clear all drawings" onClick={onClear}>✕</button>
        <button className="tool-btn" title="Reset zoom" onClick={onReset}>⤢</button>
      </div>

      <div className="timeframe-tabs">
        {INTERVALS.map((i) => (
          <button key={i} className={interval === i ? 'active' : ''} onClick={() => onIntervalChange(i)}>
            {i.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="indicator-dropdown">
        <button className="tool-btn wide" onClick={() => setMenuOpen((o) => !o)}>+ Indicators</button>
        <div className={`indicator-menu${menuOpen ? ' open' : ''}`} onMouseLeave={() => setMenuOpen(false)}>
          <div className="indicator-menu-section">Overlays</div>
          <label>
            <input type="checkbox" checked={indicators.sma20} onChange={(e) => onIndicatorsChange({ ...indicators, sma20: e.target.checked })} />
            SMA (20)
          </label>
          <label>
            <input type="checkbox" checked={indicators.ema50} onChange={(e) => onIndicatorsChange({ ...indicators, ema50: e.target.checked })} />
            EMA (50)
          </label>
          <label>
            <input type="checkbox" checked={indicators.bb} onChange={(e) => onIndicatorsChange({ ...indicators, bb: e.target.checked })} />
            Bollinger Bands (20,2)
          </label>
          <label>
            <input type="checkbox" checked={indicators.vwap} onChange={(e) => onIndicatorsChange({ ...indicators, vwap: e.target.checked })} />
            VWAP
          </label>
          <label>
            <input type="checkbox" checked={indicators.supertrend} onChange={(e) => onIndicatorsChange({ ...indicators, supertrend: e.target.checked })} />
            Supertrend (10, 3)
          </label>
          <div className="indicator-menu-section">Oscillators</div>
          <label>
            <input type="checkbox" checked={oscillators.rsi} onChange={(e) => onOscillatorsChange({ ...oscillators, rsi: e.target.checked })} />
            RSI (14)
          </label>
          <label>
            <input type="checkbox" checked={oscillators.macd} onChange={(e) => onOscillatorsChange({ ...oscillators, macd: e.target.checked })} />
            MACD (12,26,9)
          </label>
          <label>
            <input type="checkbox" checked={oscillators.stoch} onChange={(e) => onOscillatorsChange({ ...oscillators, stoch: e.target.checked })} />
            Stochastic (14,3)
          </label>
        </div>
      </div>
    </div>
  );
}
