import { sql } from 'drizzle-orm';
import { jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { NotificationAttachment } from '../../contracts/notification.js';
import { coreSchema } from './_schema.js';

/**
 * Шаблон уведомления — документ-тип ядра `notification-template` (ADR-07). id приходит из
 * `core.document_index`; code-шаблоны объявляются fixtures модулей по `fixture_key` = `code:locale`.
 */
export const notificationTemplate = coreSchema.table('notification_template', {
  id: uuid('id').primaryKey(),
  /** Идентичность fixture-строки: '<code>:<locale>'. У админских шаблонов пусто. */
  fixtureKey: varchar('fixture_key', { length: 255 }).unique(),
  code: varchar('code', { length: 128 }),
  locale: varchar('locale', { length: 10 }),
  name: varchar('name', { length: 100 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  body: text('body').notNull(),
  html: text('html'),
  sender: varchar('sender', { length: 64 }),
  attachments: jsonb('attachments').$type<NotificationAttachment[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationTemplateRow = typeof notificationTemplate.$inferSelect;
export type NewNotificationTemplateRow = typeof notificationTemplate.$inferInsert;
