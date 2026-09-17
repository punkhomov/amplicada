CREATE SCHEMA IF NOT EXISTS "support_chat";

CREATE TABLE IF NOT EXISTS "support_chat"."threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "status" text NOT NULL DEFAULT 'open',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "user_last_read_at" timestamp with time zone,
  "admin_last_read_at" timestamp with time zone,
  CONSTRAINT "threads_user_id_unique" UNIQUE ("user_id"),
  CONSTRAINT "threads_status_check" CHECK ("status" IN ('open', 'closed'))
);

CREATE TABLE IF NOT EXISTS "support_chat"."messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" uuid NOT NULL REFERENCES "support_chat"."threads"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "author_role" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "messages_author_role_check" CHECK ("author_role" IN ('user', 'admin'))
);

CREATE INDEX IF NOT EXISTS "idx_messages_thread_created" ON "support_chat"."messages" ("thread_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_threads_updated" ON "support_chat"."threads" ("updated_at");
