import { text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';
import { scheduledTaskRuns } from './scheduled-task-runs.js';

export const scheduledTaskRunLogs = coreSchema.table('scheduled_task_run_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => scheduledTaskRuns.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  level: varchar('level', { length: 10 }).notNull(),
  message: text('message').notNull(),
});

export type ScheduledTaskRunLogRow = typeof scheduledTaskRunLogs.$inferSelect;
export type NewScheduledTaskRunLogRow = typeof scheduledTaskRunLogs.$inferInsert;
