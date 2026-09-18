import { createHash } from 'node:crypto';
import { createHistogram, type Histogram, LATENCY_BOUNDARIES_SECONDS, recordHistogram } from './histogram.js';

export interface MeasurementSeries {
  instrument: string;
  kind: 'histogram' | 'counter' | 'gauge';
  unit: string;
  dims: Record<string, string>;
}

export interface AggregatedMeasurement {
  series: MeasurementSeries;
  bucket: Date;
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
  histogram: Histogram | null;
}

/** Стабильный ключ измерений: сортировка ключей + sha256 (одна серия — одна строка). */
export function hashDims(dims: Record<string, string>): string {
  const canonical = JSON.stringify(Object.entries(dims).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * In-process пред-агрегация: коллекторы копят наблюдения, флашер раз в окно забирает
 * готовые точки. В Postgres уезжает одна строка на (серию, окно), а не каждая выборка.
 */
export class MeasurementBuffer {
  private readonly buckets = new Map<string, AggregatedMeasurement>();

  constructor(
    private readonly windowMs = 10_000,
    private readonly boundaries: readonly number[] = LATENCY_BOUNDARIES_SECONDS,
  ) {}

  record(series: MeasurementSeries, value: number, at = Date.now()): void {
    const bucketMs = Math.floor(at / this.windowMs) * this.windowMs;
    const key = `${series.instrument}|${hashDims(series.dims)}|${bucketMs}`;
    let point = this.buckets.get(key);
    if (!point) {
      point = {
        series,
        bucket: new Date(bucketMs),
        count: 0,
        sum: 0,
        min: null,
        max: null,
        histogram: series.kind === 'histogram' ? createHistogram(this.boundaries) : null,
      };
      this.buckets.set(key, point);
    }

    point.count += 1;
    point.sum += value;
    point.min = point.min === null ? value : Math.min(point.min, value);
    point.max = point.max === null ? value : Math.max(point.max, value);
    if (point.histogram) recordHistogram(point.histogram, value);
  }

  drain(): AggregatedMeasurement[] {
    const points = [...this.buckets.values()];
    this.buckets.clear();
    return points;
  }

  size(): number {
    return this.buckets.size;
  }
}
