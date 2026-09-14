-- Soft-delete типа заявки переезжает в core.document_index — этап 2 плана
-- ref/plans/2026-08-05-document-model/06-index-primary.md. Пояснения см. в core/0005.

UPDATE "core"."document_index" AS di
SET "deleted_at" = t."deleted_at"
FROM "hr_requests"."request_types" AS t
WHERE di."id" = t."id" AND t."deleted_at" IS NOT NULL;

DROP INDEX IF EXISTS "hr_requests"."idx_request_types_active";
ALTER TABLE "hr_requests"."request_types" DROP COLUMN IF EXISTS "deleted_at";
