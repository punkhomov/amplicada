import { integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';
import { scheduledTasks } from './scheduled-tasks.js';

export const scheduledTaskRuns = coreSchema.table('scheduled_task_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: varchar('task_id', { length: 255 })
    .notNull()
    .references(() => scheduledTasks.code, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull(),
  trigger: varchar('trigger', { length: 20 }).notNull(),
  instanceId: varchar('instance_id', { length: 255 }),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  durationMs: integer('duration_ms'),
  reason: varchar('reason', { length: 20 }),
  error: text('error'),
});

export type ScheduledTaskRunRow = typeof scheduledTaskRuns.$inferSelect;
export type NewScheduledTaskRunRow = typeof scheduledTaskRuns.$inferInsert;
