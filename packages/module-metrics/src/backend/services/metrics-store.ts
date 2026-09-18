import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, count, desc, eq, gte, ilike, inArray, lt, max, min, type SQL, sql } from 'drizzle-orm';
import type { AlertTarget, MetricCatalogEntryDto, MetricEventKind } from '../../contracts/index.js';
import {
  type AlertEventRow,
  type AlertInstanceRow,
  type AlertRuleRow,
  type ErrorIssueRow,
  type MetricEventRow,
  type MetricsSettingsRow,
  metricsAlertEvents,
  metricsAlertInstances,
  metricsAlertRules,
  metricsErrorIssues,
  metricsEvents,
  metricsOutbox,
  metricsPoints,
  metricsSeries,
  metricsSettings,
  metricsSinkConfigs,
  metricsSinkDeliveries,
  metricsSlowQueries,
  metricsSqlFingerprints,
  type NewMetricEventRow,
  type OutboxRow,
  type SinkConfigRow,
  type SlowQueryRow,
} from '../schemas/index.js';
import type { OutboxDeliveryInput } from '../sinks/outbox-dispatcher.js';
import { createHistogram, type Histogram, histogramCount, LATENCY_BOUNDARIES_SECONDS, percentileFromHistogram } from './histogram.js';
import { type AggregatedMeasurement, hashDims, type MeasurementSeries } from './measurement-buffer.js';
import { VITAL_SPECS } from './web-vitals.js';

const VITAL_SPEC_BY_INSTRUMENT = new Map(Object.values(VITAL_SPECS).map(spec => [spec.instrument, spec]));

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

export interface ErrorIssueInput {
  fingerprint: string;
  errorType: string;
  messageTemplate: string;
  route: string | null;
  release: string | null;
}

export interface ErrorIssueSummary extends ErrorIssueRow {
  periodCount: number;
  affectedActors: number;
}

export interface VitalSummary {
  instrument: string;
  unit: string;
  calls: number;
  p75: number;
  p95: number;
  good: number;
  needsImprovement: number;
  poor: number;
}

export interface SinkConfigPatchRow {
  enabled?: boolean;
  settings?: Record<string, unknown>;
  mapping?: Record<string, unknown>;
}

export interface MeasurementAlertSummary {
  calls: number;
  avgMs: number;
  p95Ms: number;
}

export interface OutboxEnqueueRow {
  sinkId: string;
  itemKind: string;
  itemId: string;
  payload: Record<string, unknown>;
}

export interface EventSeriesQuery {
  name?: string;
  eventPrefix?: string;
  measure?: string;
  groupBy?: string;
  from: Date;
  to: Date;
  stepSeconds: number;
}

export interface EventSeriesResult {
  key: string;
  points: { t: Date; v: number }[];
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
    async insertEvents(rows: NewMetricEventRow[]): Promise<{ inserted: number; duplicates: number; insertedIds: string[] }> {
      if (rows.length === 0) return { inserted: 0, duplicates: 0, insertedIds: [] };
      const inserted = await db.insert(metricsEvents).values(rows).onConflictDoNothing().returning({ id: metricsEvents.id });
      return {
        inserted: inserted.length,
        duplicates: rows.length - inserted.length,
        insertedIds: inserted.map(row => row.id),
      };
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

    // --- Алерты: правила, состояния, история ---

    async listAlertRules(enabledOnly = false): Promise<AlertRuleRow[]> {
      const query = db.select().from(metricsAlertRules).orderBy(desc(metricsAlertRules.createdAt));
      if (enabledOnly) return query.where(eq(metricsAlertRules.enabled, true));
      return query;
    },

    async getAlertRule(id: string): Promise<AlertRuleRow | undefined> {
      const [row] = await db.select().from(metricsAlertRules).where(eq(metricsAlertRules.id, id)).limit(1);
      return row;
    },

    async insertAlertRule(row: typeof metricsAlertRules.$inferInsert): Promise<AlertRuleRow> {
      const [created] = await db.insert(metricsAlertRules).values(row).returning();
      return created;
    },

    async updateAlertRule(id: string, patch: Partial<typeof metricsAlertRules.$inferInsert>): Promise<AlertRuleRow | undefined> {
      const [row] = await db
        .update(metricsAlertRules)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(metricsAlertRules.id, id))
        .returning();
      return row;
    },

