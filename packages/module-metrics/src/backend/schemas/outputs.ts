import { bigint, boolean, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { metricsSchema } from './_schema.js';

/** Конфигурация выхода (sink): включён ли, куда и что отправлять. */
export const metricsSinkConfigs = metricsSchema.table('sink_configs', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  mapping: jsonb('mapping').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Durable-очередь доставки: одна строка на (выход, событие). */
export const metricsOutbox = metricsSchema.table('outbox', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  sinkId: text('sink_id').notNull(),
  itemKind: text('item_kind').notNull(),
  itemId: text('item_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Журнал доставки: успехи, ошибки, DLQ — для UI «Доставка». */
export const metricsSinkDeliveries = metricsSchema.table('sink_deliveries', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  sinkId: text('sink_id').notNull(),
  itemId: text('item_id').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull(),
  error: text('error'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export type SinkConfigRow = typeof metricsSinkConfigs.$inferSelect;
export type OutboxRow = typeof metricsOutbox.$inferSelect;
export type SinkDeliveryRow = typeof metricsSinkDeliveries.$inferSelect;
