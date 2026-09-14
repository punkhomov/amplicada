import { identityUser } from '@amplicada/platform-core/backend';
import { timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workflowSchema } from './_schema.js';
import { processInstanceTokens } from './process-instance-tokens.js';
import { processInstances } from './process-instances.js';

export const workflowTasks = workflowSchema.table('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  processInstanceId: uuid('process_instance_id')
    .notNull()
    .references(() => processInstances.id, { onDelete: 'cascade' }),
  /**
   * Токен, на котором стоит эта задача — с parallel/inclusive gateway на инстанс может быть
   * несколько одновременных pending-задач. Nullable: исторические строки, вставленные до этой
   * колонки, бэкфиллом не покрываются (только у активных на момент миграции есть живой токен).
   */
  tokenId: uuid('token_id').references(() => processInstanceTokens.id, { onDelete: 'cascade' }),
  assigneeId: uuid('assignee_id')
    .notNull()
    .references(() => identityUser.id),
  state: varchar('state', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type WorkflowTaskRow = typeof workflowTasks.$inferSelect;
