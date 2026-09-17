-- module-admin baseline. Шаблоны уведомлений в схеме "admin".
--
-- Шаблон — документ типа 'notification-template': id выдаёт core.document_index, поэтому FK сразу
-- в миграции (таблица новая, backfill не нужен). Отправка шаблона идёт через core-сервис
-- notification, таблица хранит только контент.
CREATE SCHEMA IF NOT EXISTS "admin";

CREATE TABLE IF NOT EXISTS "admin"."notification_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "html" text,
  "locale" varchar(10),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notification_template_id_document_fk"
    FOREIGN KEY ("id") REFERENCES "core"."document_index"("id")
);
