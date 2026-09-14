import { boolean, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workflowSchema } from './_schema.js';

export const workflows = workflowSchema.table('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  // Без FK: циклическая ссылка workflows <-> versions, консистентность гарантирует publishVersion().
  currentVersionId: uuid('current_version_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkflowRow = typeof workflows.$inferSelect;
export type NewWorkflowRow = typeof workflows.$inferInsert;
