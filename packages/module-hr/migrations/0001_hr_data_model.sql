-- module-hr data model: справочники, оргструктура, штатное расписание, команды.
-- Все таблицы в схеме "hr".
-- FK на "core"."identity_user" — cross-schema, без ON DELETE cascade (блокировка случайного удаления).

-- Level 1: Справочники (validFrom/validTo)

CREATE TABLE IF NOT EXISTS "hr"."job_family" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "valid_from" date NOT NULL,
  "valid_to" date,
  "is_active" boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "hr"."position_grade" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "family_id" uuid NOT NULL REFERENCES "hr"."job_family"("id"),
  "code" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "order_index" integer NOT NULL,
  "min_salary" numeric(12,2),
  "max_salary" numeric(12,2),
  "valid_from" date NOT NULL,
  "valid_to" date,
  "is_active" boolean NOT NULL DEFAULT true,
  UNIQUE("family_id", "code")
);

CREATE TABLE IF NOT EXISTS "hr"."position_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL,
  "name" varchar(255) NOT NULL,
  "family_id" uuid REFERENCES "hr"."job_family"("id"),
  "category" varchar(50),
  "description" text,
  "valid_from" date NOT NULL,
  "valid_to" date,
  "is_active" boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "hr"."work_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL,
  "name" varchar(255) NOT NULL,
  "hours_per_week" numeric(4,1),
  "description" text
);

CREATE TABLE IF NOT EXISTS "hr"."tag" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) UNIQUE NOT NULL,
  "scope" varchar(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS "hr"."department_tag" (
  "department_node_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL REFERENCES "hr"."tag"("id"),
  PRIMARY KEY ("department_node_id", "tag_id")
);

CREATE TABLE IF NOT EXISTS "hr"."user_tag" (
  "user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "tag_id" uuid NOT NULL REFERENCES "hr"."tag"("id"),
  PRIMARY KEY ("user_id", "tag_id")
);

CREATE TABLE IF NOT EXISTS "hr"."staff_unit_tag" (
  "staff_unit_node_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL REFERENCES "hr"."tag"("id"),
  PRIMARY KEY ("staff_unit_node_id", "tag_id")
);

CREATE TABLE IF NOT EXISTS "hr"."role" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text
);

CREATE TABLE IF NOT EXISTS "hr"."user_role" (
  "user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "role_id" uuid NOT NULL REFERENCES "hr"."role"("id"),
  "scope_type" varchar(50),
  "scope_id" uuid,
  "valid_from" date NOT NULL,
  "valid_to" date
);

-- Level 2: Структуры (Node + Version)

CREATE TABLE IF NOT EXISTS "hr"."legal_entity_node" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS "hr"."legal_entity_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "hr"."legal_entity_node"("id"),
  "short_name" varchar(100) NOT NULL,
  "full_name" varchar(500) NOT NULL,
  "inn" varchar(20),
  "kpp" varchar(20),
  "valid_from" date NOT NULL,
  "valid_to" date,
  "created_by_user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "source_document_id" uuid,
  "comment" text
);

CREATE TABLE IF NOT EXISTS "hr"."department_node" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS "hr"."department_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "hr"."department_node"("id"),
  "parent_node_id" uuid REFERENCES "hr"."department_node"("id"),
  "path" text,
  "name" varchar(255) NOT NULL,
  "short_name" varchar(100),
  "head_user_id" uuid REFERENCES "core"."identity_user"("id"),
  "type" varchar(50),
  "order_index" integer DEFAULT 0,
  "valid_from" date NOT NULL,
  "valid_to" date,
  "metadata" jsonb DEFAULT '{}',
  "created_by_user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "source_document_id" uuid,
  "comment" text
);

CREATE TABLE IF NOT EXISTS "hr"."cost_center_node" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS "hr"."cost_center_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "hr"."cost_center_node"("id"),
  "parent_node_id" uuid REFERENCES "hr"."cost_center_node"("id"),
  "name" varchar(255) NOT NULL,
  "legal_entity_node_id" uuid REFERENCES "hr"."legal_entity_node"("id"),
  "valid_from" date NOT NULL,
  "valid_to" date,
  "is_active" boolean NOT NULL DEFAULT true,
  "metadata" jsonb DEFAULT '{}',
  "created_by_user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "source_document_id" uuid,
  "comment" text
);

CREATE TABLE IF NOT EXISTS "hr"."staff_unit_node" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) NOT NULL,
  "department_node_id" uuid NOT NULL REFERENCES "hr"."department_node"("id"),
  "template_id" uuid NOT NULL REFERENCES "hr"."position_template"("id"),
  UNIQUE("department_node_id", "code")
);

