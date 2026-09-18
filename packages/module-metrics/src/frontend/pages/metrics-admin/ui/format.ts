export function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1000) return `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value < 0.001) return '<0.1%';
  return `${(value * 100).toFixed(1)}%`;
}

export function shortHash(hash: string, length = 10): string {
  return hash.length > length ? `${hash.slice(0, length)}…` : hash;
}
