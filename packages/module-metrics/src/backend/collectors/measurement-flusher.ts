import type { NewMetricEventRow } from '../schemas/index.js';
import type { AggregatedMeasurement, MeasurementBuffer } from '../services/measurement-buffer.js';
import type { CollectorConfig } from './config.js';
import type { SlowQueryInsert } from './sql-collector.js';

export interface CollectorLogger {
  error(obj: Record<string, unknown>, message: string): void;
}

export interface MeasurementSink {
  writeEvents(rows: NewMetricEventRow[]): Promise<void>;
  writeMeasurements(points: AggregatedMeasurement[]): Promise<void>;
  upsertSqlFingerprints(entries: { fingerprint: string; queryText: string }[]): Promise<void>;
  insertSlowQueries(rows: SlowQueryInsert[]): Promise<void>;
}

export interface MeasurementFlusherDeps {
  buffer: MeasurementBuffer;
  sink: MeasurementSink;
  config: CollectorConfig;
  updateConfig(): Promise<CollectorConfig>;
  drains?: {
    drainFingerprints(): { fingerprint: string; queryText: string }[];
    drainSlowQueries(): SlowQueryInsert[];
    drainEvents(): NewMetricEventRow[];
  };
  logger: CollectorLogger;
  intervalMs?: number;
}

/**
 * Раз в окно забирает из буфера пред-агрегированные точки и пишет их вместе с
 * SQL-fingerprint'ами и samples. При ошибке точки не теряются — остаются до следующего
 * флаша. Конфиг коллекторов обновляется перед каждым флашем.
 */
export class MeasurementFlusher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: AggregatedMeasurement[] = [];
  private flushing = false;

  constructor(private readonly deps: MeasurementFlusherDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.deps.intervalMs ?? 10_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    let points: AggregatedMeasurement[] = [];
    try {
      Object.assign(this.deps.config, await this.deps.updateConfig());
      points = [...this.pending, ...this.deps.buffer.drain()];
      this.pending = [];

      const events = this.deps.drains?.drainEvents() ?? [];
      if (events.length > 0) await this.deps.sink.writeEvents(events);

      if (points.length > 0) await this.deps.sink.writeMeasurements(points);

      const fingerprints = this.deps.drains?.drainFingerprints() ?? [];
      if (fingerprints.length > 0) await this.deps.sink.upsertSqlFingerprints(fingerprints);

      const slowQueries = this.deps.drains?.drainSlowQueries() ?? [];
      if (slowQueries.length > 0) await this.deps.sink.insertSlowQueries(slowQueries);
    } catch (error) {
      this.pending = points;
      this.deps.logger.error({ err: error }, 'Metrics flush failed');
    } finally {
      this.flushing = false;
    }
  }
}
