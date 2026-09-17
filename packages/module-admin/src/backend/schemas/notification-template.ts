import { text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { adminSchema } from './_schema.js';

/**
 * Шаблон уведомления — документ типа 'notification-template'. Хранит только контент: маршрутизацию
 * и доставку делает core-сервис notification (канал и адрес получателя выбираются при отправке).
 */
export const adminNotificationTemplate = adminSchema.table('notification_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  /** Plain text — обязателен, как и в NotificationMessage. */
  body: text('body').notNull(),
  html: text('html'),
  locale: varchar('locale', { length: 10 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AdminNotificationTemplateRow = typeof adminNotificationTemplate.$inferSelect;
