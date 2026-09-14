import { boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';
import { identityUser } from './identity-user.js';

/**
 * Первичная таблица документов: id рождается здесь, базовые таблицы типов ссылаются на него FK
 * (`<table>.id REFERENCES core.document_index(id)`, без `ON DELETE` — удаление ручное в коде).
 * Она же lookup id → type: документ находится по id без знания типа.
 */
export const documentIndex = coreSchema.table('document_index', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Actor, создавший документ. NULL — actor неизвестен (fixture/backfill/системный код без запроса). */
  createdByUserId: uuid('created_by_user_id').references(() => identityUser.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  /** Actor последнего update() — включая правки, затронувшие только extension-данные модуля, не base-таблицу. */
  updatedByUserId: uuid('updated_by_user_id').references(() => identityUser.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** Actor soft-delete. Для hard-delete не применимо — строка удаляется физически, писать некуда. */
  deletedByUserId: uuid('deleted_by_user_id').references(() => identityUser.id),
  /** Строка создана fixture-механизмом (reconcileFixtures) — code-defined документ. Скоупит stale-маркировку, чтобы не задеть юзерские строки того же типа. */
  fixture: boolean('fixture').notNull().default(false),
  /** Для fixture-документов (см. registerFixture/reconcileFixtures) — код больше не объявлен, строка не удаляется. Для остальных всегда false. */
  stale: boolean('stale').notNull().default(false),
});

export type DocumentIndexRow = typeof documentIndex.$inferSelect;
export type NewDocumentIndexRow = typeof documentIndex.$inferInsert;
