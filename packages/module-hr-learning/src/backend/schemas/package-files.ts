import { bigint, primaryKey, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrLearningSchema } from './_schema.js';
import { hrLearningPackages } from './packages.js';

/**
 * Инвентарь распакованного пакета. Он же whitelist раздачи: роут контента ищет путь запроса
 * строкой в этой таблице и только потом собирает ключ S3 — traversal и чтение соседних объектов
 * бакета закрываются тем, что отсутствующая строка это 404 (подплан 03).
 *
 * `contentType` считается один раз при распаковке по расширению. При отдаче он не сниффится —
 * это и снимает классическую причину «SCORM не работает» из-за MIME.
 */
export const hrLearningPackageFiles = hrLearningSchema.table(
  'package_files',
  {
    packageId: uuid('package_id')
      .notNull()
      .references(() => hrLearningPackages.id, { onDelete: 'cascade' }),
    /** Относительный путь внутри пакета, нормализованный: без ведущего слэша и без `..`. */
    path: text('path').notNull(),
    contentType: varchar('content_type', { length: 255 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
  },
  t => [primaryKey({ columns: [t.packageId, t.path] })],
);

export type HrLearningPackageFileRow = typeof hrLearningPackageFiles.$inferSelect;
export type NewHrLearningPackageFileRow = typeof hrLearningPackageFiles.$inferInsert;
