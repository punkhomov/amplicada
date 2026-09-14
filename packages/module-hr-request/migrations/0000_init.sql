-- module-hr-request baseline. Таблицы в схеме "hr_requests".
-- Cross-schema FK: created_by → "core"."identity_user", process_instance_id → "workflow"."process_instances"
-- (workflow-миграции регистрируются раньше hr-requests, поэтому схема "workflow" уже существует).
CREATE SCHEMA IF NOT EXISTS "hr_requests";

CREATE TABLE IF NOT EXISTS "hr_requests"."requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" varchar(100) NOT NULL,
  "title" varchar(255) NOT NULL,
  "fields" jsonb NOT NULL DEFAULT '{}',
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "process_instance_id" uuid REFERENCES "workflow"."process_instances"("id"),
  "created_by" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "submitted_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "idx_requests_created_by" ON "hr_requests"."requests"("created_by", "status");

-- Типы заявок — управляются админом через Document System (документ «Тип заявки»).
CREATE TABLE IF NOT EXISTS "hr_requests"."request_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(100) UNIQUE NOT NULL,
  "label" varchar(255) NOT NULL,
  "title_template" varchar(255),
  "form_fields" jsonb NOT NULL DEFAULT '[]',
  "portal_enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- Soft-delete: непустое — документ помечен удалённым (DocumentRuntime.delete/restore/hardDelete).
  "deleted_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_request_types_active" ON "hr_requests"."request_types" ("id") WHERE "deleted_at" IS NULL;
