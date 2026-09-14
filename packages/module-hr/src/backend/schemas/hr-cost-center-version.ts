import { boolean, date, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrCostCenterNode } from './hr-cost-center-node.js';
import { hrLegalEntityNode } from './hr-legal-entity-node.js';

export const hrCostCenterVersion = hrSchema.table('cost_center_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => hrCostCenterNode.id),
  parentNodeId: uuid('parent_node_id').references(() => hrCostCenterNode.id),
  name: varchar('name', { length: 255 }).notNull(),
  legalEntityNodeId: uuid('legal_entity_node_id').references(() => hrLegalEntityNode.id),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  isActive: boolean('is_active').default(true).notNull(),
  metadata: jsonb('metadata').default({}),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  sourceDocumentId: uuid('source_document_id'),
  comment: text('comment'),
});

export type HrCostCenterVersion = typeof hrCostCenterVersion.$inferSelect;
export type NewHrCostCenterVersion = typeof hrCostCenterVersion.$inferInsert;
