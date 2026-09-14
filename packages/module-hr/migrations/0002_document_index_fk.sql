-- FK базовых таблиц hr-типов на core.document_index (этап 1 плана
-- ref/plans/2026-08-05-document-model/06-index-primary.md). Объявляется здесь, а не в core:
-- core-миграции применяются раньше, чем таблицы этого модуля существуют.
--
-- Backfill пишется по фактическому имени таблицы, а не по реестру типов: строка, чей тип не
-- зарегистрирован в момент миграции, всё равно должна получить lookup-запись — иначе FK не создастся.
-- ON DELETE намеренно нет, удаление остаётся ручным в коде.

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'department' FROM "hr"."department_node" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."department_node"
  ADD CONSTRAINT "department_node_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'cost-center' FROM "hr"."cost_center_node" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."cost_center_node"
  ADD CONSTRAINT "cost_center_node_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'legal-entity' FROM "hr"."legal_entity_node" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."legal_entity_node"
  ADD CONSTRAINT "legal_entity_node_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'staff-unit' FROM "hr"."staff_unit_node" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."staff_unit_node"
  ADD CONSTRAINT "staff_unit_node_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'virtual-team' FROM "hr"."virtual_team_node" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."virtual_team_node"
  ADD CONSTRAINT "virtual_team_node_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'job-family' FROM "hr"."job_family" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."job_family"
  ADD CONSTRAINT "job_family_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'position-grade' FROM "hr"."position_grade" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."position_grade"
  ADD CONSTRAINT "position_grade_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'position-template' FROM "hr"."position_template" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."position_template"
  ADD CONSTRAINT "position_template_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'role' FROM "hr"."role" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."role"
  ADD CONSTRAINT "role_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'tag' FROM "hr"."tag" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."tag"
  ADD CONSTRAINT "tag_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'work-schedule' FROM "hr"."work_schedule" ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "hr"."work_schedule"
  ADD CONSTRAINT "work_schedule_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");
