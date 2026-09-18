import { bigint, text, timestamp } from 'drizzle-orm/pg-core';
import { metricsSchema } from './_schema.js';

/** Сгруппированные ошибки: одна строка на fingerprint, счётчик и рамки жизни. */
export const metricsErrorIssues = metricsSchema.table('error_issues', {
  fingerprint: text('fingerprint').primaryKey(),
  errorType: text('error_type').notNull(),
  messageTemplate: text('message_template').notNull(),
  route: text('route'),
  issueCount: bigint('issue_count', { mode: 'number' }).notNull().default(0),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  firstRelease: text('first_release'),
  lastRelease: text('last_release'),
});

export type ErrorIssueRow = typeof metricsErrorIssues.$inferSelect;
