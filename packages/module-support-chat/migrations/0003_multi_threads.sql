-- Несколько обращений на пользователя: уникальность user_id снята, вместо неё индекс
-- под список «Мои обращения» (фильтр по user_id, сортировка по свежести).
-- Существующие данные не мигрируем: проект в разработке, БД одноразовая.
ALTER TABLE "support_chat"."threads" DROP CONSTRAINT IF EXISTS "threads_user_id_unique";

CREATE INDEX IF NOT EXISTS "idx_threads_user_updated" ON "support_chat"."threads" ("user_id", "updated_at" DESC);