    async deleteAlertRule(id: string): Promise<boolean> {
      const deleted = await db.delete(metricsAlertRules).where(eq(metricsAlertRules.id, id)).returning({ id: metricsAlertRules.id });
      return deleted.length > 0;
    },

    async listAlertInstances(): Promise<(AlertInstanceRow & { ruleName: string })[]> {
      const rows = await db
        .select({ instance: metricsAlertInstances, ruleName: metricsAlertRules.name })
        .from(metricsAlertInstances)
        .innerJoin(metricsAlertRules, eq(metricsAlertRules.id, metricsAlertInstances.ruleId))
        .orderBy(desc(metricsAlertInstances.activeAt));
      return rows.map(row => ({ ...row.instance, ruleName: row.ruleName }));
    },

    async getAlertInstance(ruleId: string, fingerprint: string): Promise<AlertInstanceRow | undefined> {
      const [row] = await db
        .select()
        .from(metricsAlertInstances)
        .where(and(eq(metricsAlertInstances.ruleId, ruleId), eq(metricsAlertInstances.fingerprint, fingerprint)))
        .limit(1);
      return row;
    },

    async upsertAlertInstance(row: typeof metricsAlertInstances.$inferInsert): Promise<void> {
      await db
        .insert(metricsAlertInstances)
        .values(row)
        .onConflictDoUpdate({
          target: [metricsAlertInstances.ruleId, metricsAlertInstances.fingerprint],
          set: {
            state: row.state,
            value: row.value,
            labels: row.labels,
            lastEvalAt: row.lastEvalAt,
            activeAt: row.activeAt,
            resolvedAt: null,
          },
        });
    },

    async deleteAlertInstance(ruleId: string, fingerprint: string): Promise<void> {
      await db
        .delete(metricsAlertInstances)
        .where(and(eq(metricsAlertInstances.ruleId, ruleId), eq(metricsAlertInstances.fingerprint, fingerprint)));
    },

    async insertAlertEvent(row: typeof metricsAlertEvents.$inferInsert): Promise<void> {
      await db.insert(metricsAlertEvents).values(row);
    },

    async listAlertEvents(limit = 50): Promise<(AlertEventRow & { ruleName: string })[]> {
      const rows = await db
        .select({ event: metricsAlertEvents, ruleName: metricsAlertRules.name })
        .from(metricsAlertEvents)
        .innerJoin(metricsAlertRules, eq(metricsAlertRules.id, metricsAlertEvents.ruleId))
        .orderBy(desc(metricsAlertEvents.at))
        .limit(Math.min(Math.max(limit, 1), 200));
      return rows.map(row => ({ ...row.event, ruleName: row.ruleName }));
    },

    async pruneAlertEvents(before: Date): Promise<number> {
      const deleted = await db.delete(metricsAlertEvents).where(lt(metricsAlertEvents.at, before)).returning({ id: metricsAlertEvents.id });
      return deleted.length;
    },

    /** Значение цели за окно: число событий по имени (с фильтрами). */
    async eventCount(target: AlertTarget, from: Date, to: Date): Promise<number> {
      const conditions: SQL[] = [eq(metricsEvents.name, target.key), gte(metricsEvents.occurredAt, from), lt(metricsEvents.occurredAt, to)];
      for (const [key, value] of Object.entries(target.filters ?? {})) {
        if (key === 'route') conditions.push(eq(metricsEvents.route, value));
        else if (key === 'module') conditions.push(eq(metricsEvents.module, value));
        else if (key === 'actor_kind') conditions.push(eq(metricsEvents.actorKind, value));
        else if (key.startsWith('attributes.')) {
          conditions.push(sql`${metricsEvents.attributes}->>${key.slice('attributes.'.length)} = ${value}`);
        }
      }
      const [row] = await db
        .select({ value: count() })
        .from(metricsEvents)
        .where(and(...conditions));
      return Number(row?.value ?? 0);
    },

