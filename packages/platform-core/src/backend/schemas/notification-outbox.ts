import { index, integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';

/**
 * Outbox уведомлений: строка пишется в одной транзакции с бизнес-действием отправителя, доставка —
 * забота eager-попытки и диспетчера. FK на identity_user нет сознательно: получателем может быть
 * не пользователь (позже — алерты на технический адрес), а `user_id` нужен для поиска/фильтра.
 */
export const notificationOutbox = coreSchema.table(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    channel: varchar('channel', { length: 32 }).notNull(),
    kind: varchar('kind', { length: 64 }).notNull(),
    address: varchar('address', { length: 320 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    body: text('body').notNull(),
    html: text('html'),
    locale: varchar('locale', { length: 10 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('notification_outbox_due_idx').on(table.status, table.nextAttemptAt),
    index('notification_outbox_user_idx').on(table.userId, table.createdAt),
  ],
);

export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect;
export type NewNotificationOutboxRow = typeof notificationOutbox.$inferInsert;
