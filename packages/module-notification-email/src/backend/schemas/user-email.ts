import { identityUser } from '@amplicada/platform-core/backend';
import { timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { notificationEmailSchema } from './_schema.js';

/**
 * Адресная книга почтового канала. Один адрес на пользователя (`user_id` — PK) и один пользователь
 * на адрес (`UNIQUE(email)`): иначе сброс пароля и приглашения неоднозначны.
 *
 * `verified_at` — не формальность: `resolveAddress` отдаёт адрес только при непустом значении,
 * поэтому неподтверждённые адреса в рассылку не попадают. Пока адрес ставит админ из карточки —
 * это и есть подтверждение; самостоятельная смена email (пользователь меняет → верификация письмом)
 * появится в фазе auth и переиспользует эту же таблицу.
 */
export const userEmail = notificationEmailSchema.table(
  'user_email',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => identityUser.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 320 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [unique('user_email_email_unique').on(t.email)],
);

export type UserEmailRow = typeof userEmail.$inferSelect;
export type NewUserEmailRow = typeof userEmail.$inferInsert;
