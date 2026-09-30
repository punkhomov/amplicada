-- Notification contract v2 (ref/plans/2026-09-17-notification-contract-v2.md, ADR-07).
-- Шаблоны переезжают из admin в core (документ-тип ядра), outbox получает батчи, dedupe,
-- отправителя, конверты и вложения. Данные одноразовые: перенос строк не делается,
-- старая таблица admin.notification_template дропается.

CREATE TABLE IF NOT EXISTS "core"."notification_template" (
  "id" uuid PRIMARY KEY,
  "fixture_key" varchar(255) UNIQUE,
  "code" varchar(128),
  "locale" varchar(10),
  "name" varchar(100) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "html" text,
  "sender" varchar(64),
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notification_template_id_document_fk"
    FOREIGN KEY ("id") REFERENCES "core"."document_index"("id")
);

-- Один code-шаблон на пару (code, locale); админские шаблоны (code is null) не скоупятся.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_template_code_locale_idx"
  ON "core"."notification_template" ("code", "locale") WHERE "code" IS NOT NULL;

ALTER TABLE "core"."notification_outbox"
  ADD COLUMN IF NOT EXISTS "batch_id" uuid,
  ADD COLUMN IF NOT EXISTS "dedupe_key" text,
  ADD COLUMN IF NOT EXISTS "sender" varchar(64),
  ADD COLUMN IF NOT EXISTS "reply_to" varchar(320),
  ADD COLUMN IF NOT EXISTS "cc" jsonb,
  ADD COLUMN IF NOT EXISTS "bcc" jsonb,
  ADD COLUMN IF NOT EXISTS "headers" jsonb,
  ADD COLUMN IF NOT EXISTS "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "notification_outbox_batch_idx"
  ON "core"."notification_outbox" ("batch_id");

-- Идемпотентность бизнес-действия: одна доставка на (kind, dedupe_key, user_id).
CREATE UNIQUE INDEX IF NOT EXISTS "notification_outbox_dedupe_idx"
  ON "core"."notification_outbox" ("kind", "dedupe_key", "user_id")
  WHERE "dedupe_key" IS NOT NULL;

-- v1-строки шаблонов жили в admin и были документами; после дропа таблицы их индексные
-- строки остались бы сиротами (список их показывает, карточка падает). Свежая БД — no-op.
DELETE FROM "core"."document_index" WHERE "type" = 'notification-template';

DROP TABLE IF EXISTS "admin"."notification_template";
