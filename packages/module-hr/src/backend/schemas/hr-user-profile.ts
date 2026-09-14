import { boolean, date, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrUserProfile = hrSchema.table('user_profile', {
  userId: uuid('user_id').primaryKey(),
  code: varchar('code', { length: 50 }),
  lastName: varchar('last_name', { length: 100 }),
  firstName: varchar('first_name', { length: 100 }),
  middleName: varchar('middle_name', { length: 100 }),
  gender: varchar('gender', { length: 10 }),
  birthDate: date('birth_date'),
  hireDate: date('hire_date'),
  positionStartDate: date('position_start_date'),
  terminationDate: date('termination_date'),
  isTerminated: boolean('is_terminated').default(false),
  phone: varchar('phone', { length: 50 }),
  internalPhone: varchar('internal_phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  internalEmail: varchar('internal_email', { length: 255 }),
  residentialAddress: varchar('residential_address', { length: 500 }),
  registrationAddress: varchar('registration_address', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export type HrUserProfile = typeof hrUserProfile.$inferSelect;
export type NewHrUserProfile = typeof hrUserProfile.$inferInsert;
