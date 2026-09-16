-- Outbox уведомлений (план ref/plans/2026-09-15-notifications/01-core-service-and-outbox.md).
-- Ядро владеет маршрутизацией и надёжностью: строка пишется до попытки отправки, ретраи и
-- восстановление зависших `sending` — забота диспетчера. Схемных изменений в других таблицах нет.
--
-- FK на identity_user сознательно нет: получателем может быть не пользователь (позже — алерт на
-- технический адрес), `user_id` нужен только для поиска и фильтра.

CREATE TABLE IF NOT EXISTS "core"."notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "channel" varchar(32) NOT NULL,
  "kind" varchar(64) NOT NULL,
  "address" varchar(320) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "html" text,
  "locale" varchar(10),
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "last_error" text,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Выборка должных к отправке: диспетчер спрашивает по (status, next_attempt_at).
CREATE INDEX IF NOT EXISTS "notification_outbox_due_idx"
  ON "core"."notification_outbox" ("status", "next_attempt_at");

-- История доставок пользователя — для админ-фильтра по получателю.
CREATE INDEX IF NOT EXISTS "notification_outbox_user_idx"
  ON "core"."notification_outbox" ("user_id", "created_at" DESC);
