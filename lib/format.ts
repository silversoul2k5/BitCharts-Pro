export function formatPrice(p: number): string {
  if (!isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

export function formatVolume(v: number): string {
  if (!isFinite(v)) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(2);
}

export function formatPercent(p: number): string {
  if (!isFinite(p)) return '—';
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

export function formatQty(v: number): string {
  if (!isFinite(v)) return '—';
  if (v >= 1000) return v.toFixed(1);
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(5);
}

export function ratingClass(rating: string): string {
  return rating.toLowerCase().replace(/\s+/g, '-');
}
