import { boolean, date, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrJobFamily } from './hr-job-family.js';

export const hrPositionTemplate = hrSchema.table('position_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  familyId: uuid('family_id').references(() => hrJobFamily.id),
  category: varchar('category', { length: 50 }),
  description: text('description'),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  isActive: boolean('is_active').default(true).notNull(),
});

export type HrPositionTemplate = typeof hrPositionTemplate.$inferSelect;
export type NewHrPositionTemplate = typeof hrPositionTemplate.$inferInsert;
