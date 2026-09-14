import { uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrCostCenterNode = hrSchema.table('cost_center_node', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
});

export type HrCostCenterNode = typeof hrCostCenterNode.$inferSelect;
export type NewHrCostCenterNode = typeof hrCostCenterNode.$inferInsert;
