'use client';

import { useCallback, useEffect, useRef } from 'react';
import { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';
import { Drawing, DrawingPoint, DrawingTool } from '@/lib/types';

interface DrawingOverlayProps {
  chart: IChartApi | null;
  mainSeries: ISeriesApi<'Candlestick'> | null;
  activeTool: DrawingTool;
  drawings: Drawing[];
  onDrawingsChange: (updater: (prev: Drawing[]) => Drawing[]) => void;
  onToolComplete: () => void;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export default function DrawingOverlay({
  chart,
  mainSeries,
  activeTool,
  drawings,
  onDrawingsChange,
  onToolComplete,
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingRef = useRef<Drawing | null>(null);
  const clickCountRef = useRef(0);

  const toScreen = useCallback(
    (p: DrawingPoint): { x: number; y: number } | null => {
      if (!chart || !mainSeries) return null;
      const x = chart.timeScale().logicalToCoordinate(p.logical as Logical);
      const y = mainSeries.priceToCoordinate(p.price);
      if (x == null || y == null) return null;
      return { x, y };
    },
    [chart, mainSeries]
  );

  const fromScreen = useCallback(
    (x: number, y: number): DrawingPoint | null => {
      if (!chart || !mainSeries) return null;
      const logical = chart.timeScale().coordinateToLogical(x);
      const price = mainSeries.coordinateToPrice(y);
      if (logical == null || price == null) return null;
      return { logical: logical as number, price: price as number };
    },
    [chart, mainSeries]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const paneHeight = chart.panes()[0]?.getHeight() || canvas.clientHeight;

    canvas.style.height = `${paneHeight}px`;
    const targetW = Math.max(1, Math.floor(width * dpr));
    const targetH = Math.max(1, Math.floor(paneHeight * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, paneHeight);

    const all = pendingRef.current ? [...drawings, pendingRef.current] : drawings;
    all.forEach((d) => renderDrawing(ctx, d, toScreen, width, paneHeight));
  }, [chart, drawings, toScreen]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (!chart) return;
    const handler = () => draw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    window.addEventListener('resize', handler);
    const poll = setInterval(handler, 400); // catches pane-height changes from oscillator toggles
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      window.removeEventListener('resize', handler);
      clearInterval(poll);
    };
  }, [chart, draw]);

  // Cancel any in-progress drawing when the tool changes.
  useEffect(() => {
    pendingRef.current = null;
    clickCountRef.current = 0;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  function commit(d: Drawing) {
    onDrawingsChange((prev) => [...prev, d]);
    pendingRef.current = null;
    clickCountRef.current = 0;
    onToolComplete();
    draw();
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (activeTool === 'cursor') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const point = fromScreen(e.clientX - rect.left, e.clientY - rect.top);
    if (!point) return;

    if (activeTool === 'hline' || activeTool === 'vline' || activeTool === 'hray') {
      commit({ id: makeId(), type: activeTool, points: [point], done: true });
      return;
    }
    if (activeTool === 'text') {
      const text = typeof window !== 'undefined' ? window.prompt('Note text:', '') : '';
      if (text && text.trim()) commit({ id: makeId(), type: 'text', points: [point], text: text.trim(), done: true });
      return;
    }

    const needed = activeTool === 'channel' ? 3 : 2;
    clickCountRef.current += 1;

    if (clickCountRef.current === 1) {
      pendingRef.current = { id: makeId(), type: activeTool, points: [point, point], done: false };
    } else {
      const pts = pendingRef.current!.points;
      pts[clickCountRef.current - 1] = point;
      if (clickCountRef.current < needed) pts.push(point);
    }

    if (clickCountRef.current >= needed) {
      commit({ ...pendingRef.current!, done: true });
    } else {
      draw();
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!pendingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const point = fromScreen(e.clientX - rect.left, e.clientY - rect.top);
    if (!point) return;
    const pts = pendingRef.current.points;
    pts[pts.length - 1] = point;
    draw();
  }

  return (
    <canvas
      ref={canvasRef}
      className="drawing-overlay"
      style={{ pointerEvents: activeTool === 'cursor' ? 'none' : 'auto', cursor: activeTool === 'cursor' ? 'default' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    />
  );
}

function renderDrawing(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  toScreen: (p: DrawingPoint) => { x: number; y: number } | null,
  width: number,
  height: number
) {
  const color = d.color || '#7c5cff';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textBaseline = 'alphabetic';

  if (d.type === 'hline') {
    const p = toScreen(d.points[0]);
    if (p) {
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(width, p.y); ctx.stroke();
      ctx.fillText(d.points[0].price.toFixed(2), 6, p.y - 4);
    }
  } else if (d.type === 'hray') {
    const p = toScreen(d.points[0]);
    if (p) {
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(width, p.y); ctx.stroke();
      ctx.fillText(d.points[0].price.toFixed(2), p.x + 4, p.y - 4);
    }
  } else if (d.type === 'vline') {
    const p = toScreen(d.points[0]);
    if (p) {
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, height); ctx.stroke();
    }
  } else if (d.type === 'trendline' || d.type === 'arrow') {
    const p1 = toScreen(d.points[0]);
    const p2 = toScreen(d.points[1]);
    if (p1 && p2) {
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      if (d.type === 'arrow') drawArrowHead(ctx, p1, p2, color);
    }
  } else if (d.type === 'rectangle') {
    const p1 = toScreen(d.points[0]);
    const p2 = toScreen(d.points[1]);
    if (p1 && p2) {
      const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
      const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeRect(x, y, w, h);
    }
  } else if (d.type === 'text') {
    const p = toScreen(d.points[0]);
    if (p && d.text) {
      ctx.font = '12px -apple-system, sans-serif';
      const padding = 5;
      const metrics = ctx.measureText(d.text);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#141a2a';
      ctx.fillRect(p.x, p.y - 16, metrics.width + padding * 2, 20);
      ctx.globalAlpha = 1;
      ctx.strokeRect(p.x, p.y - 16, metrics.width + padding * 2, 20);
      ctx.fillStyle = color;
      ctx.fillText(d.text, p.x + padding, p.y - 2);
    }
  } else if (d.type === 'fib') {
    const p1 = d.points[0];
    const p2 = d.points[1];
    if (!p1 || !p2) { ctx.restore(); return; }
    const s1 = toScreen(p1);
    if (!s1) { ctx.restore(); return; }
    const high = Math.max(p1.price, p2.price);
    const low = Math.min(p1.price, p2.price);
    const range = high - low;
    FIB_LEVELS.forEach((level) => {
      const price = high - range * level;
      const y = toScreen({ logical: p1.logical, price });
      if (!y) return;
      ctx.globalAlpha = level === 0 || level === 1 ? 0.9 : 0.55;
      ctx.beginPath(); ctx.moveTo(s1.x, y.y); ctx.lineTo(width, y.y); ctx.stroke();
      ctx.fillText(`${(level * 100).toFixed(1)}%  ${price.toFixed(2)}`, s1.x + 4, y.y - 3);
    });
    ctx.globalAlpha = 1;
  } else if (d.type === 'channel') {
    const [p1, p2, p3] = d.points;
    if (!p1 || !p2) { ctx.restore(); return; }
    const s1 = toScreen(p1);
    const s2 = toScreen(p2);
    if (s1 && s2) {
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
    }
    if (p3 && s1 && s2) {
      const denom = p2.logical - p1.logical || 1;
      const slope = (p2.price - p1.price) / denom;
      const baselineAtP3 = p1.price + slope * (p3.logical - p1.logical);
      const offset = p3.price - baselineAtP3;
      const p1b = toScreen({ logical: p1.logical, price: p1.price + offset });
      const p2b = toScreen({ logical: p2.logical, price: p2.price + offset });
      if (p1b && p2b) {
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(p1b.x, p1b.y); ctx.lineTo(p2b.x, p2b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  ctx.restore();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, color: string) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 9;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
