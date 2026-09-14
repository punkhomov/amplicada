import { identityUser } from '@amplicada/platform-core/backend';
import { integer, jsonb, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { WorkflowVersionConfig } from '../../contracts/graph.js';
import { workflowSchema } from './_schema.js';
import { workflows } from './workflows.js';

export const workflowVersions = workflowSchema.table(
  'versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    versionNumber: integer('version_number').notNull(),
    config: jsonb('config').$type<WorkflowVersionConfig>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => identityUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [unique().on(t.workflowId, t.versionNumber)],
);

export type WorkflowVersionRow = typeof workflowVersions.$inferSelect;
