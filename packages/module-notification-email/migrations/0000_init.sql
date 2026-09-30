-- module-notification-email baseline: адресная книга почтового канала.
-- Транспорт (SMTP) статичен и живёт в env узла; в БД — только адреса пользователей.
--
-- UNIQUE(email): не два пользователя на один адрес — иначе сброс пароля неоднозначен.
-- Адрес нормализуется в нижний регистр модулем, а не базой.
--
-- verified_at заполняется сохранением админа в карточке пользователя; resolveAddress отдаёт
-- адрес только при непустом verified_at — задел под самостоятельную смену email с верификацией.

CREATE SCHEMA IF NOT EXISTS "notification_email";

CREATE TABLE IF NOT EXISTS "notification_email"."user_email" (
  "user_id" uuid PRIMARY KEY REFERENCES "core"."identity_user"("id") ON DELETE cascade,
  "email" varchar(320) NOT NULL,
  "verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_email_email_unique" UNIQUE ("email")
);
