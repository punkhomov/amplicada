import { identityUser } from '@amplicada/platform-core/backend';
import { jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workflowSchema } from './_schema.js';
import { processInstances } from './process-instances.js';

/** Shallow-дифф payload по ключам патча: только реально изменившиеся значения. */
export type PayloadDiff = Record<string, { from: unknown; to: unknown }>;

export const workflowAuditLog = workflowSchema.table('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  processInstanceId: uuid('process_instance_id')
    .notNull()
    .references(() => processInstances.id),
  // Nullable: зарезервировано под actorType='system' (таймеры, фоновая автоматика, фаза C) —
  // сегодня движок всегда пишет реального пользователя.
  actorId: uuid('actor_id').references(() => identityUser.id),
  actorType: varchar('actor_type', { length: 10 }).notNull().default('user'),
  action: varchar('action', { length: 100 }).notNull(),
  fromState: varchar('from_state', { length: 100 }),
  toState: varchar('to_state', { length: 100 }),
  comment: text('comment'),
  payloadDiff: jsonb('payload_diff').$type<PayloadDiff>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkflowAuditLogRow = typeof workflowAuditLog.$inferSelect;
