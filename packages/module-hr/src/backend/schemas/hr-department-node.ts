import { uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrDepartmentNode = hrSchema.table('department_node', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
});

export type HrDepartmentNode = typeof hrDepartmentNode.$inferSelect;
export type NewHrDepartmentNode = typeof hrDepartmentNode.$inferInsert;
