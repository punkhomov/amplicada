import { identityUser } from '@amplicada/platform-core/backend';
import { boolean, integer, jsonb, numeric, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { AttemptCompletion, AttemptSuccess } from '../../contracts/index.js';
import { hrLearningSchema } from './_schema.js';
import { hrLearningCourses } from './courses.js';
import { hrLearningPackages } from './packages.js';

/**
 * Попытка прохождения — документ `learning-attempt` (read-only карточка и список для админа).
 *
 * Строка заводится ТОЛЬКО через `documentRuntime.allocateDocumentId('learning-attempt', tx)`:
 * `id` ссылается на `core.document_index(id)` внешним ключом, проверка немедленная. Ровно на этом
 * споткнулся module-hr-poll — ответы на опрос не сохранялись вообще.
 *
 * Ссылки на курс и пользователя денормализованы намеренно: FK на `enrollments` утащил бы историю
 * прохождения при снятии назначения, а она и есть то, ради чего попытка сделана документом.
 */
export const hrLearningAttempts = hrLearningSchema.table('attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => hrLearningCourses.id),
  /** Чем интерпретировать `cmi`: попытка читается тем пакетом, на котором началась. */
  packageId: uuid('package_id')
    .notNull()
    .references(() => hrLearningPackages.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => identityUser.id),
  /** Сырое состояние SCORM — источник правды, поля ниже производные от него. */
  cmi: jsonb('cmi').$type<Record<string, unknown>>().notNull().default({}),
  completion: varchar('completion', { length: 20 }).$type<AttemptCompletion>().notNull().default('not_started'),
  success: varchar('success', { length: 20 }).$type<AttemptSuccess>(),
  /** SCORM не обязывает шкалу быть 0–100, поэтому numeric, а не integer. */
  score: numeric('score', { precision: 6, scale: 2 }),
  totalTimeSeconds: integer('total_time_seconds').notNull().default(0),
  /** Lease «одна активная сессия»: коммит принимается, только если совпадает с тем, что в токене (подплан 05). */
  sessionId: uuid('session_id'),
  /** Админ проставил «пройдено» руками — пакеты, не шлющие финальный статус, это норма. */
  manualOverride: boolean('manual_override').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  /** Проставляется при первом переходе в completed и больше не двигается. */
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type HrLearningAttemptRow = typeof hrLearningAttempts.$inferSelect;
export type NewHrLearningAttemptRow = typeof hrLearningAttempts.$inferInsert;
