import { boolean, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';

export const authLog = coreSchema.table('auth_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  login: varchar('login', { length: 255 }),
  action: varchar('action', { length: 20 }).notNull(),
  success: boolean('success').notNull().default(true),
  reason: varchar('reason', { length: 255 }),
  ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export type AuthLog = typeof authLog.$inferSelect;
export type NewAuthLog = typeof authLog.$inferInsert;
