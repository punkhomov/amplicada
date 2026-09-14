import { timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';

export const userGroups = coreSchema.table('user_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 1000 }),
  createdAt: timestamp('created_at').defaultNow(),
  // Soft-delete — в core.document_index.deleted_at (этап 2 плана 06).
});
