import { primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrTag = hrSchema.table('tag', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  scope: varchar('scope', { length: 50 }).notNull(),
});

// Junction: department ↔ tag
export const hrDepartmentTag = hrSchema.table(
  'department_tag',
  {
    departmentNodeId: uuid('department_node_id').notNull(),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => hrTag.id),
  },
  t => [primaryKey({ columns: [t.departmentNodeId, t.tagId] })],
);

// Junction: user ↔ tag (cross-schema FK to identity_user — in migration SQL only)
export const hrUserTag = hrSchema.table(
  'user_tag',
  {
    userId: uuid('user_id').notNull(),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => hrTag.id),
  },
  t => [primaryKey({ columns: [t.userId, t.tagId] })],
);

// Junction: staff_unit_node ↔ tag
export const hrStaffUnitTag = hrSchema.table(
  'staff_unit_tag',
  {
    staffUnitNodeId: uuid('staff_unit_node_id').notNull(),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => hrTag.id),
  },
  t => [primaryKey({ columns: [t.staffUnitNodeId, t.tagId] })],
);

export type HrTag = typeof hrTag.$inferSelect;
export type NewHrTag = typeof hrTag.$inferInsert;
