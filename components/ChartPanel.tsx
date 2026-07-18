'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';
import { Bar, IndicatorState, OscillatorState } from '@/lib/types';
import { sma, ema, bollinger, vwap, supertrend, rsi, macd, stochastic, Series } from '@/lib/indicators';

const COLOR_BULL = '#26a69a';
const COLOR_BEAR = '#ef5350';
const VOL_UP = 'rgba(38,166,154,0.5)';
const VOL_DOWN = 'rgba(239,83,80,0.5)';
const INTRADAY = new Set(['1m', '5m', '15m', '1h', '4h']);

export interface ChartApiRefs {
  chart: IChartApi;
  mainSeries: ISeriesApi<'Candlestick'>;
}

interface SeriesRefs {
  candle: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  sma20: ISeriesApi<'Line'>;
  ema50: ISeriesApi<'Line'>;
  bbUpper: ISeriesApi<'Line'>;
  bbLower: ISeriesApi<'Line'>;
  bbMid: ISeriesApi<'Line'>;
  vwapLine: ISeriesApi<'Line'>;
  stUp: ISeriesApi<'Line'>;
  stDown: ISeriesApi<'Line'>;
  rsiLine: ISeriesApi<'Line'>;
  macdHist: ISeriesApi<'Histogram'>;
  macdLine: ISeriesApi<'Line'>;
  macdSignal: ISeriesApi<'Line'>;
  stochK: ISeriesApi<'Line'>;
  stochD: ISeriesApi<'Line'>;
}

interface ChartPanelProps {
  bars: Bar[];
  liveKline: Bar | null;
  interval: string;
  indicators: IndicatorState;
  oscillators: OscillatorState;
  onReady: (refs: ChartApiRefs) => void;
}

function setLineData(series: ISeriesApi<'Line'>, bars: Bar[], values: Series) {
  const data = bars
    .map((b, i) => ({ time: b.time as UTCTimestamp, value: values[i] }))
    .filter((d): d is { time: UTCTimestamp; value: number } => d.value != null && isFinite(d.value));
  series.setData(data);
}

function updateLast(series: ISeriesApi<'Line'>, time: UTCTimestamp, values: Series) {
  const v = values[values.length - 1];
  if (v != null && isFinite(v)) series.update({ time, value: v });
}

function mergeLiveBar(bars: Bar[], live: Bar): Bar[] {
  if (!bars.length) return [live];
  const last = bars[bars.length - 1];
  if (last.time === live.time) return [...bars.slice(0, -1), live];
  if (live.time > last.time) return [...bars, live];
  return bars;
}

