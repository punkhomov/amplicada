import { date, integer, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrDepartmentNode } from './hr-department-node.js';

export const hrDepartmentVersion = hrSchema.table('department_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => hrDepartmentNode.id),
  parentNodeId: uuid('parent_node_id').references(() => hrDepartmentNode.id),
  path: text('path'),
  name: varchar('name', { length: 255 }).notNull(),
  shortName: varchar('short_name', { length: 100 }),
  headUserId: uuid('head_user_id'),
  type: varchar('type', { length: 50 }),
  orderIndex: integer('order_index').default(0),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  metadata: jsonb('metadata').default({}),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  sourceDocumentId: uuid('source_document_id'),
  comment: text('comment'),
});

export type HrDepartmentVersion = typeof hrDepartmentVersion.$inferSelect;
export type NewHrDepartmentVersion = typeof hrDepartmentVersion.$inferInsert;
