import { identityUser } from '@amplicada/platform-core/backend';
import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { supportChatSchema } from './_schema.js';

export const supportChatThreads = supportChatSchema.table('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Один тред на пользователя (unique-индекс в миграции). */
  userId: uuid('user_id')
    .notNull()
    .references(() => identityUser.id),
  status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  userLastReadAt: timestamp('user_last_read_at', { withTimezone: true }),
  adminLastReadAt: timestamp('admin_last_read_at', { withTimezone: true }),
});

export type SupportChatThreadRow = typeof supportChatThreads.$inferSelect;
export type NewSupportChatThreadRow = typeof supportChatThreads.$inferInsert;
