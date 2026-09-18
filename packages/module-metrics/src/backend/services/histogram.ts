/** Границы гистограмм задержек (секунды) — дефолт OTel для HTTP/DB. */
export const LATENCY_BOUNDARIES_SECONDS: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

export interface Histogram {
  boundaries: number[];
  bucketCounts: number[];
}

export function createHistogram(boundaries: readonly number[] = LATENCY_BOUNDARIES_SECONDS): Histogram {
  return { boundaries: [...boundaries], bucketCounts: new Array(boundaries.length + 1).fill(0) };
}

/** Кладёт наблюдение в первый бакет, где `value <= boundary`; иначе — в последний (+Inf). */
export function recordHistogram(histogram: Histogram, value: number): void {
  const index = histogram.boundaries.findIndex(boundary => value <= boundary);
  histogram.bucketCounts[index === -1 ? histogram.bucketCounts.length - 1 : index] += 1;
}

export function histogramCount(histogram: Histogram): number {
  return histogram.bucketCounts.reduce((total, count) => total + count, 0);
}

/** Сливает гистограммы одинаковой формы (границы инструмента фиксированы). */
export function mergeHistograms(target: Histogram, source: Histogram): void {
  if (target.bucketCounts.length !== source.bucketCounts.length) return;
  for (let i = 0; i < source.bucketCounts.length; i += 1) {
    target.bucketCounts[i] += source.bucketCounts[i];
  }
}

/**
 * Квантиль из кумулятивных бакетов с линейной интерполяцией (подход `histogram_quantile`).
 * `quantile` — доля 0..1; при пустой гистограмме — `null`.
 */
export function percentileFromHistogram(histogram: Histogram, quantile: number, total?: number): number | null {
  const totalCount = total ?? histogramCount(histogram);
  if (totalCount === 0) return null;

  const target = quantile * totalCount;
  let cumulative = 0;
  for (let i = 0; i < histogram.bucketCounts.length; i += 1) {
    const count = histogram.bucketCounts[i];
    if (count === 0) continue;
    const isLast = i === histogram.bucketCounts.length - 1;
    if (cumulative + count >= target || isLast) {
      const lower = i === 0 ? 0 : histogram.boundaries[i - 1];
      const upper = i < histogram.boundaries.length ? histogram.boundaries[i] : lower;
      if (upper <= lower) return lower;
      const within = Math.min(Math.max((target - cumulative) / count, 0), 1);
      return lower + (upper - lower) * within;
    }
    cumulative += count;
  }
  return null;
}
