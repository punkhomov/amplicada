import { boolean, date, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrJobFamily = hrSchema.table('job_family', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  isActive: boolean('is_active').default(true).notNull(),
});

export type HrJobFamily = typeof hrJobFamily.$inferSelect;
export type NewHrJobFamily = typeof hrJobFamily.$inferInsert;
