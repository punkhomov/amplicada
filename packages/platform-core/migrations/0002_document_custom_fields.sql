-- Generic-хранилище кастомных полей документов: одна строка на (doc_id, module). Позволяет модулю
-- объявить DocumentExtension/ListExtension с customFields:true без своей таблицы/миграции — значения
-- пишутся сюда как jsonb.
CREATE TABLE IF NOT EXISTS "core"."document_custom_fields" (
  "doc_id" text NOT NULL REFERENCES "core"."document_index"("id") ON DELETE cascade,
  "module" text NOT NULL,
  "values" jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY ("doc_id", "module")
);
