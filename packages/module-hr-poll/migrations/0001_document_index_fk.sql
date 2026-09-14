-- FK базовых таблиц типов опросов на core.document_index — этап 1 плана
-- ref/plans/2026-08-05-document-model/06-index-primary.md. Пояснения см. в аналогичной миграции
-- module-hr (0002_document_index_fk.sql).

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'poll' FROM "hr_poll"."polls" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr_poll"."polls"
  ADD CONSTRAINT "polls_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'response' FROM "hr_poll"."responses" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr_poll"."responses"
  ADD CONSTRAINT "responses_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");
