-- Состояние документа (удалён / устарел) хранится только в core.document_index — этап 2 плана
-- ref/plans/2026-08-05-document-model/06-index-primary.md.
--
-- До сих пор `deleted_at` писался в двух местах (базовая таблица + индекс), а читался из базовой;
-- `stale` — наоборот: индексная копия не читалась никем, работала базовая. Две копии одного факта,
-- способные разъехаться.
--
-- Перенос безопасен по построению: после этапа 1 у каждой базовой строки есть строка индекса (FK),
-- поэтому UPDATE ... FROM не теряет ни одной. Копирование и DROP идут в одной миграции, а значит в
-- одной транзакции.

UPDATE "core"."document_index" AS di
SET "deleted_at" = u."deleted_at"
FROM "core"."identity_user" AS u
WHERE di."id" = u."id" AND u."deleted_at" IS NOT NULL;

UPDATE "core"."document_index" AS di
SET "deleted_at" = g."deleted_at"
FROM "core"."user_groups" AS g
WHERE di."id" = g."id" AND g."deleted_at" IS NOT NULL;

UPDATE "core"."document_index" AS di
SET "stale" = true
FROM "core"."scheduled_tasks" AS t
WHERE di."id" = t."id" AND t."stale";

DROP INDEX IF EXISTS "core"."idx_identity_user_active";
DROP INDEX IF EXISTS "core"."idx_user_groups_active";

ALTER TABLE "core"."identity_user" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "core"."user_groups" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "core"."scheduled_tasks" DROP COLUMN IF EXISTS "stale";

-- Живость документа теперь спрашивают у индекса при каждом списке — прежний частичный индекс по (id)
-- для этого бесполезен (id и так PK). Нужен доступ «активные документы такого-то типа».
DROP INDEX IF EXISTS "core"."idx_document_index_active";
CREATE INDEX IF NOT EXISTS "idx_document_index_type_active"
  ON "core"."document_index" ("type") WHERE "deleted_at" IS NULL;
