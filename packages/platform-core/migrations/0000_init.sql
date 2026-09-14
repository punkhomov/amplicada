-- platform-core baseline. Все таблицы core-инфраструктуры живут в схеме "core".
-- Консолидация прежних 0000-0011 (id/code-свап scheduled_tasks, soft-delete, document_index)
-- в единый schema-qualified baseline (БД пересоздаётся, инкрементальная история не нужна).
CREATE SCHEMA IF NOT EXISTS "core";

CREATE TABLE IF NOT EXISTS "core"."identity_user" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "login" varchar(255) NOT NULL,
  "created_at" timestamp DEFAULT now(),
  -- Soft-delete: непустое — документ помечен удалённым (DocumentRuntime.delete/restore/hardDelete).
  "deleted_at" timestamp,
  CONSTRAINT "identity_user_login_unique" UNIQUE ("login")
);
CREATE INDEX IF NOT EXISTS "idx_identity_user_active" ON "core"."identity_user" ("id") WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "core"."user_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "description" varchar(1000),
  "created_at" timestamp DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_user_groups_active" ON "core"."user_groups" ("id") WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "core"."group_users" (
  "group_id" uuid REFERENCES "core"."user_groups"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "core"."identity_user"("id") ON DELETE cascade,
  PRIMARY KEY ("group_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "core"."document_access" (
  "doc_type" varchar(255) NOT NULL,
  "doc_id" varchar(255) NOT NULL,
  "level" varchar(50) NOT NULL DEFAULT 'public',
  "owner" uuid,
  "role" varchar(100),
  "group_id" uuid,
  PRIMARY KEY ("doc_type", "doc_id")
);

CREATE TABLE IF NOT EXISTS "core"."auth_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "login" varchar(255),
  "action" varchar(20) NOT NULL,
  "success" boolean NOT NULL DEFAULT true,
  "reason" varchar(255),
  "ip_address" varchar(64),
  "user_agent" varchar(512),
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "core"."scheduled_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Человекочитаемый идентификатор задачи из кода. Внешне (URL, document_index) виден только "id";
  -- "code" — внутренняя деталь task-движка (локи, redis-каналы, cron-карта, FK run-истории).
  "code" varchar(255) NOT NULL,
  "description" varchar(1000) NOT NULL,
  "timeout" integer NOT NULL DEFAULT 0,
  "alert_on_failure" boolean NOT NULL DEFAULT false,
  "schedule" varchar(100),
  "active" boolean NOT NULL DEFAULT false,
  "stale" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "scheduled_tasks_code_unique" UNIQUE ("code")
);

CREATE TABLE IF NOT EXISTS "core"."scheduled_task_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" varchar(255) NOT NULL REFERENCES "core"."scheduled_tasks"("code") ON DELETE cascade,
  "status" varchar(20) NOT NULL,
  "trigger" varchar(20) NOT NULL,
  "instance_id" varchar(255),
  "started_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp,
  "duration_ms" integer,
  "reason" varchar(20),
  "error" text
);

CREATE TABLE IF NOT EXISTS "core"."scheduled_task_run_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "core"."scheduled_task_runs"("id") ON DELETE cascade,
  "timestamp" timestamp NOT NULL DEFAULT now(),
  "level" varchar(10) NOT NULL,
  "message" text NOT NULL
);

-- Lookup id → type для всех document-типов (поиск документа по id без знания типа).
CREATE TABLE IF NOT EXISTS "core"."document_index" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  -- Строка создана fixture-механизмом (reconcileFixtures) — скоупит stale-маркировку.
  "fixture" boolean NOT NULL DEFAULT false,
  "stale" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "idx_document_index_active" ON "core"."document_index" ("id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_document_index_stale" ON "core"."document_index" ("type") WHERE "stale";

-- Seed: admin-пользователь и группа Administrators.
INSERT INTO "core"."identity_user" ("id", "login")
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin')
ON CONFLICT ("login") DO NOTHING;

INSERT INTO "core"."user_groups" ("id", "name", "description")
VALUES ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Administrators', 'System administrators')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "core"."group_users" ("group_id", "user_id")
VALUES ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
ON CONFLICT ("group_id", "user_id") DO NOTHING;
