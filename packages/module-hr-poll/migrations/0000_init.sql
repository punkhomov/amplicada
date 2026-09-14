-- module-hr-poll baseline. Таблицы в схеме "hr_poll".
-- Cross-schema FK: user_id → "core"."identity_user".
CREATE SCHEMA IF NOT EXISTS "hr_poll";

-- Опросы — управляются админом через Document System (документ «Опрос»).
CREATE TABLE IF NOT EXISTS "hr_poll"."polls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(100) UNIQUE NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "questions" jsonb NOT NULL DEFAULT '[]',
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "active" boolean NOT NULL DEFAULT true,
  "starts_at" timestamptz,
  "ends_at" timestamptz,
  "allow_repeat" boolean NOT NULL DEFAULT false,
  "anonymous" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- Soft-delete: непустое — документ помечен удалённым (DocumentRuntime.delete/restore/hardDelete).
  "deleted_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_polls_active" ON "hr_poll"."polls" ("id") WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "hr_poll"."responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "poll_id" uuid NOT NULL REFERENCES "hr_poll"."polls"("id"),
  "user_id" uuid REFERENCES "core"."identity_user"("id"),
  "answers" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_responses_poll_user" ON "hr_poll"."responses" ("poll_id", "user_id");
