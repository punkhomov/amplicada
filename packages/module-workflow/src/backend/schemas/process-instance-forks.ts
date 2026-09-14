import { integer, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workflowSchema } from './_schema.js';
import { processInstances } from './process-instances.js';

/**
 * Bookkeeping одного форка (split parallel/inclusive gateway) на инстанс процесса — см.
 * ref/plans/2026-07-22-workflow-parallel-gateway.md. `parentBranchGroupId` без FK-ссылки на себя же
 * (самоссылающийся constraint усложняет схему без реальной пользы — инвариант держит только код).
 */
export const processInstanceForks = workflowSchema.table('process_instance_forks', {
  branchGroupId: uuid('branch_group_id').primaryKey().defaultRandom(),
  processInstanceId: uuid('process_instance_id')
    .notNull()
    .references(() => processInstances.id, { onDelete: 'cascade' }),
  /** Группа форка уровнем выше (для вложенных parallel-блоков) — null, если это верхний уровень. */
  parentBranchGroupId: uuid('parent_branch_group_id'),
  splitNodeId: varchar('split_node_id', { length: 100 }).notNull(),
  /** Известен статически из resolveParallelBlock() при публикации — не пересчитывается на каждый форк. */
  joinNodeId: varchar('join_node_id', { length: 100 }).notNull(),
  /** parallel: число исходящих рёбер split. inclusive: число реально активированных рёбер в этом проходе. */
  expectedCount: integer('expected_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProcessInstanceForkRow = typeof processInstanceForks.$inferSelect;
