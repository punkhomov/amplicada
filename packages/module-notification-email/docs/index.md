---
title: "module-notification-email — обзор"
type: index
package: module-notification-email
updated: 2026-09-16
verified_commit: 4e61e7a1
---

# module-notification-email

> Потребительская документация. Рационал решений, отвергнутые альтернативы и известные
> пробелы — в `ref/notes/module-notification-email.md`.

Первый канальный модуль уведомлений: владеет SMTP-транспортом и адресной книгой. Ядро
(`platform-core`) само не знает, что такое email, — модуль регистрирует канал `email` в
core-сервисе `notification` и решает, по какому адресу слать конкретному пользователю.

В пакет осознанно не входят: шаблоны писем, подтверждение адреса пользователем, вложения,
очереди и ретраи (ретраи — забота ядра). Модуль также не предоставляет frontend-сторону:
метки полей карточки переводит backend-локаль запроса, своей UI у него нет.

## Публичная поверхность

| Что | Как | Где в коде |
|---|---|---|
| Backend-модуль | `module` (`amplicada: true`) | `src/backend/index.ts` |
| Сервис для ядра | `registerChannel()` вызывается при подключённом `SMTP_HOST` | `src/backend/setup.ts` |
| Адресная книга | таблица `notification_email.user_email` | `src/backend/schemas/user-email.ts` |
| Документ | поля `email`, `verifiedAt` на карточке `user`, группа security | `src/backend/documents/user.ts` |
| Локали | `notification-email:field_email`, `notification-email:field_verified_at` | `src/backend/locales/` |

## Зависимости и порядок загрузки

- Требует: `@amplicada/platform-core` (peer). В `dependencies` ядра не добавляет.
- Обязательных модулей-соседей нет: модуль не зависит от `module-auth-password` и наоборот.
- `context.migrations.register('notification-email', …)` — своя схема `notification_email`.
- Канал резолвится в `setup`, то есть до старта маршрутов; порядок среди других модулей не важен.

## Карта документации

| Раздел | Файл |
|---|---|
| Первый контакт | — нет |
| Задачи | [how-to/](./how-to/index.md) |
| Справочник | [reference/](./reference/index.md) |
| Концепции | — нет |

## Карта покрытия

| Подсистема | Где описана |
|---|---|
| Точки расширения (токены, сервисы) | [reference/](./reference/index.md) |
| HTTP API | — нет (своих роутов у модуля нет) |
| Схема БД и миграции | [reference/](./reference/index.md) |
| Документы, списки, дашборд | [reference/](./reference/index.md) |
| Задачи и фоновые процессы | — нет (диспетчер живёт в ядре) |
| Frontend (FSD, роуты, слоты) | — нет (backend-only модуль) |
| Конфиг: env, зависимости, порядок | [reference/](./reference/index.md) |
| Интеграции и потребители | [reference/](./reference/index.md) |

Сверено с рабочим деревом на ветке feat/notifications (4e61e7a1). Живая проверка: письмо с text и html доставлено в Mailpit, строка outbox
перешла в `sent`.
