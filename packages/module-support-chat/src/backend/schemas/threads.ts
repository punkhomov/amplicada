import { identityUser } from '@amplicada/platform-core/backend';
import { type AnyPgColumn, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { supportChatSchema } from './_schema.js';

export const supportChatThreads = supportChatSchema.table('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Владелец обращения; обращений у пользователя может быть несколько. */
  userId: uuid('user_id')
    .notNull()
    .references(() => identityUser.id),
  status: text('status').$type<'open' | 'pending' | 'solved' | 'closed'>().notNull().default('open'),
  /** Вид записи: обычный вопрос или инцидент (у него есть серьёзность). */
  kind: text('kind').$type<'question' | 'incident'>().notNull().default('question'),
  severity: text('severity').$type<'low' | 'medium' | 'high' | 'critical'>(),
  /** Для связанных обращений-дублей — инцидент, к которому они привязаны. */
  incidentThreadId: uuid('incident_thread_id').references((): AnyPgColumn => supportChatThreads.id),
  /** Кто закрыл/решил и почему — для истории и метрик. */
  resolvedBy: text('resolved_by').$type<'user' | 'admin' | 'ai'>(),
  closeReason: text('close_reason').$type<'resolved' | 'not_relevant' | 'duplicate'>(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  userLastReadAt: timestamp('user_last_read_at', { withTimezone: true }),
  adminLastReadAt: timestamp('admin_last_read_at', { withTimezone: true }),
});

export type SupportChatThreadRow = typeof supportChatThreads.$inferSelect;
export type NewSupportChatThreadRow = typeof supportChatThreads.$inferInsert;
