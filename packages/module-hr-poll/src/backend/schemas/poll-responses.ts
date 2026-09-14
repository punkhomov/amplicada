import { identityUser } from '@amplicada/platform-core/backend';
import { jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { hrPollSchema } from './_schema.js';
import { hrPollPolls } from './poll-polls.js';

export const hrPollResponses = hrPollSchema.table('responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  pollId: uuid('poll_id')
    .notNull()
    .references(() => hrPollPolls.id),
  /** null — анонимный опрос (poll.anonymous=true), ответ не привязан к автору. */
  userId: uuid('user_id').references(() => identityUser.id),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HrPollResponseRow = typeof hrPollResponses.$inferSelect;
export type NewHrPollResponseRow = typeof hrPollResponses.$inferInsert;
