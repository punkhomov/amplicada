-- Actor-трекинг для document_index: кем создан/изменён/удалён (soft-delete). Все колонки nullable —
-- NULL означает "actor неизвестен" (fixture-реконсиляция, backfillIndex, системный код без HTTP-запроса),
-- а не подставной "системный пользователь".
ALTER TABLE "core"."document_index"
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid REFERENCES "core"."identity_user"("id"),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid REFERENCES "core"."identity_user"("id"),
  ADD COLUMN IF NOT EXISTS "deleted_by_user_id" uuid REFERENCES "core"."identity_user"("id");
