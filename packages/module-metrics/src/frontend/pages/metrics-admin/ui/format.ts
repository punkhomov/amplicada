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

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}
