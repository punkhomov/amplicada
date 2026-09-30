---
title: "Уведомления (сервис notification)"
type: reference
updated: 2026-09-30
verified_commit: 0551349
order: 20
---

# Уведомления (сервис notification)

Core-сервис `notification` — маршрутизация и надёжность доставки: реестр каналов, outbox,
ретраи, шаблоны. Транспорт и адресные книги — канальные модули (первый —
`module-notification-email`). Токен: `context.services.resolve<BackendNotificationService>('notification')`
(`src/backend/app.ts:178`).

## Интерфейс сервиса

| Метод | Поведение | Код |
|---|---|---|
| `registerChannel(channel)` | Регистрирует канал; повторная регистрация тем же id перезаписывает | `src/backend/services/notification-service.ts` |
| `listSenders()` | Объединение имён отправителей зарегистрированных каналов (для UI) | там же |
| `send(message)` | Резолвит контент и адрес, пишет строку outbox; `null` — нет канала, адреса или шаблона | там же |
| `sendMany(request)` | Батч: по строке на получателя, один `batchId`, **без eager**; возвращает `SendBatchResult` | там же |
| `listDeliveries(params)` | Лог доставок: фильтры `status/kind/userId/batchId`, пагинация `limit`/`offset` | там же |
| `retry(id)` | `failed` → `pending` вручную | там же |
| `retryBatch(batchId)` | Все `failed` строки батча → `pending`; возвращает число | там же |

Контракт и типы — `@amplicada/platform-core/contracts` (`src/contracts/notification.ts`):
`NotificationMessage`, `NotificationContent`, `NotificationAttachment`, `SendManyRequest`,
`SendBatchResult`, `ResolvedNotification`, `NotificationChannel`, `NOTIFICATION_EVENTS`.

## Контент

`NotificationContent` — union:

- inline: `{ subject, body, html? }` — как есть, без подстановок;
- code-шаблон: `{ template: { code, locale?, data? } }` — fixture-строка модуля;
- документ-шаблон: `{ template: { id, data? } }` — шаблон из админки.

`{{path}}` подставляется по dot-path из `data`: `subject`/`body` — как есть, `html` — с
экранированием подстановок. Отсутствующая переменная даёт пустую строку и warning в лог.
Результат **снапшотится** в outbox при постановке: ретрай контент не перерендеривает
(`src/backend/services/notification-render.ts`).

## Шаблоны

Документ-тип ядра `notification-template` (`Documents.NOTIFICATION_TEMPLATE`), таблица
`core.notification_template` (миграция `0007_notification_contract_v2.sql`). Code-шаблоны
объявляются fixtures модулей: ключ — `fixture_key = '<code>:<locale>'`, при bootstrap
`reconcileFixtures` перезаписывает fixture-строки значениями из кода.

Read-only действует у типов с `DocumentType.fixtureReadonly: true` (у `notification-template`
включён): `update`/`delete`/`bulkDelete` fixture-строки отклоняются `409`
(`src/backend/services/document-runtime.ts`). `scheduled-task` не затронут — его фикстуры
редактируются.

Резолв локали: точная (`template.locale` ?? `message.locale`) → `ru` → любая доступная + warning.
Шаблон не найден → `send()` возвращает `null`, `sendMany` считает получателя `skipped`.

## Доставка

- Строка пишется в `core.notification_outbox` со снапшотом контента и адреса; статусы
  `pending → sending → sent | failed`.
- Claim — условный `UPDATE pending → sending`: два процесса не отправят письмо дважды.
- `send()` делает eager-попытку в процессе вызывающего (кроме будущего `scheduledAt`);
  `sendMany` eager не делает — доставку добирает worker-диспетчер. **На узле `ROLE=web`
  строки батча лежат `pending` до воркера** (trade-off ADR-07).
- Ретраи: экспоненциальный бэкофф до часа, потолок попыток, восстановление зависших `sending`
  после краша, ретенция `sent`/`failed`. Диспетчер стартует только на worker-роли
  (`src/backend/services/notification-dispatcher.ts`, `src/backend/role.ts`).
- `dedupeKey` — идемпотентность бизнес-действия: partial unique `(kind, dedupe_key, user_id)`;
  повтор возвращает id существующей доставки, дубль не создаётся.
- `scheduledAt` в будущем: `next_attempt_at = scheduledAt`, eager не запускается.
- Вложения: лимиты `NOTIFICATION_ATTACHMENT_LIMITS` (10 МиБ/файл, 20 МиБ/письмо); канал
  проверяет реальный размер через `storage.headObject` и стримит объект в письмо.
- События: `notification.delivery.sent` / `notification.delivery.failed`.

## Конфиг (env)

| Переменная | Дефолт | Поведение |
|---|---|---|
| `NOTIFICATION_MAX_ATTEMPTS` | `5` | Потолок попыток доставки |
| `NOTIFICATION_RETRY_BASE_MS` | `30000` | База экспоненциального бэкоффа |
| `NOTIFICATION_RETENTION_DAYS` | `30` | Окно ретенции `sent`/`failed` |
| `ROLE` | `all` | Диспетчер и фоновые задачи — только `worker`/`all` |

## Ограничения

- Получатель — только пользователь (`userId`); адрес/роль как получатель — вне контракта.
- Цепочек каналов (email → sms) нет: сообщение уходит в один канал.
- Событие завершения батча не эмитится; агрегат виден в ответе `sendMany` и в логе доставок.

## Связанные решения

- ADR-07 (`ref/adr/07-notification-contract-v2.md`) — контракт v2; ADR-04
  (`ref/adr/04-notifications.md`) — базовая граница «ядро маршрутизирует, каналы доставляют».
- Админские роуты лога и рассылки — `packages/module-admin/docs/reference/notification-templates.md`.
