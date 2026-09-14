import { integer, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { workflowSchema } from './_schema.js';
import { processInstanceTokens } from './process-instance-tokens.js';
import { processInstances } from './process-instances.js';

export const workflowAutomationJobs = workflowSchema.table('automation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  processInstanceId: uuid('process_instance_id')
    .notNull()
    .references(() => processInstances.id),
  /** См. WorkflowTaskRow.tokenId — тот же повод (несколько активных токенов на инстанс), nullable по той же причине. */
  tokenId: uuid('token_id').references(() => processInstanceTokens.id, { onDelete: 'cascade' }),
  nodeId: varchar('node_id', { length: 100 }).notNull(),
  // route: AsyncTaskProvider — успех продолжает advance()/settle() по графу (см. completeAutomationJob).
  // hook: HookProvider (postEnterHooks) — fire-and-forget, успех/неудача не маршрутизируют.
  kind: varchar('kind', { length: 10 }).notNull().default('route'),
  providerId: varchar('provider_id', { length: 200 }).notNull(),
  // Снапшот из конфига ноды на момент создания джобы — не читаются из JSONB конфига заново на каждой попытке.
  params: jsonb('params').$type<Record<string, unknown>>(),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | running | done | failed
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull(),
  retryDelayMs: integer('retry_delay_ms').notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkflowAutomationJobRow = typeof workflowAutomationJobs.$inferSelect;
