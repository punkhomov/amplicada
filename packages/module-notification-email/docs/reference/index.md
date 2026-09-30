---
title: "Справочник module-notification-email"
type: reference
updated: 2026-09-30
verified_commit: 0551349
order: 10
---

# Справочник module-notification-email

## Интерфейс канала

Модуль регистрирует реализацию `NotificationChannel` (`@amplicada/platform-core/contracts`) в
core-сервисе `notification`:

| Метод | Поведение | Код |
|---|---|---|
| `id` | `'email'` | `src/backend/services/email-channel.ts` |
| `resolveAddress(userId)` | `null`, если строки нет или пуст `verified_at`; иначе `email` из `notification_email.user_email` | `src/backend/services/email-channel.ts` |
| `listSenders()` | Имена из `SMTP_SENDERS` по алфавиту (для select в редакторе шаблона) | `src/backend/services/email-channel.ts` |
| `send(message)` | `transport.sendMail` с конвертом: `from` отправителя, `to`, `subject`, `text`, `html`, `replyTo`, `cc`, `bcc`, `headers`, вложения | `src/backend/services/email-channel.ts` |

Адрес нормализуется в нижний регистр при сохранении. Неподтверждённый адрес не попадает в
доставку: строка outbox для него не создаётся вовсе.

## Именованные отправители

`SMTP_SENDERS` — JSON-карта `имя → { from, replyTo? }`; в контракте сообщения имя едет в поле
`sender`, резолвит его канал:

- известное имя → `from`/`replyTo` из карты;
- явный `replyTo` сообщения приоритетнее sender-овского;
- неизвестное имя → warning и дефолтный `SMTP_FROM` (fail-open: опечатка не глушит письма).

Битый JSON или запись без `from` не роняют узел: такая запись просто игнорируется.

## Вложения

Манифест `NotificationAttachment[]` (`storageKey`, `filename`, `contentType?`, `size?`) приходит
из контракта сообщения. При отправке канал:

- проверяет существование и **реальный** размер объекта через `storage.headObject` (манифесту
  `size` не верится);
- отклоняет файл больше 10 МиБ и сумму больше 20 МиБ (`NOTIFICATION_ATTACHMENT_LIMITS`) —
  это обычная ошибка доставки с `lastError`, строка уходит в ретрай;
- стримит объект из storage в письмо (не буфер).

## Конфиг (env)

| Переменная | Дефолт | Поведение |
|---|---|---|
| `SMTP_HOST` | — | Не задан → канал не регистрируется, узел стартует без почты |
| `SMTP_PORT` | `587` | Для Mailpit — `1025` |
| `SMTP_SECURE` | `false` | `true` для implicit TLS (порт 465) |
| `SMTP_USER` / `SMTP_PASSWORD` | — | Передаются в transport, если заданы |
| `SMTP_FROM` | `Amplicada <no-reply@amplicada.local>` | Дефолтный отправитель и fallback неизвестного имени |
| `SMTP_SENDERS` | `{}` | JSON-карта именованных отправителей |

Секреты живут только в окружении узла; в БД и коде их нет.

## Схема БД

Одна таблица — `notification_email.user_email` (миграция `migrations/0000_init.sql`):

| Колонка | Тип | Смысл |
|---|---|---|
| `user_id` | `uuid` PK, FK → `core.identity_user(id)` `ON DELETE cascade` | Один адрес на пользователя |
| `email` | `varchar(320)` NOT NULL, `UNIQUE` | Один пользователь на адрес — иначе сброс пароля неоднозначен |
| `verified_at` | `timestamptz` NULL | Пусто → адрес в рассылку не попадает |
| `created_at`, `updated_at` | `timestamptz` NOT NULL | |

## Вклад в карточку пользователя

`docs.objects.extend('user', …)` добавляет в группу `security` страницы `default`:

| Поле | Widget | Замечание |
|---|---|---|
| `email` | `text` | Сохранение админом = подтверждение: `verified_at = now()` |
| `verifiedAt` | `datetime`, `readonly` | Видно, когда адрес подтверждён |

Пустое значение `email` не сохраняется и не очищает существующий адрес. Нарушение
`UNIQUE(email)` отдаётся админ-роутом как `409` через `mapDbError`.

## Подключение

Модуль backend-only. Состав приложения определяется `dependencies`:

```json
{ "dependencies": { "@amplicada/module-notification-email": "workspace:*" } }
```

После `pnpm install` генератор (`amplicada-modules`) сам добавит модуль в backend-состав.
Frontend-сторона не требуется: у модуля нет UI и CSS.

## Связанные решения

- ADR-04 «Ядро маршрутизирует, каналы доставляют» (`ref/adr/04-notifications.md`) — почему
  маршрутизация в ядре, а транспорт в модулях.
- ADR-07 «Контракт уведомлений v2» (`ref/adr/07-notification-contract-v2.md`) — именованные
  отправители, конверты, вложения.
- План уведомлений (`ref/plans/2026-09-15-notifications/`) — история решения и подпланы.
