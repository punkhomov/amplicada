import { boolean, integer, real, text, timestamp } from 'drizzle-orm/pg-core';
import { metricsSchema } from './_schema.js';

/** Синглтон-настройки метрик: строка всегда одна (`id = 'default'`). */
export const metricsSettings = metricsSchema.table('settings', {
  id: text('id').primaryKey().default('default'),
  enabled: boolean('enabled').notNull().default(true),
  retentionEventsDays: integer('retention_events_days').notNull().default(30),
  samplePageviewRate: real('sample_pageview_rate').notNull().default(1),
  sampleClickRate: real('sample_click_rate').notNull().default(0.1),
  storeRawUrls: boolean('store_raw_urls').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MetricsSettingsRow = typeof metricsSettings.$inferSelect;