CREATE TABLE IF NOT EXISTS "hr"."staff_unit_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "hr"."staff_unit_node"("id"),
  "grade_id" uuid REFERENCES "hr"."position_grade"("id"),
  "legal_entity_node_id" uuid NOT NULL REFERENCES "hr"."legal_entity_node"("id"),
  "cost_center_node_id" uuid REFERENCES "hr"."cost_center_node"("id"),
  "quantity" numeric(6,2) DEFAULT '1',
  "min_salary" numeric(12,2),
  "max_salary" numeric(12,2),
  "is_active" boolean NOT NULL DEFAULT true,
  "valid_from" date NOT NULL,
  "valid_to" date,
  "metadata" jsonb DEFAULT '{}',
  "created_by_user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "source_document_id" uuid,
  "comment" text
);

CREATE TABLE IF NOT EXISTS "hr"."virtual_team_node" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL,
  "project_start_date" date,
  "project_end_date" date
);

CREATE TABLE IF NOT EXISTS "hr"."virtual_team_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "hr"."virtual_team_node"("id"),
  "name" varchar(255) NOT NULL,
  "type" varchar(50),
  "lead_user_id" uuid REFERENCES "core"."identity_user"("id"),
  "department_node_id" uuid REFERENCES "hr"."department_node"("id"),
  "valid_from" date NOT NULL,
  "valid_to" date,
  "is_active" boolean NOT NULL DEFAULT true,
  "metadata" jsonb DEFAULT '{}',
  "created_by_user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "source_document_id" uuid,
  "comment" text
);

-- Level 3: События (startDate/endDate)

CREATE TABLE IF NOT EXISTS "hr"."employee_appointment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "core"."identity_user"("id"),
  "staff_unit_node_id" uuid NOT NULL REFERENCES "hr"."staff_unit_node"("id"),
  "is_primary" boolean DEFAULT true,
  "employment_type" varchar(50) DEFAULT 'full-time',
  "start_date" date NOT NULL,
  "end_date" date,
  "termination_reason" varchar(50),
  "work_schedule_id" uuid REFERENCES "hr"."work_schedule"("id"),
  "metadata" jsonb DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS "hr"."team_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_node_id" uuid NOT NULL REFERENCES "hr"."virtual_team_node"("id"),
  "user_id" uuid NOT NULL REFERENCES "core"."identity_user"("id"),
  "role_in_team" varchar(100),
  "participation_percent" integer,
  "start_date" date NOT NULL,
  "end_date" date
);

-- Индексы для производительности

CREATE INDEX IF NOT EXISTS "idx_department_version_node" ON "hr"."department_version"("node_id", "valid_to");
CREATE INDEX IF NOT EXISTS "idx_department_version_parent" ON "hr"."department_version"("parent_node_id");
CREATE INDEX IF NOT EXISTS "idx_staff_unit_version_node" ON "hr"."staff_unit_version"("node_id", "valid_to");
CREATE INDEX IF NOT EXISTS "idx_cost_center_version_node" ON "hr"."cost_center_version"("node_id", "valid_to");
CREATE INDEX IF NOT EXISTS "idx_legal_entity_version_node" ON "hr"."legal_entity_version"("node_id", "valid_to");
CREATE INDEX IF NOT EXISTS "idx_virtual_team_version_node" ON "hr"."virtual_team_version"("node_id", "valid_to");
CREATE INDEX IF NOT EXISTS "idx_employee_appointment_user" ON "hr"."employee_appointment"("user_id");
CREATE INDEX IF NOT EXISTS "idx_employee_appointment_staff_unit" ON "hr"."employee_appointment"("staff_unit_node_id");

-- Непересечение версий одного node_id по [valid_from, valid_to] — последняя линия обороны,
-- HrStructureService (закрытие+вставка версии) не должен давать её сработать в норме.
-- btree_gist нужен, т.к. GiST по умолчанию не индексирует equality (=) на uuid.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "hr"."legal_entity_version" ADD CONSTRAINT "legal_entity_version_no_overlap"
  EXCLUDE USING gist ("node_id" WITH =, daterange("valid_from", COALESCE("valid_to", 'infinity'), '[]') WITH &&);

ALTER TABLE "hr"."department_version" ADD CONSTRAINT "department_version_no_overlap"
  EXCLUDE USING gist ("node_id" WITH =, daterange("valid_from", COALESCE("valid_to", 'infinity'), '[]') WITH &&);

ALTER TABLE "hr"."cost_center_version" ADD CONSTRAINT "cost_center_version_no_overlap"
  EXCLUDE USING gist ("node_id" WITH =, daterange("valid_from", COALESCE("valid_to", 'infinity'), '[]') WITH &&);

ALTER TABLE "hr"."staff_unit_version" ADD CONSTRAINT "staff_unit_version_no_overlap"
  EXCLUDE USING gist ("node_id" WITH =, daterange("valid_from", COALESCE("valid_to", 'infinity'), '[]') WITH &&);

ALTER TABLE "hr"."virtual_team_version" ADD CONSTRAINT "virtual_team_version_no_overlap"
  EXCLUDE USING gist ("node_id" WITH =, daterange("valid_from", COALESCE("valid_to", 'infinity'), '[]') WITH &&);
