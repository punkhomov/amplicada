import { boolean, date, jsonb, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrStaffUnitNode } from './hr-staff-unit-node.js';
import { hrWorkSchedule } from './hr-work-schedule.js';

export const hrEmployeeAppointment = hrSchema.table('employee_appointment', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  staffUnitNodeId: uuid('staff_unit_node_id')
    .notNull()
    .references(() => hrStaffUnitNode.id),
  isPrimary: boolean('is_primary').default(true),
  employmentType: varchar('employment_type', { length: 50 }).default('full-time'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  terminationReason: varchar('termination_reason', { length: 50 }),
  workScheduleId: uuid('work_schedule_id').references(() => hrWorkSchedule.id),
  metadata: jsonb('metadata').default({}),
});

export type HrEmployeeAppointment = typeof hrEmployeeAppointment.$inferSelect;
export type NewHrEmployeeAppointment = typeof hrEmployeeAppointment.$inferInsert;
