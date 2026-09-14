-- Ключ extension'а в document_custom_fields: различает несколько extend() одного модуля на одном
-- документе (см. ref/plans/2026-07-27-document-extension-multikey.md).
-- DEFAULT 'base' нужен только чтобы NOT NULL прошёл на уже существующих строках — key до этой миграции
-- не существовал, значит все они по определению base. Сразу после backfill дефолт снимается, чтобы БД
-- не молчала, если приложение однажды не передаст значение.
ALTER TABLE "core"."document_custom_fields" ADD COLUMN IF NOT EXISTS "key" text NOT NULL DEFAULT 'base';

ALTER TABLE "core"."document_custom_fields" DROP CONSTRAINT IF EXISTS "document_custom_fields_pkey";
ALTER TABLE "core"."document_custom_fields" ADD CONSTRAINT "document_custom_fields_pkey"
  PRIMARY KEY ("doc_id", "module", "key");

ALTER TABLE "core"."document_custom_fields" ALTER COLUMN "key" DROP DEFAULT;
