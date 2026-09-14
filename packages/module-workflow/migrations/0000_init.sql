-- module-workflow baseline. Таблицы в схеме "workflow". FK на "core"."identity_user" — cross-schema.
-- Консолидация 0000-0005 (audit actor_type/payload_diff, automation jobs + kind, state_code, tokens/forks).
CREATE SCHEMA IF NOT EXISTS "workflow";

CREATE TABLE IF NOT EXISTS "workflow"."workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(100) UNIQUE NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  -- Без FK: циклическая ссылка workflows <-> versions, консистентность держит publishVersion().
  "current_version_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "workflow"."versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_id" uuid NOT NULL REFERENCES "workflow"."workflows"("id"),
  "version_number" integer NOT NULL,
  "config" jsonb NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "versions_workflow_id_version_number_unique" UNIQUE("workflow_id", "version_number")
);

CREATE TABLE IF NOT EXISTS "workflow"."process_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_version_id" uuid NOT NULL REFERENCES "workflow"."versions"("id"),
  "workflow_code" varchar(100) NOT NULL,
  "current_state" varchar(100) NOT NULL,
  -- Денормализация node.code — null, если админ не задал код ноде.
  "current_state_code" varchar(100),
  "payload" jsonb NOT NULL DEFAULT '{}',
  "context" jsonb NOT NULL DEFAULT '{}',
  "created_by" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "idx_process_instances_state_code" ON "workflow"."process_instances"("current_state_code");

CREATE TABLE IF NOT EXISTS "workflow"."process_instance_forks" (
  "branch_group_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "process_instance_id" uuid NOT NULL REFERENCES "workflow"."process_instances"("id") ON DELETE CASCADE,
  "parent_branch_group_id" uuid,
  "split_node_id" varchar(100) NOT NULL,
  "join_node_id" varchar(100) NOT NULL,
  "expected_count" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "workflow"."process_instance_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "process_instance_id" uuid NOT NULL REFERENCES "workflow"."process_instances"("id") ON DELETE CASCADE,
  "node_id" varchar(100) NOT NULL,
  "branch_group_id" uuid REFERENCES "workflow"."process_instance_forks"("branch_group_id"),
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_process_instance_tokens_active" ON "workflow"."process_instance_tokens" ("process_instance_id") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "idx_process_instance_tokens_group" ON "workflow"."process_instance_tokens" ("branch_group_id");

CREATE TABLE IF NOT EXISTS "workflow"."tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "process_instance_id" uuid NOT NULL REFERENCES "workflow"."process_instances"("id") ON DELETE cascade,
  "token_id" uuid REFERENCES "workflow"."process_instance_tokens"("id") ON DELETE CASCADE,
  "assignee_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "state" varchar(100) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "idx_tasks_assignee" ON "workflow"."tasks"("assignee_id", "status");

CREATE TABLE IF NOT EXISTS "workflow"."audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "process_instance_id" uuid NOT NULL REFERENCES "workflow"."process_instances"("id"),
  -- Nullable: зарезервировано под actor_type='system' (таймеры, фоновая автоматика).
  "actor_id" uuid REFERENCES "core"."identity_user"("id"),
  "actor_type" varchar(10) NOT NULL DEFAULT 'user',
  "action" varchar(100) NOT NULL,
  "from_state" varchar(100),
  "to_state" varchar(100),
  "comment" text,
  "payload_diff" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "workflow"."automation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "process_instance_id" uuid NOT NULL REFERENCES "workflow"."process_instances"("id"),
  "token_id" uuid REFERENCES "workflow"."process_instance_tokens"("id") ON DELETE CASCADE,
  "node_id" varchar(100) NOT NULL,
  -- route: AsyncTaskProvider (маршрутизирует). hook: HookProvider (fire-and-forget).
  "kind" varchar(10) NOT NULL DEFAULT 'route',
  "provider_id" varchar(200) NOT NULL,
  "params" jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL,
  "retry_delay_ms" integer NOT NULL,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_automation_jobs_claim" ON "workflow"."automation_jobs"("status", "next_attempt_at");
