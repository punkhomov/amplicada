-- module-auth-password baseline. Таблицы в схеме "auth_password".
-- FK на "core"."identity_user" — cross-schema (core-миграции применяются раньше модульных).
CREATE SCHEMA IF NOT EXISTS "auth_password";

CREATE TABLE IF NOT EXISTS "auth_password"."password_credential" (
  "user_id" uuid PRIMARY KEY REFERENCES "core"."identity_user"("id") ON DELETE cascade,
  "password_hash" varchar(255) NOT NULL,
  "created_at" timestamp DEFAULT now()
);

-- Seed: пароль admin (bcrypt-хеш "123456").
INSERT INTO "auth_password"."password_credential" ("user_id", "password_hash")
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '$2b$10$JGJfl4W.3bFC1AoFBXym5.8N2.kcb3lVly03xxw1i9H19sDcQ9czS')
ON CONFLICT ("user_id") DO NOTHING;
