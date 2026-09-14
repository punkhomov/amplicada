import { timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workflowSchema } from './_schema.js';
import { processInstanceForks } from './process-instance-forks.js';
import { processInstances } from './process-instances.js';

/**
 * Активная позиция в графе процесса — движок обобщён с "одна текущая нода на инстанс" до "N токенов".
 * Обычный последовательный граф — это всегда ровно один токен с `branchGroupId = null`, который
 * никогда не форкается: без частных случаев в коде. См. ref/plans/2026-07-22-workflow-parallel-gateway.md.
 */
export const processInstanceTokens = workflowSchema.table('process_instance_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  processInstanceId: uuid('process_instance_id')
    .notNull()
    .references(() => processInstances.id, { onDelete: 'cascade' }),
  nodeId: varchar('node_id', { length: 100 }).notNull(),
  /** null = токен верхнего уровня, вне активного форка. */
  branchGroupId: uuid('branch_group_id').references(() => processInstanceForks.branchGroupId),
  status: varchar('status', { length: 20 }).notNull().default('active'), // active | consumed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProcessInstanceTokenRow = typeof processInstanceTokens.$inferSelect;
