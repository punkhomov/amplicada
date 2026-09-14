import { primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';

export const documentAccess = coreSchema.table(
  'document_access',
  {
    docType: varchar('doc_type', { length: 255 }).notNull(),
    docId: varchar('doc_id', { length: 255 }).notNull(),
    level: varchar('level', { length: 50 }).notNull().default('public'),
    owner: uuid('owner'),
    role: varchar('role', { length: 100 }),
    groupId: uuid('group_id'),
  },
  t => [primaryKey({ columns: [t.docType, t.docId] })],
);
