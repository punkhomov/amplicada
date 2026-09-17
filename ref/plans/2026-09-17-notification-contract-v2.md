---
title: Notification API v2 — контракт под разных потребителей
type: plan
tier: 2
status: draft
date: 2026-09-17
---

# Notification API v2 — контракт под разных потребителей

Переработка контракта уведомлений под сценарии, которые уже запланированы, но текущим API
не покрываются. Потребитель сейчас один — админская рассылка (`module-admin`), поэтому контракт
ломается без переходного периода. Данные одноразовые, обратная совместимость не требуется
(политика проекта).

Предыдущий фундамент — [`2026-09-15-notifications/`](./2026-09-15-notifications/00-overview.md)
и [ADR-04](../adr/04-notifications.md). Этот план не отменяет разделение «ядро маршрутизирует,
каналы доставляют»: получатель остаётся пользователем, адрес по-прежнему резолвит канальный модуль.

## Зачем

| Потребитель | Что нужно | Чего не хватает сейчас |
|---|---|---|
| auth-password (регистрация, сброс пароля, email-OTP) | шаблон по коду + i18n, ссылки с токеном | шаблонов в контракте нет, рендер на вызывающем |
| workflow node hooks («вам назначена задача») | шаблон + переменные, идемпотентность | нет переменных, нет `dedupeKey` |
| learning («за N дней до срока») | рассылка пачкой, отложенная отправка | нет `sendMany`, нет `scheduledAt` |
| `task.alert` | получатель-не-пользователь | вне v2 (см. «Вне объёма») |
| admin broadcast (сделано) | bulk, батч в логе, отправитель | рассылка — цикл в HTTP-запросе, батча нет |

## Решения, зафиксированные с заказчиком

1. **Контракт ломается** — без слоя совместимости.
2. **Получатели — только пользователь** (`userId`); массовость — отдельным `sendMany`, не union-типом.
3. **Шаблоны — документы platform-core.** Code-шаблоны объявляются fixtures модулей, одна
   fixture-строка = пара `(code, locale)`.
4. **Fixture-шаблоны в админке — read-only** с бейджем: серверный guard + UI.
5. **Отправители именованные**, резолвит канал (email — из `SMTP_SENDERS`).
6. **В v2 входят:** `dedupeKey`, `scheduledAt`, вложения (контракт + канал + UI загрузки),
   `cc/bcc/replyTo/headers`.
7. **Переменные** — `{{path}}` в ядре, HTML-часть экранируется.
8. **Цепочки каналов** (email → sms) в v2 нет.

## Открытые вопросы — решить до реализации

1. **Eager для bulk.** Сейчас `send()` делает eager-попытку в процессе вызывающего
   (`notification-service.ts:96-116`), а диспетчер только добирает ретраи. Наивный `sendMany`
   даст N SMTP-отправок внутри HTTP-запроса админки (200 получателей = 200 `sendMail`).
   *Рекомендация:* одиночный `send` — eager как сейчас; `sendMany` — только строки в outbox,
   доставку делает worker-диспетчер (в ответе сразу `queued`, фактический статус — в логе).
2. **Неизвестное имя отправителя** — `null`/skip как при отсутствии канала или warn + дефолтный
   `SMTP_FROM`? *Рекомендация:* warn + дефолт, чтобы опечатка не глушила транзакционные письма.
3. **Отсутствующая переменная** в `{{path}}` — пустая строка + warn или оставить плейсхолдер?
   *Рекомендация:* пустая строка + warn.
4. **Лимиты вложений** — размер одного файла и суммарный (SMTP-провайдеры обычно режут 10–25 МБ).
   *Рекомендация:* 10 МБ на файл, 20 МБ на письмо; проверять на загрузке и при отправке.
