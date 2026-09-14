-- module-hr-learning baseline. Таблицы в схеме "hr_learning".
-- Cross-schema FK: user_id → "core"."identity_user", id документов → "core"."document_index".
CREATE SCHEMA IF NOT EXISTS "hr_learning";

-- Курс — документ learning-course.
-- Колонки deleted_at нет намеренно: soft-delete живёт в core.document_index (этап 2 плана
-- ref/plans/2026-08-05-document-model/06-index-primary.md).
-- Указателя на текущий пакет здесь нет: он дал бы цикл FK с packages.course_id, из-за которого
-- удаление перестаёт быть линейным. Признак «текущий» лежит на пакете (см. is_current ниже).
CREATE TABLE IF NOT EXISTS "hr_learning"."courses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() REFERENCES "core"."document_index"("id"),
  "code" varchar(100) UNIQUE NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" varchar(2000),
  "active" boolean NOT NULL DEFAULT true,
  "self_enrollable" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Версия контента курса. Перезалив создаёт новую строку, старая живёт, пока на неё ссылаются попытки.
CREATE TABLE IF NOT EXISTS "hr_learning"."packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" uuid NOT NULL REFERENCES "hr_learning"."courses"("id"),
  "version" integer NOT NULL,
  "is_current" boolean NOT NULL DEFAULT false,
  "kind" varchar(20) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "error" text,
  "entry_point" text,
  "title" varchar(255),
  "scorm_version" varchar(20),
  "source_key" text NOT NULL,
  "total_files" integer NOT NULL DEFAULT 0,
  "total_size" bigint NOT NULL DEFAULT 0,
  "uploaded_by" uuid REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "packages_course_version_key" UNIQUE ("course_id", "version")
);

-- Ровно один текущий пакет на курс. Инвариант держит БД, а не аккуратность кода —
-- тот же приём, что для «одной незавершённой попытки» ниже.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_packages_one_current"
  ON "hr_learning"."packages" ("course_id")
  WHERE "is_current";

-- Воркер разбирает пакеты выборкой по status — без индекса это seq scan по всей таблице.
CREATE INDEX IF NOT EXISTS "idx_packages_status" ON "hr_learning"."packages" ("status", "created_at");

-- Инвентарь распакованного пакета; он же whitelist раздачи (подплан 03).
CREATE TABLE IF NOT EXISTS "hr_learning"."package_files" (
  "package_id" uuid NOT NULL REFERENCES "hr_learning"."packages"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "content_type" varchar(255) NOT NULL,
  "size" bigint NOT NULL,
  PRIMARY KEY ("package_id", "path")
);

-- Назначение / самозапись.
CREATE TABLE IF NOT EXISTS "hr_learning"."enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" uuid NOT NULL REFERENCES "hr_learning"."courses"("id"),
  "user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "source" varchar(20) NOT NULL,
  "assigned_by" uuid REFERENCES "core"."identity_user"("id"),
  "due_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "enrollments_course_user_key" UNIQUE ("course_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_enrollments_user" ON "hr_learning"."enrollments" ("user_id");

-- Попытка прохождения — документ learning-attempt.
-- id ссылается на document_index: строка заводится только через allocateDocumentId.
CREATE TABLE IF NOT EXISTS "hr_learning"."attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() REFERENCES "core"."document_index"("id"),
  "course_id" uuid NOT NULL REFERENCES "hr_learning"."courses"("id"),
  "package_id" uuid NOT NULL REFERENCES "hr_learning"."packages"("id"),
  "user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "cmi" jsonb NOT NULL DEFAULT '{}',
  "completion" varchar(20) NOT NULL DEFAULT 'not_started',
  "success" varchar(20),
  "score" numeric(6, 2),
  "total_time_seconds" integer NOT NULL DEFAULT 0,
  "session_id" uuid,
  "manual_override" boolean NOT NULL DEFAULT false,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz,
  "completed_at" timestamptz
);

-- «Одна незавершённая попытка на курс» — держим на уровне БД, а не аккуратностью кода.
-- Пройденных попыток может быть сколько угодно: «пройти заново» создаёт новую.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_attempts_one_open"
  ON "hr_learning"."attempts" ("user_id", "course_id")
  WHERE "completion" <> 'completed';
