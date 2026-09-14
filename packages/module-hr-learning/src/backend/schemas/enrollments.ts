import { identityUser } from '@amplicada/platform-core/backend';
import { timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import type { EnrollmentSource } from '../../contracts/index.js';
import { hrLearningSchema } from './_schema.js';
import { hrLearningCourses } from './courses.js';

/**
 * Назначение курса человеку — обычная таблица, не документ.
 *
 * Документом её сделать не вышло: `widget: 'reference'` объявлен в контракте, но в `FieldWidget`
 * ветки для него нет, поэтому назначение через generic-карточку означало бы вписывать UUID
 * пользователя руками. Свой диалог назначения — в подплане 06.
 */
export const hrLearningEnrollments = hrLearningSchema.table(
  'enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => hrLearningCourses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => identityUser.id),
    source: varchar('source', { length: 20 }).$type<EnrollmentSource>().notNull(),
    /** Кто назначил. NULL при самозаписи. */
    assignedBy: uuid('assigned_by').references(() => identityUser.id),
    /** Срок прохождения. NULL — без срока. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [unique('enrollments_course_user_key').on(t.courseId, t.userId)],
);

export type HrLearningEnrollmentRow = typeof hrLearningEnrollments.$inferSelect;
export type NewHrLearningEnrollmentRow = typeof hrLearningEnrollments.$inferInsert;
