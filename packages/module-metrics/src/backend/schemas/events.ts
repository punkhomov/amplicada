import { integer, jsonb, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { MetricAttrValue, MetricEventKind } from '../../contracts/index.js';
import { metricsSchema } from './_schema.js';

/**
 * Append-only события, партиционированы по `occurred_at` (месяц). Схема описана и в
 * `migrations/0000_init.sql` — drizzle-kit не подключён, миграции пишутся руками.
 */
export const metricsEvents = metricsSchema.table(
  'events',
  {
    id: uuid('id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    name: text('name').notNull(),
    kind: text('kind').$type<MetricEventKind>().notNull(),
    module: text('module'),
    actorKind: text('actor_kind'),
    actorHash: text('actor_hash'),
    sessionHash: text('session_hash'),
    route: text('route'),
    url: text('url'),
    referrer: text('referrer'),
    release: text('release'),
    instance: text('instance'),
    attributes: jsonb('attributes').$type<Record<string, MetricAttrValue>>().notNull().default({}),
    measures: jsonb('measures').$type<Record<string, number>>().notNull().default({}),
    samplingRate: real('sampling_rate'),
    errorFingerprint: text('error_fingerprint'),
    schemaVersion: integer('schema_version').notNull().default(1),
  },
  table => [primaryKey({ columns: [table.occurredAt, table.id] })],
);

export type MetricEventRow = typeof metricsEvents.$inferSelect;
export type NewMetricEventRow = typeof metricsEvents.$inferInsert;
