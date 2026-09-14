-- module-hr baseline. Таблицы в схеме "hr". FK на "core"."identity_user" — cross-schema.
CREATE SCHEMA IF NOT EXISTS "hr";

CREATE TABLE IF NOT EXISTS "hr"."user_profile" (
  "user_id" uuid PRIMARY KEY REFERENCES "core"."identity_user"("id") ON DELETE cascade,
  "code" varchar(50),
  "last_name" varchar(100),
  "first_name" varchar(100),
  "middle_name" varchar(100),
  "gender" varchar(10),
  "birth_date" date,
  "hire_date" date,
  "position_start_date" date,
  "termination_date" date,
  "is_terminated" boolean DEFAULT false,
  "phone" varchar(50),
  "internal_phone" varchar(50),
  "email" varchar(255),
  "internal_email" varchar(255),
  "residential_address" varchar(500),
  "registration_address" varchar(500),
  "created_at" timestamp DEFAULT now()
);
