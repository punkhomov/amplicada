import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, count, desc, eq, gte, ilike, lt, max, min, type SQL, sql } from 'drizzle-orm';
import type { MetricCatalogEntryDto, MetricEventKind } from '../../contracts/index.js';
import {
  type MetricEventRow,
  type MetricsSettingsRow,
  metricsEvents,
  metricsPoints,
  metricsSeries,
  metricsSettings,
  metricsSlowQueries,
  metricsSqlFingerprints,
  type NewMetricEventRow,
  type SlowQueryRow,
} from '../schemas/index.js';
import { createHistogram, type Histogram, histogramCount, LATENCY_BOUNDARIES_SECONDS, percentileFromHistogram } from './histogram.js';
import { type AggregatedMeasurement, hashDims, type MeasurementSeries } from './measurement-buffer.js';

export interface EventListFilter {
  kind?: MetricEventKind;
  name?: string;
  limit?: number;
}

export interface RouteSummary {
  route: string;
  calls: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface SqlSummary {
  fingerprint: string;
  queryText: string;
  calls: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  lastSeen: string | null;
}

export interface MeasurementWriteResult {
  series: number;
  points: number;
}

export type MetricsSettingsPatchRow = Partial<
  Pick<
    MetricsSettingsRow,
    | 'enabled'
    | 'retentionEventsDays'
    | 'retentionPointsDays'
    | 'samplePageviewRate'
    | 'sampleClickRate'
    | 'ingestEventsPerMinute'
    | 'slowSqlThresholdMs'
    | 'sampleSqlRate'
    | 'storeRawUrls'
  >
>;

export function createPostgresMetricsStore(db: BackendDbService) {
  return {
    async insertEvents(rows: NewMetricEventRow[]): Promise<{ inserted: number; duplicates: number }> {
      if (rows.length === 0) return { inserted: 0, duplicates: 0 };
      const inserted = await db.insert(metricsEvents).values(rows).onConflictDoNothing().returning({ id: metricsEvents.id });
      return { inserted: inserted.length, duplicates: rows.length - inserted.length };
    },

    async listEvents(filter: EventListFilter = {}): Promise<MetricEventRow[]> {
      const conditions: SQL[] = [];
      if (filter.kind) conditions.push(eq(metricsEvents.kind, filter.kind));
      if (filter.name) conditions.push(ilike(metricsEvents.name, `%${filter.name}%`));
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
      return db
        .select()
        .from(metricsEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(metricsEvents.occurredAt))
        .limit(limit);
    },

    /** Запись пред-агрегированных точек: series upsert + points insert. */
    async writeMeasurements(points: AggregatedMeasurement[]): Promise<MeasurementWriteResult> {
      if (points.length === 0) return { series: 0, points: 0 };

      const seriesByKey = new Map<string, MeasurementSeries>();
      for (const point of points) {
        seriesByKey.set(`${point.series.instrument}|${hashDims(point.series.dims)}`, point.series);
      }

      const seriesRows = [...seriesByKey.entries()].map(([key, series]) => {
        const [, dimsHash] = key.split('|');
        return {
          instrument: series.instrument,
          kind: series.kind,
          unit: series.unit,
          boundaries: series.kind === 'histogram' ? [...LATENCY_BOUNDARIES_SECONDS] : null,
          dims: series.dims,
          dimsHash: dimsHash ?? '',
        };
      });

      const persisted = await db
        .insert(metricsSeries)
        .values(seriesRows)
        .onConflictDoUpdate({
          target: [metricsSeries.instrument, metricsSeries.dimsHash],
          set: { lastSeen: new Date() },
        })
        .returning({ id: metricsSeries.id, instrument: metricsSeries.instrument, dimsHash: metricsSeries.dimsHash });

      const idByKey = new Map(persisted.map(row => [`${row.instrument}|${row.dimsHash}`, row.id]));
      const pointRows = points
        .map(point => {
          const seriesId = idByKey.get(`${point.series.instrument}|${hashDims(point.series.dims)}`);
          if (seriesId === undefined) return null;
          return {
            seriesId,
            bucket: point.bucket,
            count: point.count,
            sum: point.sum,
            min: point.min,
            max: point.max,
            histogram: point.histogram ? { boundaries: point.histogram.boundaries, bucketCounts: point.histogram.bucketCounts } : null,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (pointRows.length > 0) {
        await db.insert(metricsPoints).values(pointRows).onConflictDoNothing();
      }
      return { series: seriesRows.length, points: pointRows.length };
    },

    /** Тексты новых SQL-fingerprint: обновляем last_seen, не плодим дубли. */
    async upsertSqlFingerprints(entries: { fingerprint: string; queryText: string }[]): Promise<void> {
      const unique = new Map(entries.map(entry => [entry.fingerprint, entry]));
      if (unique.size === 0) return;
      await db
        .insert(metricsSqlFingerprints)
        .values([...unique.values()].map(entry => ({ fingerprint: entry.fingerprint, queryText: entry.queryText })))
        .onConflictDoUpdate({
          target: metricsSqlFingerprints.fingerprint,
          set: { lastSeen: new Date() },
        });
    },

    async insertSlowQueries(rows: (typeof metricsSlowQueries.$inferInsert)[]): Promise<void> {
      if (rows.length === 0) return;
      await db.insert(metricsSlowQueries).values(rows);
    },

    async listSlowQueries(from: Date, to: Date, limit = 50): Promise<SlowQueryRow[]> {
      return db
        .select()
        .from(metricsSlowQueries)
        .where(and(gte(metricsSlowQueries.at, from), lt(metricsSlowQueries.at, to)))
        .orderBy(desc(metricsSlowQueries.at))
        .limit(Math.min(Math.max(limit, 1), 200));
    },

    /** Сводка по роутам за период: counts/errors/avg + перцентили из слитых гистограмм. */
    async routesSummary(from: Date, to: Date, limit = 100): Promise<RouteSummary[]> {
      const totalsResult = await db.execute(sql`
        select coalesce(s.dims->>'route', '<unattributed>') as route,
               sum(p.count)::bigint as calls,
               sum(case when s.dims->>'status_class' = '5xx' then p.count else 0 end)::bigint as errors,
               sum(p.sum) as total_seconds,
               coalesce(max(p.max), 0) as max_seconds
        from metrics.points p
        join metrics.series s on s.id = p.series_id
        where s.instrument = 'http.server.request.duration' and p.bucket >= ${from} and p.bucket < ${to}
        group by 1
        order by 2 desc
        limit ${limit}
      `);

      const histogramResult = await db.execute(sql`
        select coalesce(s.dims->>'route', '<unattributed>') as route,
               (b.idx - 1)::int as idx,
               sum((b.value)::bigint)::bigint as count
        from metrics.points p
        join metrics.series s on s.id = p.series_id
        cross join lateral jsonb_array_elements_text(p.histogram->'bucketCounts') with ordinality as b(value, idx)
        where s.instrument = 'http.server.request.duration' and p.bucket >= ${from} and p.bucket < ${to}
        group by 1, 2
      `);

      const histograms = new Map<string, Histogram>();
      for (const row of histogramResult.rows as { route: string; idx: number; count: string }[]) {
        let histogram = histograms.get(row.route);
        if (!histogram) {
          histogram = createHistogram();
          histograms.set(row.route, histogram);
        }
        const index = Number(row.idx);
        if (index >= 0 && index < histogram.bucketCounts.length) {
          histogram.bucketCounts[index] += Number(row.count);
        }
      }

      return (totalsResult.rows as { route: string; calls: string; errors: string; total_seconds: number; max_seconds: number }[]).map(
        row => {
          const calls = Number(row.calls);
          const errors = Number(row.errors);
          const totalSeconds = Number(row.total_seconds);
          const histogram = histograms.get(row.route) ?? createHistogram();
          const total = histogramCount(histogram);
          const percentile = (quantile: number) => (percentileFromHistogram(histogram, quantile, total) ?? 0) * 1000;
          return {
            route: row.route,
            calls,
            errors,
            errorRate: calls > 0 ? errors / calls : 0,
            avgMs: calls > 0 ? (totalSeconds / calls) * 1000 : 0,
            p50Ms: percentile(0.5),
            p95Ms: percentile(0.95),
            p99Ms: percentile(0.99),
            maxMs: Number(row.max_seconds) * 1000,
          };
        },
      );
    },

    /** Топ SQL по суммарному времени: вызовы, avg, p95, текст запроса. */
    async sqlSummary(from: Date, to: Date, limit = 50): Promise<SqlSummary[]> {
      const totalsResult = await db.execute(sql`
        select s.dims->>'fingerprint' as fingerprint,
               max(f.query_text) as query_text,
               max(f.last_seen) as last_seen,
               sum(p.count)::bigint as calls,
               sum(p.sum) as total_seconds,
               coalesce(max(p.max), 0) as max_seconds
        from metrics.points p
        join metrics.series s on s.id = p.series_id
        left join metrics.sql_fingerprints f on f.fingerprint = s.dims->>'fingerprint'
        where s.instrument = 'db.client.operation.duration' and p.bucket >= ${from} and p.bucket < ${to}
        group by 1
        order by 5 desc
        limit ${limit}
      `);

      const histogramResult = await db.execute(sql`
        select s.dims->>'fingerprint' as fingerprint,
               (b.idx - 1)::int as idx,
               sum((b.value)::bigint)::bigint as count
        from metrics.points p
        join metrics.series s on s.id = p.series_id
        cross join lateral jsonb_array_elements_text(p.histogram->'bucketCounts') with ordinality as b(value, idx)
        where s.instrument = 'db.client.operation.duration' and p.bucket >= ${from} and p.bucket < ${to}
        group by 1, 2
      `);

      const histograms = new Map<string, Histogram>();
      for (const row of histogramResult.rows as { fingerprint: string; idx: number; count: string }[]) {
        let histogram = histograms.get(row.fingerprint);
        if (!histogram) {
          histogram = createHistogram();
          histograms.set(row.fingerprint, histogram);
        }
        const index = Number(row.idx);
        if (index >= 0 && index < histogram.bucketCounts.length) {
          histogram.bucketCounts[index] += Number(row.count);
        }
      }

      return (
        totalsResult.rows as {
          fingerprint: string;
          query_text: string | null;
          last_seen: Date | null;
          calls: string;
          total_seconds: number;
          max_seconds: number;
        }[]
      ).map(row => {
        const calls = Number(row.calls);
        const histogram = histograms.get(row.fingerprint) ?? createHistogram();
        return {
          fingerprint: row.fingerprint,
          queryText: row.query_text ?? '',
          calls,
          avgMs: calls > 0 ? (Number(row.total_seconds) / calls) * 1000 : 0,
          p95Ms: (percentileFromHistogram(histogram, 0.95) ?? 0) * 1000,
          maxMs: Number(row.max_seconds) * 1000,
          lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
        };
      });
    },

    /** Что уже приходило: имя, вид, объём, первое/последнее появление — витрина для админки. */
    async catalog(limit = 200): Promise<MetricCatalogEntryDto[]> {
      const eventCount = count();
      const rows = await db
        .select({
          name: metricsEvents.name,
          kind: metricsEvents.kind,
          eventCount,
          firstSeen: min(metricsEvents.occurredAt),
          lastSeen: max(metricsEvents.occurredAt),
        })
        .from(metricsEvents)
        .groupBy(metricsEvents.name, metricsEvents.kind)
        .orderBy(desc(eventCount))
        .limit(Math.min(Math.max(limit, 1), 500));

      return rows.map(row => ({
        name: row.name,
        kind: row.kind,
        eventCount: row.eventCount,
        firstSeen: (row.firstSeen ?? new Date()).toISOString(),
        lastSeen: (row.lastSeen ?? new Date()).toISOString(),
      }));
    },

    async getSettingsRow(): Promise<MetricsSettingsRow | undefined> {
      const [row] = await db.select().from(metricsSettings).where(eq(metricsSettings.id, 'default')).limit(1);
      return row;
    },

    async updateSettingsRow(patch: MetricsSettingsPatchRow): Promise<MetricsSettingsRow | undefined> {
      const [row] = await db
        .update(metricsSettings)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(metricsSettings.id, 'default'))
        .returning();
      return row;
    },
  };
}

export type PostgresMetricsStore = ReturnType<typeof createPostgresMetricsStore>;
