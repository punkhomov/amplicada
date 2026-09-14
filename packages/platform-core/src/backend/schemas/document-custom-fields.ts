import { jsonb, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';
import { documentIndex } from './document-index.js';

/**
 * Generic-хранилище кастомных полей: одна строка на (docId, module, key). Позволяет модулю объявить
 * `DocumentExtension`/`ListExtension` с `customFields: true` — вместо своей Drizzle-таблицы и миграции,
 * значения полей пишутся сюда как jsonb. Строка-на-extension (не общий jsonb-блоб на документ) —
 * конкурентная запись двух extension'ов не может затереть данные друг друга read-modify-write'ом.
 */
export const documentCustomFields = coreSchema.table(
  'document_custom_fields',
  {
    docId: uuid('doc_id')
      .notNull()
      .references(() => documentIndex.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    /** Ключ extension'а (`DocumentExtension.key`, нормализованный реестром) — различает несколько `extend()` одного модуля. */
    key: text('key').notNull(),
    values: jsonb('values').notNull().default({}),
  },
  t => [primaryKey({ columns: [t.docId, t.module, t.key] })],
);

export type DocumentCustomFieldsRow = typeof documentCustomFields.$inferSelect;
export type NewDocumentCustomFieldsRow = typeof documentCustomFields.$inferInsert;