    /** Сводка измерения за окно: calls, avg и p95 (из гистограмм), значения в мс. */
    async measurementSummary(target: AlertTarget, from: Date, to: Date): Promise<MeasurementAlertSummary> {
      const dimFilters = Object.entries(target.filters ?? {}).map(([key, value]) => sql`and s.dims->>${key} = ${value}`);

      const totals = await db.execute(sql`
        select coalesce(sum(p.count), 0)::bigint as calls,
               coalesce(sum(p.sum), 0) as total,
               coalesce(max(s.unit), 's') as unit
        from metrics.points p
        join metrics.series s on s.id = p.series_id
        where s.instrument = ${target.key} and p.bucket >= ${from} and p.bucket < ${to} ${dimFilters}
      `);
      const totalRow = (totals.rows as { calls: string; total: number; unit: string }[])[0];
      const calls = Number(totalRow?.calls ?? 0);
      const total = Number(totalRow?.total ?? 0);
      const toMs = totalRow?.unit === 'ms' || totalRow?.unit === '1' ? 1 : 1000;

      const histogram = await db.execute(sql`
        select (b.idx - 1)::int as idx, sum((b.value)::bigint)::bigint as count
        from metrics.points p
        join metrics.series s on s.id = p.series_id
        cross join lateral jsonb_array_elements_text(p.histogram->'bucketCounts') with ordinality as b(value, idx)
        where s.instrument = ${target.key} and p.bucket >= ${from} and p.bucket < ${to} ${dimFilters}
        group by 1
      `);
      const boundsResult = await db.execute(sql`
        select boundaries from metrics.series
        where instrument = ${target.key} and boundaries is not null
        limit 1
      `);
      const boundaries = (boundsResult.rows as { boundaries: number[] }[])[0]?.boundaries ?? LATENCY_BOUNDARIES_SECONDS;
      const merged = createHistogram(boundaries);
      for (const row of histogram.rows as { idx: number; count: string }[]) {
        const index = Number(row.idx);
        if (index >= 0 && index < merged.bucketCounts.length) merged.bucketCounts[index] += Number(row.count);
      }

      return {
        calls,
        avgMs: calls > 0 ? (total / calls) * toMs : 0,
        p95Ms: (percentileFromHistogram(merged, 0.95) ?? 0) * toMs,
      };
    },

    // --- Выходы: конфиги, очередь, доставки ---

    async listSinkConfigs(): Promise<SinkConfigRow[]> {
      return db.select().from(metricsSinkConfigs).orderBy(metricsSinkConfigs.id);
    },

    async getSinkConfig(id: string): Promise<SinkConfigRow | undefined> {
      const [row] = await db.select().from(metricsSinkConfigs).where(eq(metricsSinkConfigs.id, id)).limit(1);
      return row;
    },

