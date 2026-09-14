import { boolean, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { PollQuestion } from '../../contracts/index.js';
import { hrPollSchema } from './_schema.js';

/** Опросы — управляются админом через Document System (документ «Опрос»), не кодом. */
export const hrPollPolls = hrPollSchema.table('polls', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).unique().notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  /** Иммутабельны с момента status='published' (см. documents/poll.ts). */
  questions: jsonb('questions').$type<PollQuestion[]>().notNull().default([]),
  /** draft -> published, необратимо. Правка вопросов допустима только в draft. */
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  /** Показывать ли сейчас — пауза сбора без разблокировки схемы вопросов. */
  active: boolean('active').notNull().default(true),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  allowRepeat: boolean('allow_repeat').notNull().default(false),
  anonymous: boolean('anonymous').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft-delete — в core.document_index.deleted_at (этап 2 плана 06).
});

export type HrPollPollRow = typeof hrPollPolls.$inferSelect;
