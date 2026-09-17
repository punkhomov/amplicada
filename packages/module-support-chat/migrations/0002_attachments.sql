-- Вложения в сообщениях. Файл лежит в S3-хранилище (`storage`), в строке — только
-- метаданные и ключ объекта; одно сообщение несёт не больше одного вложения.
-- `body` остаётся NOT NULL: сообщение без текста, но с файлом пишет пустую строку.
ALTER TABLE "support_chat"."messages"
  ADD COLUMN "attachment_key" text,
  ADD COLUMN "attachment_name" text,
  ADD COLUMN "attachment_mime" text,
  ADD COLUMN "attachment_size" integer;
