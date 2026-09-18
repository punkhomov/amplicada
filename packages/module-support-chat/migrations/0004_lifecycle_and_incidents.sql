-- Статусная модель «чей ход» и инциденты.
--   open    — работает поддержка;
--   pending — ждём ответа пользователя;
--   solved  — решение отправлено, ждём подтверждения;
--   closed  — закрыто (пользователем, поддержкой или позже таймером).
-- Плюс атрибуты закрытия и вид обращения (обычный вопрос или инцидент,
-- с серьёзностью и ссылкой на инцидент для связанных обращений-дублей).
-- Данные не мигрируем: проект в разработке, БД одноразовая.
ALTER TABLE "support_chat"."threads" DROP CONSTRAINT IF EXISTS "threads_status_check";
ALTER TABLE "support_chat"."threads"
  ADD CONSTRAINT "threads_status_check" CHECK ("status" IN ('open', 'pending', 'solved', 'closed'));

ALTER TABLE "support_chat"."threads"
  ADD COLUMN "resolved_by" text,
  ADD COLUMN "close_reason" text,
  ADD COLUMN "resolved_at" timestamp with time zone,
  ADD COLUMN "closed_at" timestamp with time zone,
  ADD COLUMN "kind" text NOT NULL DEFAULT 'question',
  ADD COLUMN "severity" text,
  ADD COLUMN "incident_thread_id" uuid REFERENCES "support_chat"."threads"("id");

ALTER TABLE "support_chat"."threads"
  ADD CONSTRAINT "threads_kind_check" CHECK ("kind" IN ('question', 'incident'));

ALTER TABLE "support_chat"."threads"
  ADD CONSTRAINT "threads_severity_check" CHECK ("severity" IS NULL OR "severity" IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE "support_chat"."threads"
  ADD CONSTRAINT "threads_resolved_by_check" CHECK ("resolved_by" IS NULL OR "resolved_by" IN ('user', 'admin', 'ai'));

ALTER TABLE "support_chat"."threads"
  ADD CONSTRAINT "threads_close_reason_check" CHECK ("close_reason" IS NULL OR "close_reason" IN ('resolved', 'not_relevant', 'duplicate'));

CREATE INDEX IF NOT EXISTS "idx_threads_kind" ON "support_chat"."threads" ("kind");
CREATE INDEX IF NOT EXISTS "idx_threads_incident" ON "support_chat"."threads" ("incident_thread_id");
