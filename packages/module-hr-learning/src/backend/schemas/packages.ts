import { identityUser } from '@amplicada/platform-core/backend';
import { bigint, boolean, integer, jsonb, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import type { PackageKind, PackageNote, PackageStatus } from '../../contracts/index.js';
import { hrLearningSchema } from './_schema.js';
import { hrLearningCourses } from './courses.js';

/**
 * Версия контента курса. Перезалив создаёт новую строку, а не затирает старую: попытка ссылается
 * на конкретный пакет и должна интерпретироваться тем, на котором началась.
 */
export const hrLearningPackages = hrLearningSchema.table(
  'packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => hrLearningCourses.id),
    /** Порядковый номер в рамках курса, начиная с 1. */
    version: integer('version').notNull(),
    /**
     * Этот пакет открывается при старте курса. Ровно один на курс — держится партиальным
     * уникальным индексом `idx_packages_one_current`. Флаг, а не указатель на курсе: обратная
     * ссылка дала бы цикл FK и нелинейное удаление.
     */
    isCurrent: boolean('is_current').notNull().default(false),
    kind: varchar('kind', { length: 20 }).$type<PackageKind>().notNull(),
    status: varchar('status', { length: 20 }).$type<PackageStatus>().notNull().default('pending'),
    /** Текст сбоя распаковки — виден админу на карточке курса, чтобы не лезть в логи. */
    error: text('error'),
    /**
     * Замечания к **принятому** пакету: что пропущено при распаковке и на что жаловался разбор.
     *
     * Отдельно от `error` намеренно: тот означает «пакет не принят», а здесь пакет работает — просто
     * неполон или собран небрежно. В одной колонке пришлось бы либо терять замечания у готового
     * пакета, либо рисовать «Ошибка» там, где курс открывается.
     */
    notes: jsonb('notes').$type<PackageNote[]>().notNull().default([]),
    /** scorm12: href из манифеста; file: имя самого файла. Путь внутри пакета. */
    entryPoint: text('entry_point'),
    /** Название из imsmanifest.xml — справочно, название курса берётся из карточки. */
    title: varchar('title', { length: 255 }),
    scormVersion: varchar('scorm_version', { length: 20 }),
    /** Ключ исходного архива/файла в S3 (до распаковки). */
    sourceKey: text('source_key').notNull(),
    totalFiles: integer('total_files').notNull().default(0),
    totalSize: bigint('total_size', { mode: 'number' }).notNull().default(0),
    uploadedBy: uuid('uploaded_by').references(() => identityUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Когда воркер забрал пакет в работу. По нему расписание возвращает в очередь то, что зависло
     * в `processing` из-за краша: разбудить такой пакет иначе нечем — publish делать некому.
     */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  t => [unique('packages_course_version_key').on(t.courseId, t.version)],
);

export type HrLearningPackageRow = typeof hrLearningPackages.$inferSelect;
export type NewHrLearningPackageRow = typeof hrLearningPackages.$inferInsert;
