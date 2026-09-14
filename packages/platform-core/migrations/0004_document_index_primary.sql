-- document_index становится первичной таблицей документов: id рождается здесь, базовые таблицы
-- типов ссылаются на него внешним ключом (см. ref/plans/2026-08-05-document-model/06-index-primary.md,
-- этап 1). Здесь — только core: смена типов колонок и FK для трёх собственных типов
-- (user, user-group, scheduled-task). FK на таблицах модулей объявляются в миграциях этих модулей:
-- core-миграции применяются раньше, чем таблицы модулей вообще существуют.

-- 1. Типы колонок. FK требует совпадения типов, а все 19 базовых таблиц — uuid.
--    DEFAULT раньше был не нужен (id всегда приходил снаружи); теперь id генерится здесь.
ALTER TABLE "core"."document_custom_fields" DROP CONSTRAINT IF EXISTS "document_custom_fields_doc_id_fkey";

ALTER TABLE "core"."document_index" ALTER COLUMN "id" TYPE uuid USING "id"::uuid;
ALTER TABLE "core"."document_index" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "core"."document_custom_fields" ALTER COLUMN "doc_id" TYPE uuid USING "doc_id"::uuid;
ALTER TABLE "core"."document_custom_fields"
  ADD CONSTRAINT "document_custom_fields_doc_id_fkey"
  FOREIGN KEY ("doc_id") REFERENCES "core"."document_index"("id") ON DELETE cascade;

-- 2. Backfill + FK для core-типов. Backfill пишется по фактическому имени таблицы, а не по реестру:
--    строка, чей тип не зарегистрирован в момент миграции, всё равно должна получить lookup-запись,
--    иначе FK не создастся. Сюда же попадают сид админа и группы Administrators из 0000_init.
--    ON DELETE намеренно нет: удаление остаётся ручным в коде (порядок extension → base → index
--    в hardDelete/deleteMany уже снизу вверх и с NO ACTION работает как есть).
INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'user' FROM "core"."identity_user"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "core"."identity_user"
  ADD CONSTRAINT "identity_user_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'user-group' FROM "core"."user_groups"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "core"."user_groups"
  ADD CONSTRAINT "user_groups_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");

INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", 'scheduled-task' FROM "core"."scheduled_tasks"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "core"."scheduled_tasks"
  ADD CONSTRAINT "scheduled_tasks_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");
