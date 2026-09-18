import { bigint, boolean, doublePrecision, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AlertCondition, AlertSeverity, AlertTarget } from '../../contracts/index.js';
import { metricsSchema } from './_schema.js';

export const metricsAlertRules = metricsSchema.table('alert_rules', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  severity: text('severity').$type<AlertSeverity>().notNull().default('warning'),
  target: jsonb('target').$type<AlertTarget>().notNull(),
  windowMs: bigint('window_ms', { mode: 'number' }).notNull(),
  condition: jsonb('condition').$type<AlertCondition>().notNull(),
  delivery: jsonb('delivery').$type<{ eventBus?: boolean }>().notNull().default({ eventBus: true }),
  labels: jsonb('labels').$type<Record<string, string>>().notNull().default({}),
  annotations: jsonb('annotations').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const metricsAlertInstances = metricsSchema.table('alert_instances', {
  ruleId: uuid('rule_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  state: text('state').$type<'pending' | 'firing' | 'resolved'>().notNull(),
  value: doublePrecision('value'),
  labels: jsonb('labels').$type<Record<string, string>>().notNull().default({}),
  activeAt: timestamp('active_at', { withTimezone: true }).notNull(),
  lastEvalAt: timestamp('last_eval_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const metricsAlertEvents = metricsSchema.table('alert_events', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  ruleId: uuid('rule_id').notNull(),
  state: text('state').$type<'firing' | 'resolved'>().notNull(),
  severity: text('severity').$type<AlertSeverity>().notNull(),
  value: doublePrecision('value'),
  labels: jsonb('labels').$type<Record<string, string>>().notNull().default({}),
  message: text('message'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export type AlertRuleRow = typeof metricsAlertRules.$inferSelect;
export type AlertInstanceRow = typeof metricsAlertInstances.$inferSelect;
export type AlertEventRow = typeof metricsAlertEvents.$inferSelect;
