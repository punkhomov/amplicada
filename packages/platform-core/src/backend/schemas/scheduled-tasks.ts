import { boolean, integer, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';

export const scheduledTasks = coreSchema.table('scheduled_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Стабильный человекочитаемый идентификатор задачи из кода (бывший PK). Внешне (URL, document_index) виден только `id` — `code` используется только внутри task-движка (локи, redis-каналы, cron-карта, FK на run-историю). */
  code: varchar('code', { length: 255 }).notNull().unique(),
  description: varchar('description', { length: 1000 }).notNull(),
  /** Таймаут выполнения в мс, задаётся вручную в админке (специфично для контура). 0 — без ограничения. */
  timeout: integer('timeout').notNull().default(0),
  alertOnFailure: boolean('alert_on_failure').notNull().default(false),
  schedule: varchar('schedule', { length: 100 }),
  active: boolean('active').notNull().default(false),
  // `stale` (код больше не объявляет эту задачу) живёт в core.document_index.stale — колонка здесь
  // дублировала его и метилась без скоупа по fixture (этап 2 плана 06).
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type ScheduledTaskRow = typeof scheduledTasks.$inferSelect;
export type NewScheduledTaskRow = typeof scheduledTasks.$inferInsert;