    async updateSinkConfig(id: string, patch: SinkConfigPatchRow): Promise<SinkConfigRow | undefined> {
      const [row] = await db
        .update(metricsSinkConfigs)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(metricsSinkConfigs.id, id))
        .returning();
      return row;
    },

    async enqueueOutbox(rows: OutboxEnqueueRow[]): Promise<number> {
      if (rows.length === 0) return 0;
      const inserted = await db.insert(metricsOutbox).values(rows).onConflictDoNothing().returning({ id: metricsOutbox.id });
      return inserted.length;
    },

    async listDueOutbox(limit: number): Promise<OutboxRow[]> {
      return db
        .select()
        .from(metricsOutbox)
        .where(and(eq(metricsOutbox.status, 'pending'), lt(metricsOutbox.nextAttemptAt, new Date())))
        .orderBy(metricsOutbox.id)
        .limit(limit);
    },

    async markOutboxSent(ids: number[]): Promise<void> {
      if (ids.length === 0) return;
      await db.update(metricsOutbox).set({ status: 'sent' }).where(inArray(metricsOutbox.id, ids));
    },

    async markOutboxDead(id: number, error: string): Promise<void> {
      await db.update(metricsOutbox).set({ status: 'dead', lastError: error }).where(eq(metricsOutbox.id, id));
    },

    async markOutboxRetry(id: number, attempts: number, nextAttemptAt: Date, error: string): Promise<void> {
      await db.update(metricsOutbox).set({ attempts, nextAttemptAt, lastError: error }).where(eq(metricsOutbox.id, id));
    },

    async insertDeliveries(rows: OutboxDeliveryInput[]): Promise<void> {
      if (rows.length === 0) return;
      await db.insert(metricsSinkDeliveries).values(rows);
    },

    async listDeliveries(limit: number, sinkId?: string): Promise<(typeof metricsSinkDeliveries.$inferSelect)[]> {
      const conditions = sinkId ? and(eq(metricsSinkDeliveries.sinkId, sinkId)) : undefined;
      return db
        .select()
        .from(metricsSinkDeliveries)
        .where(conditions)
        .orderBy(desc(metricsSinkDeliveries.at))
        .limit(Math.min(Math.max(limit, 1), 200));
    },

    async outboxStatsBySink(): Promise<Map<string, { pending: number; dead: number }>> {
      const result = await db.execute(sql`
        select sink_id,
               count(*) filter (where status = 'pending')::bigint as pending,
               count(*) filter (where status = 'dead')::bigint as dead
        from metrics.outbox
        group by 1
      `);
      return new Map(
        (result.rows as { sink_id: string; pending: string; dead: string }[]).map(row => [
          row.sink_id,
          { pending: Number(row.pending), dead: Number(row.dead) },
        ]),
      );
    },

    async exportEvents(
      from: Date,
      to: Date,
      kind: MetricEventKind | undefined,
      name: string | undefined,
      limit = 5000,
    ): Promise<MetricEventRow[]> {
      const conditions: SQL[] = [gte(metricsEvents.occurredAt, from), lt(metricsEvents.occurredAt, to)];
      if (kind) conditions.push(eq(metricsEvents.kind, kind));
      if (name) conditions.push(ilike(metricsEvents.name, `%${name}%`));
      return db
        .select()
        .from(metricsEvents)
        .where(and(...conditions))
        .orderBy(desc(metricsEvents.occurredAt))
        .limit(Math.min(Math.max(limit, 1), 20_000));
    },

    /** Upsert сгруппированных ошибок: счётчик растёт, рамки жизни и релизы обновляются. */
    async upsertErrorIssues(issues: ErrorIssueInput[], counts: Map<string, number>, now = new Date()): Promise<void> {
      for (const issue of issues) {
        const increment = counts.get(issue.fingerprint) ?? 1;
        await db
          .insert(metricsErrorIssues)
          .values({
            fingerprint: issue.fingerprint,
            errorType: issue.errorType,
            messageTemplate: issue.messageTemplate,
            route: issue.route,
            issueCount: increment,
            firstSeen: now,
            lastSeen: now,
            firstRelease: issue.release,
            lastRelease: issue.release,
          })
          .onConflictDoUpdate({
            target: metricsErrorIssues.fingerprint,
            set: {
              issueCount: sql`${metricsErrorIssues.issueCount} + ${increment}`,
              lastSeen: now,
              route: sql`coalesce(excluded.route, ${metricsErrorIssues.route})`,
              lastRelease: sql`coalesce(excluded.last_release, ${metricsErrorIssues.lastRelease})`,
            },
          });
      }
    },

    async listErrorIssues(from: Date, to: Date, limit = 50): Promise<ErrorIssueSummary[]> {
      const result = await db.execute(sql`
        select i.fingerprint, i.error_type, i.message_template, i.route,
               i.issue_count, i.first_seen, i.last_seen, i.first_release, i.last_release,
               count(e.id)::bigint as period_count,
               count(distinct e.actor_hash)::bigint as affected_actors
        from metrics.error_issues i
        join metrics.events e
          on e.error_fingerprint = i.fingerprint and e.occurred_at >= ${from} and e.occurred_at < ${to}
        group by 1, 2, 3, 4, 5, 6, 7, 8, 9
        order by 10 desc
        limit ${limit}
      `);

      return (result.rows as Record<string, unknown>[]).map(row => ({
        fingerprint: String(row.fingerprint),
        errorType: String(row.error_type),
        messageTemplate: String(row.message_template),
        route: row.route === null ? null : String(row.route),
        issueCount: Number(row.issue_count),
        firstSeen: new Date(row.first_seen as string),
        lastSeen: new Date(row.last_seen as string),
        firstRelease: row.first_release === null ? null : String(row.first_release),
        lastRelease: row.last_release === null ? null : String(row.last_release),
        periodCount: Number(row.period_count),
        affectedActors: Number(row.affected_actors),
      }));
    },

    async listErrorSamples(fingerprint: string, limit = 20): Promise<MetricEventRow[]> {
      return db
        .select()
        .from(metricsEvents)
        .where(eq(metricsEvents.errorFingerprint, fingerprint))
        .orderBy(desc(metricsEvents.occurredAt))
        .limit(Math.min(Math.max(limit, 1), 100));
    },

    /** Web Vitals: перцентили из гистограмм + раскладка по рейтингам из атрибутов событий. */
    async vitalsSummary(from: Date, to: Date): Promise<VitalSummary[]> {
      const totalsResult = await db.execute(sql`
        select s.instrument as instrument,
               max(s.unit) as unit,
               sum(p.count)::bigint as calls
        from metrics.points p
        join metrics.series s on s.id = p.series_id
        where s.instrument like 'web_vital.%' and p.bucket >= ${from} and p.bucket < ${to}
        group by 1
      `);

      const histogramResult = await db.execute(sql`
        select s.instrument as instrument,
               (b.idx - 1)::int as idx,
               sum((b.value)::bigint)::bigint as count
        from metrics.points p
        join metrics.series s on s.id = p.series_id
        cross join lateral jsonb_array_elements_text(p.histogram->'bucketCounts') with ordinality as b(value, idx)
        where s.instrument like 'web_vital.%' and p.bucket >= ${from} and p.bucket < ${to}
        group by 1, 2
      `);

      const ratingsResult = await db.execute(sql`
        select name, coalesce(attributes->>'rating', 'unknown') as rating, count(*)::bigint as count
        from metrics.events
        where kind = 'web_vital' and occurred_at >= ${from} and occurred_at < ${to}
        group by 1, 2
      `);

      const histograms = new Map<string, Histogram>();
      for (const row of histogramResult.rows as { instrument: string; idx: number; count: string }[]) {
        let histogram = histograms.get(row.instrument);
        if (!histogram) {
          const spec = VITAL_SPEC_BY_INSTRUMENT.get(row.instrument);
          histogram = createHistogram(spec?.boundaries ?? LATENCY_BOUNDARIES_SECONDS);
          histograms.set(row.instrument, histogram);
        }
        const index = Number(row.idx);
        if (index >= 0 && index < histogram.bucketCounts.length) histogram.bucketCounts[index] += Number(row.count);
      }

      const ratings = new Map<string, { good: number; needsImprovement: number; poor: number }>();
      for (const row of ratingsResult.rows as { name: string; rating: string; count: string }[]) {
        const entry = ratings.get(row.name) ?? { good: 0, needsImprovement: 0, poor: 0 };
        const count = Number(row.count);
        if (row.rating === 'good') entry.good += count;
        else if (row.rating === 'needs-improvement') entry.needsImprovement += count;
        else if (row.rating === 'poor') entry.poor += count;
        ratings.set(row.name, entry);
      }

      return (totalsResult.rows as { instrument: string; unit: string; calls: string }[]).map(row => {
        const histogram = histograms.get(row.instrument) ?? createHistogram();
        const rating = ratings.get(row.instrument) ?? { good: 0, needsImprovement: 0, poor: 0 };
        return {
          instrument: row.instrument,
          unit: row.unit,
          calls: Number(row.calls),
          p75: percentileFromHistogram(histogram, 0.75) ?? 0,
          p95: percentileFromHistogram(histogram, 0.95) ?? 0,
          ...rating,
        };
      });
    },

    /** Серии событий по времени: count (или sum measures) с шагом и опциональной группировкой. */
    async eventSeries(query: EventSeriesQuery): Promise<EventSeriesResult[]> {
      const group = query.groupBy ? sql`coalesce(attributes->>${query.groupBy}, '<none>')` : sql`'total'`;
      const value = query.measure
        ? sql`coalesce(sum((measures->>${query.measure})::double precision), 0)`
        : sql`count(*)::double precision`;
      const nameFilter = query.name
        ? sql`and name = ${query.name}`
        : query.eventPrefix
          ? sql`and name like ${`${query.eventPrefix}%`}`
          : sql``;

      const result = await db.execute(sql`
        select date_bin(make_interval(secs => ${query.stepSeconds}), occurred_at, '2000-01-01') as bucket,
               ${group} as key,
               ${value} as value
        from metrics.events
        where occurred_at >= ${query.from} and occurred_at < ${query.to} ${nameFilter}
        group by 1, 2
        order by 1
      `);

      const byKey = new Map<string, { t: Date; v: number }[]>();
      for (const row of result.rows as { bucket: Date; key: string; value: number }[]) {
        const list = byKey.get(row.key) ?? [];
        list.push({ t: new Date(row.bucket), v: Number(row.value) });
        byKey.set(row.key, list);
      }
      return [...byKey.entries()].map(([key, points]) => ({ key, points }));
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
        const point = points.find(candidate => candidate.series === series);
        return {
          instrument: series.instrument,
          kind: series.kind,
          unit: series.unit,
          boundaries:
            series.kind === 'histogram' ? [...(point?.histogram?.boundaries ?? series.boundaries ?? LATENCY_BOUNDARIES_SECONDS)] : null,
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
