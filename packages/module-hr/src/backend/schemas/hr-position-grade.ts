import { boolean, date, integer, numeric, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrJobFamily } from './hr-job-family.js';

export const hrPositionGrade = hrSchema.table('position_grade', {
  id: uuid('id').primaryKey().defaultRandom(),
  familyId: uuid('family_id')
    .notNull()
    .references(() => hrJobFamily.id),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  orderIndex: integer('order_index').notNull(),
  minSalary: numeric('min_salary', { precision: 12, scale: 2 }),
  maxSalary: numeric('max_salary', { precision: 12, scale: 2 }),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  isActive: boolean('is_active').default(true).notNull(),
});

export type HrPositionGrade = typeof hrPositionGrade.$inferSelect;
export type NewHrPositionGrade = typeof hrPositionGrade.$inferInsert;
