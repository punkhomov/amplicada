import { boolean, jsonb, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { RequestFormField } from '../../contracts/index.js';
import { hrRequestsSchema } from './_schema.js';

/** Типы заявок — управляются админом через Document System (документ «Тип заявки»), не кодом. */
export const hrRequestTypes = hrRequestsSchema.table('request_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).unique().notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  titleTemplate: varchar('title_template', { length: 255 }),
  formFields: jsonb('form_fields').$type<RequestFormField[]>().notNull().default([]),
  portalEnabled: boolean('portal_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft-delete — в core.document_index.deleted_at (этап 2 плана 06).
});

export type HrRequestTypeRow = typeof hrRequestTypes.$inferSelect;
