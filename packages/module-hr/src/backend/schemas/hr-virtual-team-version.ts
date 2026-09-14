import { boolean, date, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrDepartmentNode } from './hr-department-node.js';
import { hrVirtualTeamNode } from './hr-virtual-team-node.js';

export const hrVirtualTeamVersion = hrSchema.table('virtual_team_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => hrVirtualTeamNode.id),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }),
  leadUserId: uuid('lead_user_id'),
  departmentNodeId: uuid('department_node_id').references(() => hrDepartmentNode.id),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  isActive: boolean('is_active').default(true).notNull(),
  metadata: jsonb('metadata').default({}),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  sourceDocumentId: uuid('source_document_id'),
  comment: text('comment'),
});

export type HrVirtualTeamVersion = typeof hrVirtualTeamVersion.$inferSelect;
export type NewHrVirtualTeamVersion = typeof hrVirtualTeamVersion.$inferInsert;
