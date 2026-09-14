-- Момент, когда воркер забрал пакет в обработку.
--
-- Без него пакет, чей воркер убили между claim'ом и завершением, навсегда остаётся в 'processing':
-- eager-диспатч его не разбудит (публиковать некому — умер сам публикатор), а расписание пропустит,
-- потому что подбирает только 'pending'. Расписание сверяет claimed_at и возвращает зависшие в
-- очередь.
ALTER TABLE "hr_learning"."packages" ADD COLUMN IF NOT EXISTS "claimed_at" timestamptz;

-- Выборка кандидатов идёт по (status, created_at) — и для 'pending', и для зависших 'processing'.
CREATE INDEX IF NOT EXISTS "idx_packages_status_created" ON "hr_learning"."packages" ("status", "created_at");
