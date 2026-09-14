import { boolean, date, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrCostCenterNode } from './hr-cost-center-node.js';
import { hrLegalEntityNode } from './hr-legal-entity-node.js';
import { hrPositionGrade } from './hr-position-grade.js';
import { hrStaffUnitNode } from './hr-staff-unit-node.js';

export const hrStaffUnitVersion = hrSchema.table('staff_unit_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => hrStaffUnitNode.id),
  gradeId: uuid('grade_id').references(() => hrPositionGrade.id),
  legalEntityNodeId: uuid('legal_entity_node_id')
    .notNull()
    .references(() => hrLegalEntityNode.id),
  costCenterNodeId: uuid('cost_center_node_id').references(() => hrCostCenterNode.id),
  quantity: numeric('quantity', { precision: 6, scale: 2 }).default('1'),
  minSalary: numeric('min_salary', { precision: 12, scale: 2 }),
  maxSalary: numeric('max_salary', { precision: 12, scale: 2 }),
  isActive: boolean('is_active').default(true).notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  metadata: jsonb('metadata').default({}),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  sourceDocumentId: uuid('source_document_id'),
  comment: text('comment'),
});

export type HrStaffUnitVersion = typeof hrStaffUnitVersion.$inferSelect;
export type NewHrStaffUnitVersion = typeof hrStaffUnitVersion.$inferInsert;
