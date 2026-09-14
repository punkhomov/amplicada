import { timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';

export const identityUser = coreSchema.table('identity_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  login: varchar('login', { length: 255 }).unique().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  // Soft-delete живёт в core.document_index.deleted_at — здесь колонки больше нет (этап 2 плана 06):
  // состояние документа хранилось в двух местах и могло разъехаться.
});

export type IdentityUser = typeof identityUser.$inferSelect;
