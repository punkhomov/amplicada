import { numeric, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrWorkSchedule = hrSchema.table('work_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  hoursPerWeek: numeric('hours_per_week', { precision: 4, scale: 1 }),
  description: text('description'),
});

export type HrWorkSchedule = typeof hrWorkSchedule.$inferSelect;
export type NewHrWorkSchedule = typeof hrWorkSchedule.$inferInsert;
