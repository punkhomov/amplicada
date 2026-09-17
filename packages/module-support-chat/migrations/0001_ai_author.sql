-- Задел под AI-ответы: сообщения могут быть от ассистента (author_role = 'ai'),
-- у таких сообщений нет пользователя-автора.
ALTER TABLE "support_chat"."messages" ALTER COLUMN "author_id" DROP NOT NULL;

ALTER TABLE "support_chat"."messages" DROP CONSTRAINT "messages_author_role_check";
ALTER TABLE "support_chat"."messages" ADD CONSTRAINT "messages_author_role_check" CHECK ("author_role" IN ('user', 'admin', 'ai'));
