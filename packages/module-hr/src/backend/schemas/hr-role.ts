import { date, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrRole = hrSchema.table('role', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
});

// Junction: user ↔ role (cross-schema FK to identity_user — in migration SQL only)
export const hrUserRole = hrSchema.table('user_role', {
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id')
    .notNull()
    .references(() => hrRole.id),
  scopeType: varchar('scope_type', { length: 50 }),
  scopeId: uuid('scope_id'),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
});

export type HrRole = typeof hrRole.$inferSelect;
export type NewHrRole = typeof hrRole.$inferInsert;
