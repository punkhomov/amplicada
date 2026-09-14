import { boolean, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrLearningSchema } from './_schema.js';

/**
 * Курс — документ `learning-course`, управляется админом через Document System.
 *
 * Soft-delete живёт в `core.document_index.deleted_at` — своей колонки `deleted_at` здесь
 * намеренно нет (этап 2 плана 06-index-primary).
 *
 * Указателя на текущий пакет здесь нет намеренно: он жил бы в паре с `packages.courseId` и давал
 * цикл FK, из-за которого удаление переставало быть линейным (обнулить указатель → удалить пакеты
 * → удалить курс). Признак «текущий» лежит на самом пакете (`packages.isCurrent`), а инвариант
 * «ровно один на курс» держит партиальный уникальный индекс.
 */
export const hrLearningCourses = hrLearningSchema.table('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).unique().notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: varchar('description', { length: 2000 }),
  /** Показывать ли курс в каталоге. */
  active: boolean('active').notNull().default(true),
  /** Можно ли записаться самому, без назначения админом. */
  selfEnrollable: boolean('self_enrollable').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HrLearningCourseRow = typeof hrLearningCourses.$inferSelect;
export type NewHrLearningCourseRow = typeof hrLearningCourses.$inferInsert;