export default function ChartPanel({ bars, liveKline, interval, indicators, oscillators, onReady }: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesRefs | null>(null);

  // Mount once: build the chart, all panes and series.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8992ab',
        fontSize: 11,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        panes: { separatorColor: '#212940', separatorHoverColor: 'rgba(124,92,255,0.25)' },
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.035)' },
        horzLines: { color: 'rgba(255,255,255,0.035)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#212940' },
      timeScale: { borderColor: '#212940', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: COLOR_BULL,
      downColor: COLOR_BEAR,
      borderVisible: false,
      wickUpColor: COLOR_BULL,
      wickDownColor: COLOR_BEAR,
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

    const overlayOpts = { priceLineVisible: false, lastValueVisible: false, lineWidth: 1 as const };
    const sma20 = chart.addSeries(LineSeries, { ...overlayOpts, color: '#f0b042' });
    const ema50 = chart.addSeries(LineSeries, { ...overlayOpts, color: '#22d3ee' });
    const bbUpper = chart.addSeries(LineSeries, { ...overlayOpts, color: 'rgba(139,92,246,0.75)' });
    const bbLower = chart.addSeries(LineSeries, { ...overlayOpts, color: 'rgba(139,92,246,0.75)' });
    const bbMid = chart.addSeries(LineSeries, { ...overlayOpts, color: 'rgba(139,92,246,0.4)' });
    const vwapLine = chart.addSeries(LineSeries, { ...overlayOpts, color: '#ec4899' });
    const stUp = chart.addSeries(LineSeries, { ...overlayOpts, color: COLOR_BULL, lineWidth: 2 });
    const stDown = chart.addSeries(LineSeries, { ...overlayOpts, color: COLOR_BEAR, lineWidth: 2 });

    const oscOpts = { priceLineVisible: false, lastValueVisible: false, lineWidth: 2 as const };
    const rsiLine = chart.addSeries(LineSeries, { ...oscOpts, color: '#8b5cf6' }, 1);
    rsiLine.createPriceLine({ price: 70, color: 'rgba(255,255,255,0.15)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
    rsiLine.createPriceLine({ price: 30, color: 'rgba(255,255,255,0.15)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });

    const macdHist = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, 2);
    const macdLine = chart.addSeries(LineSeries, { ...oscOpts, color: '#22d3ee' }, 2);
    const macdSignal = chart.addSeries(LineSeries, { ...oscOpts, color: '#f0b042' }, 2);

    const stochK = chart.addSeries(LineSeries, { ...oscOpts, color: '#22d3ee' }, 3);
    const stochD = chart.addSeries(LineSeries, { ...oscOpts, color: '#f0b042' }, 3);

    const panes = chart.panes();
    panes[0]?.setStretchFactor(5);
    panes[1]?.setStretchFactor(0);
    panes[2]?.setStretchFactor(0);
    panes[3]?.setStretchFactor(0);

    seriesRef.current = {
      candle, volume, sma20, ema50, bbUpper, bbLower, bbMid, vwapLine, stUp, stDown,
      rsiLine, macdHist, macdLine, macdSignal, stochK, stochD,
    };

    onReady({ chart, mainSeries: candle });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Historical data load: whenever the bar set changes (symbol/interval switch).
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !bars.length) return;
    const isIntraday = INTRADAY.has(interval);

    s.candle.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
    s.volume.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.volume, color: b.close >= b.open ? VOL_UP : VOL_DOWN })));

    setLineData(s.sma20, bars, sma(bars, 20));
    setLineData(s.ema50, bars, ema(bars, 50));
    const bb = bollinger(bars, 20, 2);
    setLineData(s.bbUpper, bars, bb.upper);
    setLineData(s.bbLower, bars, bb.lower);
    setLineData(s.bbMid, bars, bb.mid);
    setLineData(s.vwapLine, bars, vwap(bars, isIntraday));

    const st = supertrend(bars, 10, 3);
    setLineData(s.stUp, bars, st.value.map((v, i) => (st.direction[i] === 1 ? v : null)));
    setLineData(s.stDown, bars, st.value.map((v, i) => (st.direction[i] === -1 ? v : null)));

    setLineData(s.rsiLine, bars, rsi(bars, 14));

    const m = macd(bars);
    setLineData(s.macdLine, bars, m.macdLine);
    setLineData(s.macdSignal, bars, m.signal);
    s.macdHist.setData(
      bars
        .map((b, i) => ({ time: b.time as UTCTimestamp, value: m.histogram[i], color: (m.histogram[i] ?? 0) >= 0 ? VOL_UP : VOL_DOWN }))
        .filter((d): d is { time: UTCTimestamp; value: number; color: string } => d.value != null)
    );

    const stoch = stochastic(bars);
    setLineData(s.stochK, bars, stoch.k);
    setLineData(s.stochD, bars, stoch.d);

    chartRef.current?.timeScale().fitContent();
  }, [bars, interval]);

  // Live tick: update the forming candle + recompute the tail of each indicator in place.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !liveKline || !bars.length) return;
    const t = liveKline.time as UTCTimestamp;
    const isIntraday = INTRADAY.has(interval);

    s.candle.update({ time: t, open: liveKline.open, high: liveKline.high, low: liveKline.low, close: liveKline.close });
    s.volume.update({ time: t, value: liveKline.volume, color: liveKline.close >= liveKline.open ? VOL_UP : VOL_DOWN });

    const merged = mergeLiveBar(bars, liveKline);
    updateLast(s.sma20, t, sma(merged, 20));
    updateLast(s.ema50, t, ema(merged, 50));
    const bb = bollinger(merged, 20, 2);
    updateLast(s.bbUpper, t, bb.upper);
    updateLast(s.bbLower, t, bb.lower);
    updateLast(s.bbMid, t, bb.mid);
    updateLast(s.vwapLine, t, vwap(merged, isIntraday));

    const st = supertrend(merged, 10, 3);
    const lastDir = st.direction[st.direction.length - 1];
    const lastVal = st.value[st.value.length - 1];
    if (lastVal != null && lastDir != null) {
      if (lastDir === 1) s.stUp.update({ time: t, value: lastVal });
      else s.stDown.update({ time: t, value: lastVal });
    }

    updateLast(s.rsiLine, t, rsi(merged, 14));
    const m = macd(merged);
    updateLast(s.macdLine, t, m.macdLine);
    updateLast(s.macdSignal, t, m.signal);
    const histVal = m.histogram[m.histogram.length - 1];
    if (histVal != null) s.macdHist.update({ time: t, value: histVal, color: histVal >= 0 ? VOL_UP : VOL_DOWN });

    const stoch = stochastic(merged);
    updateLast(s.stochK, t, stoch.k);
    updateLast(s.stochD, t, stoch.d);
    // bars is intentionally omitted: this effect should fire only on new ticks, using the
    // most recent historical bars captured at render time via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKline]);

  // Overlay indicator visibility toggles.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    s.sma20.applyOptions({ visible: indicators.sma20 });
    s.ema50.applyOptions({ visible: indicators.ema50 });
    s.bbUpper.applyOptions({ visible: indicators.bb });
    s.bbLower.applyOptions({ visible: indicators.bb });
    s.bbMid.applyOptions({ visible: indicators.bb });
    s.vwapLine.applyOptions({ visible: indicators.vwap });
    s.stUp.applyOptions({ visible: indicators.supertrend });
    s.stDown.applyOptions({ visible: indicators.supertrend });
  }, [indicators]);

  // Oscillator pane show/hide via stretch factor.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const panes = chart.panes();
    if (panes[1]) panes[1].setStretchFactor(oscillators.rsi ? 1.6 : 0);
    if (panes[2]) panes[2].setStretchFactor(oscillators.macd ? 1.6 : 0);
    if (panes[3]) panes[3].setStretchFactor(oscillators.stoch ? 1.6 : 0);
  }, [oscillators]);

  return <div ref={containerRef} className="chart-container" />;
}
