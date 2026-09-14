import { uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrLegalEntityNode = hrSchema.table('legal_entity_node', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
});

export type HrLegalEntityNode = typeof hrLegalEntityNode.$inferSelect;
export type NewHrLegalEntityNode = typeof hrLegalEntityNode.$inferInsert;
