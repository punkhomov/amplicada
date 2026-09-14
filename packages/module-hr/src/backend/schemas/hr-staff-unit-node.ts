import { uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrDepartmentNode } from './hr-department-node.js';
import { hrPositionTemplate } from './hr-position-template.js';

export const hrStaffUnitNode = hrSchema.table('staff_unit_node', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull(),
  departmentNodeId: uuid('department_node_id')
    .notNull()
    .references(() => hrDepartmentNode.id),
  templateId: uuid('template_id')
    .notNull()
    .references(() => hrPositionTemplate.id),
});

export type HrStaffUnitNode = typeof hrStaffUnitNode.$inferSelect;
export type NewHrStaffUnitNode = typeof hrStaffUnitNode.$inferInsert;
