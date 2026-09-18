-- Настройки поддержки: одна строка-синглтон. Пока здесь только задел под AI-провайдера
-- (ответчик появится позже и будет читать эти поля), плюс место под будущие секции.
CREATE TABLE IF NOT EXISTS "support_chat"."settings" (
  "id" text PRIMARY KEY DEFAULT 'default',
  "ai_enabled" boolean NOT NULL DEFAULT false,
  "ai_provider" text,
  "ai_model" text,
  "ai_system_prompt" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "settings_singleton_check" CHECK ("id" = 'default')
);

INSERT INTO "support_chat"."settings" ("id") VALUES ('default') ON CONFLICT ("id") DO NOTHING;
