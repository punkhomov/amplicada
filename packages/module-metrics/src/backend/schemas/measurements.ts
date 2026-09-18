import { bigint, doublePrecision, integer, jsonb, real, text, timestamp } from 'drizzle-orm/pg-core';
import { metricsSchema } from './_schema.js';

/** Уникальная серия измерений: инструмент + канонические измерения (dims_hash). */
export const metricsSeries = metricsSchema.table('series', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  instrument: text('instrument').notNull(),
  kind: text('kind').notNull(),
  unit: text('unit').notNull(),
  boundaries: real('boundaries').array(),
  dims: jsonb('dims').$type<Record<string, string>>().notNull().default({}),
  dimsHash: text('dims_hash').notNull(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
});

/** Пред-агрегированные точки (окно флаша): count/sum/min/max + гистограмма. */
export const metricsPoints = metricsSchema.table('points', {
  seriesId: bigint('series_id', { mode: 'number' }).notNull(),
  bucket: timestamp('bucket', { withTimezone: true }).notNull(),
  count: bigint('count', { mode: 'number' }).notNull().default(0),
  sum: doublePrecision('sum').notNull().default(0),
  min: doublePrecision('min'),
  max: doublePrecision('max'),
  histogram: jsonb('histogram').$type<{ boundaries: number[]; bucketCounts: number[] } | null>(),
});

/** Тексты нормализованных SQL по fingerprint (без литералов). */
export const metricsSqlFingerprints = metricsSchema.table('sql_fingerprints', {
  fingerprint: text('fingerprint').primaryKey(),
  queryText: text('query_text').notNull(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
});

/** Выборочные экземпляры медленных/ошибочных SQL (tail-сэмплирование). */
export const metricsSlowQueries = metricsSchema.table('slow_queries', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  fingerprint: text('fingerprint').notNull(),
  queryText: text('query_text').notNull(),
  route: text('route'),
  durationMs: doublePrecision('duration_ms').notNull(),
  rowCount: integer('row_count'),
  errorCode: text('error_code'),
  requestId: text('request_id'),
});

export type MetricSeriesRow = typeof metricsSeries.$inferSelect;
export type MetricPointRow = typeof metricsPoints.$inferSelect;
export type SqlFingerprintRow = typeof metricsSqlFingerprints.$inferSelect;
export type SlowQueryRow = typeof metricsSlowQueries.$inferSelect;
