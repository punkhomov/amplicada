import { identityUser } from '@amplicada/platform-core/backend';
import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { supportChatSchema } from './_schema.js';
import { supportChatThreads } from './threads.js';

export const supportChatMessages = supportChatSchema.table('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id')
    .notNull()
    .references(() => supportChatThreads.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => identityUser.id),
  authorRole: text('author_role').$type<'user' | 'admin' | 'ai'>().notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SupportChatMessageRow = typeof supportChatMessages.$inferSelect;
export type NewSupportChatMessageRow = typeof supportChatMessages.$inferInsert;
