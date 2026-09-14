-- Soft-delete опроса переезжает в core.document_index — этап 2 плана
-- ref/plans/2026-08-05-document-model/06-index-primary.md. Пояснения см. в core/0005.

UPDATE "core"."document_index" AS di
SET "deleted_at" = p."deleted_at"
FROM "hr_poll"."polls" AS p
WHERE di."id" = p."id" AND p."deleted_at" IS NOT NULL;

DROP INDEX IF EXISTS "hr_poll"."idx_polls_active";
ALTER TABLE "hr_poll"."polls" DROP COLUMN IF EXISTS "deleted_at";