5. **Очистка объектов storage** при снятии вложения и удалении шаблона — делать сразу или
   оставить orphan-объекты до отдельной уборки? *Рекомендация:* удалять при снятии и при
   hard-delete документа шаблона (в `remove`-колбэке extension'а).

## Целевой контракт

`packages/platform-core/src/contracts/notification.ts`:

```ts
export type NotificationContent =
  | { subject: string; body: string; html?: string }
  | { template: { code: string; data?: Record<string, unknown>; locale?: string } } // code-шаблон (fixture)
  | { template: { id: string; data?: Record<string, unknown> } };                   // документ-шаблон (админка)

export interface NotificationAttachment {
  storageKey: string;
  filename: string;
  contentType?: string;
  size?: number;
}

export interface NotificationMessage {
  userId: string;
  /** Устойчивый повод: 'auth.password-reset' | 'task.alert' | 'admin.broadcast' | … */
  kind: string;
  content: NotificationContent;
  /** Имя отправителя узла ('no-reply' | 'support'); резолвит канал. */
  sender?: string;
  /** Явный канал; без него — первый зарегистрированный, который знает адрес. */
  channel?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  attachments?: NotificationAttachment[];
  /** В будущем — без eager-попытки, начальный next_attempt_at. */
  scheduledAt?: Date;
  /** Идемпотентность бизнес-действия: повтор не создаёт вторую доставку. */
  dedupeKey?: string;
  locale?: string;
}

export interface SendManyRequest extends Omit<NotificationMessage, 'userId'> {
  userIds: string[];
}

export interface SendBatchResult {
  batchId: string;
  total: number;
  queued: number;
  skipped: number;
  failed: number;
  /** Совпало с уже существующей доставкой по dedupeKey. */
  deduped: number;
}

export interface NotificationChannel {
  id: string;
  resolveAddress(userId: string): Promise<string | null>;
  send(message: ResolvedNotification): Promise<void>;
  /** Имена отправителей, которые канал умеет резолвить (для UI админки). */
  listSenders?(): string[];
}

export interface BackendNotificationService {
  registerChannel(channel: NotificationChannel): void;
  listSenders(): string[];
  send(message: NotificationMessage): Promise<{ id: string } | null>;
  sendMany(request: SendManyRequest): Promise<SendBatchResult>;
  listDeliveries(params: NotificationDeliveryListParams & { batchId?: string }): Promise<{ items: NotificationDelivery[]; total: number }>;
  retry(id: string): Promise<boolean>;
  retryBatch(batchId: string): Promise<number>;
}
```

`ResolvedNotification` дополняется `sender`, `replyTo`, `cc`, `bcc`, `headers`, `attachments`.
События `notification.delivery.sent/failed` сохраняются; при необходимости позже добавится
событие завершения батча.

## Данные

**`core.notification_template`** — новый документ-тип ядра (переезд из `module-admin`):

| Колонка | Тип | Назначение |
|---|---|---|
| `id` | uuid PK | FK на `core.document_index` |
| `fixture_key` | varchar unique null | `'<code>:<locale>'`, идентичность fixture-строки |
| `code` | varchar null | код шаблона; частичный уникальный `(code, locale)` |
| `locale` | varchar(10) null | `ru` / `en`; у админских может быть пусто |
| `name` | varchar(100) not null | название в списке |
| `subject` / `body` / `html` | varchar/text | контент (в `html` допустимы `{{path}}`) |
| `sender` | varchar null | имя отправителя |
| `attachments` | jsonb not null default `[]` | манифест `NotificationAttachment[]` |
| `created_at` / `updated_at` | timestamptz | |

**`core.notification_outbox`** — добавления: `batch_id uuid null` (+ индекс),
`dedupe_key text null`, `sender text null`, `reply_to text null`, `cc/bcc/headers/attachments jsonb`,
частичный уникальный индекс `(kind, dedupe_key, user_id) where dedupe_key is not null`.

**Миграционный переход.** Новая миграция `platform-core/migrations/0007_notification_contract_v2.sql`:
создаёт `core.notification_template`, добавляет колонки/индексы в outbox, делает
`DROP TABLE IF EXISTS admin.notification_template`. Миграция `module-admin/migrations/0000_init.sql`
и её journal-запись удаляются, регистрация миграции `admin` из `module-admin/src/backend/index.ts`
снимается. У каждого модуля своя таблица `*_migrations` (`app.ts:258-264`), остаточная строка в
`admin_migrations` безвредна; данные одноразовые — при необходимости `docker compose down -v`.

## Поведение сервиса

- **Резолв шаблона:** `{ code, locale }` → точная локаль → `ru` → любая доступная (warn);
  `{ id }` → документ по id. Нет шаблона → `send` возвращает `null`, `sendMany` считает `skipped`,
  в лог — warning (как при отсутствии канала).
- **Рендер:** `{{path}}` по dot-path из `data`; `subject`/`body` — как есть, `html` — со
  HTML-экранированием подстановок. Результат снапшотится в outbox: при ретрае контент не
  перерендеривается.
- **dedupe:** конфликт по `(kind, dedupe_key, user_id)` → возвращается существующий id, новая
  строка не создаётся; в bulk — счётчик `deduped`. Повторная доставка — только через `retry`.
- **scheduledAt:** в будущем — eager не запускается, `next_attempt_at = scheduledAt`; в прошлом —
  как «сейчас».
- **sendMany:** один `batchId` на все строки, по строке на получателя (надёжность и лог — как
  сейчас); агрегат в ответе. Eager — по открытому вопросу 1.
- **sender:** имя уходит в `ResolvedNotification`; email-канал резолвит его в свой `from`/`replyTo`.

## Fixtures и read-only

- Тип `notification-template` регистрирует **platform-core** (иначе сборка без админки не может
  слать по шаблону); `module-admin` остаётся UI над типом.
- Модули объявляют шаблоны: `context.documents.fixtures.register({ type: 'notification-template',
  key: { column: 'fixture_key', value: '<code>:<locale>' }, values: { code, locale, name, subject,
  body, html, sender } })`.
- `reconcileFixtures` **перезаписывает** fixture-строку значениями из кода на каждом bootstrap
  (`document-runtime.ts`, reconcileFixtures) — это и есть семантика «источник истины в коде».
  Чтобы админ не терял правки молча:
  - флаг `fixture` добавляется в `INDEX_STATE_COLUMNS`, `DocumentObject` и ответ карточки;
  - `update`/`delete`/`bulkDelete` отклоняют fixture-документы (`DocumentRuntimeError`);
  - UI показывает бейдж «из кода» и блокирует Save/Delete.

## Канал email

`module-notification-email`:

- `SMTP_SENDERS` — JSON-карта имён: `{ "no-reply": { "from": "…", "replyTo": "…" }, "support": {…} }`;
  неизвестное имя — warn + дефолтный `SMTP_FROM`;
- `cc`/`bcc`/`replyTo`/`headers` прокидываются в `sendMail`;
- вложения — через `storage.getObjectStream(storageKey)` (стрим, не буфер), `filename`/`contentType`
  из манифеста;
- `listSenders()` отдаёт имена из конфига (для select в админке).

## Админка

- `POST /api/admin/notifications/send-template` переводится на `sendMany`
  (`content.template.id`), ответ — `SendBatchResult`.
- `POST /api/admin/notifications/batch/:batchId/retry` — повтор всех `failed` строк батча.
- `POST/DELETE /api/admin/notifications/template-attachments` — загрузка/удаление вложений
  (multipart уже зарегистрирован глобально, лимит 100 МБ — `app.ts:118`; ключ
  `notification-templates/<docId>/<uuid>-<filename>`), по образцу `routes/storage.ts`.
- UI: редактор шаблона — select отправителя и компонент вложений; список — бейдж «из кода»;
  карточка fixture-шаблона — read-only; лог доставок — фильтр по `batchId` и «повторить батч».

## Фазы

| # | Что | Пакеты | Зависит |
|---|---|---|---|
| 1 | ADR-07 (заменяет части ADR-04) + актуализация этого плана по открытым вопросам | `ref/adr`, `ref/plans` | решение заказчика |
| 2 | Контракт v2 + миграция `0007` + сервис: шаблоны, рендер, dedupe, `scheduledAt`, `sendMany`, `listSenders`; unit-тесты | `platform-core` | 1 |
| 3 | Тип шаблона в core, fixtures, read-only guard, переезд из admin, чистка admin-миграции | `platform-core`, `module-admin` | 2 |
| 4 | Email-канал: sender, cc/bcc/replyTo/headers, вложения | `module-notification-email` | 2 |
| 5 | Админка: sendMany, batch-retry, sender/вложения в редакторе, бейджи | `module-admin` | 3, 4 |
| 6 | Docs/notes/context + живой прогон на Mailpit | `ref`, docs пакетов | 5 |

## Проверка

- Unit: интерполятор (пути, escape, пропуски), dedupe-конфликт, агрегат `sendMany`, fallback
  локали, `scheduledAt` без eager, лимиты вложений.
- Live (Mailpit): fixture-шаблон с переменными доходит; вложение открывается; `cc`/`replyTo` видны
  в заголовках; повтор с тем же `dedupeKey` не создаёт дубль; `scheduledAt` в будущем лежит
  `pending`; правка fixture-шаблона → `409`; «повторить батч» переводит `failed` в `pending`.
- `pnpm build`, `pnpm test`, `pnpm lint`; инфра — `pnpm infra:up`.

## Вне объёма v2

Адрес/группа/роль как получатель (нужно для `task.alert`), цепочки каналов с фолбэком,
пользовательские предпочтения по каналам, rate-limit, версионирование шаблонов, SMS/push-каналы.

## Риски

- Переезд таблицы шаблонов из `admin` в `core` ломает формат БД — допустимо (данные одноразовые),
  отметить при реализации.
- `sendMany` без eager меняет наблюдаемость: статус в ответе будет `queued`, а не `sent`; для
  админки это компенсируется логом доставок.
- Read-only fixtures — первое место, где Document System ограничивает правку по признаку индекса;
  если guard окажется неудобен для других fixture-типов, вынести в опциональный флаг типа.

## Что дальше

После решения по открытым вопросам: ADR-07, затем фазы 2–6. По завершении — распределить знания
по постоянным документам (`plan-lifecycle`): контракт и его рационал — в ADR-07 и notes
`platform-core`, потребительская механика — в `packages/platform-core/docs/` и
`packages/module-notification-email/docs/`, админские роуты — в docs `module-admin`.
