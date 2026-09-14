import { timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { authPasswordSchema } from './_schema.js';

export const passwordCredential = authPasswordSchema.table('password_credential', {
  userId: uuid('user_id').primaryKey(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type PasswordCredential = typeof passwordCredential.$inferSelect;
export type NewPasswordCredential = typeof passwordCredential.$inferInsert;
