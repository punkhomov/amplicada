import { processInstances } from '@amplicada/module-workflow/backend';
import { identityUser } from '@amplicada/platform-core/backend';
import { jsonb, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrRequestsSchema } from './_schema.js';

export const hrRequests = hrRequestsSchema.table('requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 100 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
  /** draft | submitted — дальше статус живёт в process_instance (см. status.ts). */
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  processInstanceId: uuid('process_instance_id').references(() => processInstances.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => identityUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
});

export type HrRequestRow = typeof hrRequests.$inferSelect;
export type NewHrRequestRow = typeof hrRequests.$inferInsert;
