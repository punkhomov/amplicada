-- FK базовой таблицы типа заявки на core.document_index — этап 1 плана
-- ref/plans/2026-08-05-document-model/06-index-primary.md. Пояснения см. в аналогичной миграции
-- module-hr (0002_document_index_fk.sql).
--
-- requests (сами заявки) документом не является — своя таблица модуля, в индекс не попадает.

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'request-type' FROM "hr_requests"."request_types" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr_requests"."request_types"
  ADD CONSTRAINT "request_types_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");
