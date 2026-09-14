-- FK базовых таблиц workflow-типов на core.document_index — этап 1 плана
-- ref/plans/2026-08-05-document-model/06-index-primary.md. Пояснения см. в аналогичной миграции
-- module-hr (0002_document_index_fk.sql).

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'workflow' FROM "workflow"."workflows" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "workflow"."workflows"
  ADD CONSTRAINT "workflows_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'process' FROM "workflow"."process_instances" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "workflow"."process_instances"
  ADD CONSTRAINT "process_instances_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");
