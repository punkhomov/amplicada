import { date, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrLegalEntityNode } from './hr-legal-entity-node.js';

export const hrLegalEntityVersion = hrSchema.table('legal_entity_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => hrLegalEntityNode.id),
  shortName: varchar('short_name', { length: 100 }).notNull(),
  fullName: varchar('full_name', { length: 500 }).notNull(),
  inn: varchar('inn', { length: 20 }),
  kpp: varchar('kpp', { length: 20 }),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  sourceDocumentId: uuid('source_document_id'),
  comment: text('comment'),
});

export type HrLegalEntityVersion = typeof hrLegalEntityVersion.$inferSelect;
export type NewHrLegalEntityVersion = typeof hrLegalEntityVersion.$inferInsert;
