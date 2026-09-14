import { identityUser } from '@amplicada/platform-core/backend';
import { jsonb, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workflowSchema } from './_schema.js';
import { workflowVersions } from './workflow-versions.js';

export const processInstances = workflowSchema.table('process_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowVersionId: uuid('workflow_version_id')
    .notNull()
    .references(() => workflowVersions.id),
  workflowCode: varchar('workflow_code', { length: 100 }).notNull(),
  currentState: varchar('current_state', { length: 100 }).notNull(),
  /** Денормализация node.code (см. WorkflowNodeBase) — null, если админ не задал код ноде. */
  currentStateCode: varchar('current_state_code', { length: 100 }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => identityUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type ProcessInstanceRow = typeof processInstances.$inferSelect;
