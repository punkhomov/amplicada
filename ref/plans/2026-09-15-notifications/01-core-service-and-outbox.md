---
title: Core notification service и outbox
type: plan
tier: 2
status: implemented
date: 2026-09-15
---

# 01. Core notification service и outbox

## Текущая проблема

- В ядре нет ни сервиса, ни таблиц для уведомлений (проверено: ни одного упоминания
  notification/mail/SMTP в `packages/*/src`).
- `EventBus` и `task.alert` есть, но за доставкой ничего не стоит.
- Core-задачи не ретраят (`TaskRunner` — одна попытка), значит подтверждение «письмо ушло» нельзя
  вешать на `task-scheduler` без своей логики повторов.

## Решение

Новый core-сервис `notification` (токен `notification`) — реестр каналов + outbox + диспетчер.

```text
вызывающий модуль
  notification.send({ userId, kind, subject, body, html? })
        │  resolve channel (explicit → иначе первый, кто знает адрес)
        ▼
  INSERT core.notification_outbox (status=pending, snapshot контента и адреса)
        │  void deliver(id)  ← eager в своём процессе, ответ API не ждёт SMTP
        ▼
  claim (conditional UPDATE) → channel.send() → sent | pending(backoff) | failed
        ▲
  NotificationDispatcher (worker role): due pending + зависшие sending + retention
```

## Контракты

`packages/platform-core/src/contracts/notification.ts`:

```ts
export interface NotificationMessage {
  userId: string;
  /** 'auth.password-reset' | 'task.alert' | 'learning.due-soon' | … */
  kind: string;
  subject: string;
  /** Plain text — обязателен. */
  body: string;
  /** HTML — опционален; рендерит отправитель, ядро хранит снапшот. */
  html?: string;
  locale?: string;
  /** Явный канал; без него — первый зарегистрированный, который знает адрес пользователя. */
  channel?: string;
}

export interface ResolvedNotification extends Omit<NotificationMessage, 'channel'> {
  deliveryId: string;
  channel: string;
  address: string;
}

export interface NotificationChannel {
  id: string;
  /** Адресная книга канала: null — пользователю этот канал недоступен. */
  resolveAddress(userId: string): Promise<string | null>;
  send(message: ResolvedNotification): Promise<void>;
}

export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface NotificationDelivery {
  id: string;
  userId: string | null;
  channel: string;
  kind: string;
  address: string;
  subject: string;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export interface NotificationDeliveryListParams {
  status?: NotificationStatus;
  kind?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface BackendNotificationService {
  registerChannel(channel: NotificationChannel): void;
  /** null — канала или адреса нет; это не ошибка вызывающего, решение остаётся за ним. */
  send(message: NotificationMessage): Promise<{ id: string } | null>;
  listDeliveries(params: NotificationDeliveryListParams): Promise<{ items: NotificationDelivery[]; total: number }>;
  /** Ручной повтор: failed → pending (nextAttemptAt = now). true — если строка переведена. */
  retry(id: string): Promise<boolean>;
}

export const NOTIFICATION_EVENTS = {
  sent: 'notification.delivery.sent',
  failed: 'notification.delivery.failed',
} as const;
```

Рекспорт: `contracts/index.ts` (типы + `NOTIFICATION_EVENTS`), `contracts/backend/index.ts`
(`BackendNotificationService`, `NotificationChannel`, …).

## Схема и миграция

`packages/platform-core/src/backend/schemas/notification-outbox.ts` (схема `core`):

```ts
export const notificationOutbox = coreSchema.table('notification_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  channel: varchar('channel', { length: 32 }).notNull(),
  kind: varchar('kind', { length: 64 }).notNull(),
  address: varchar('address', { length: 320 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  body: text('body').notNull(),
  html: text('html'),
  locale: varchar('locale', { length: 10 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Миграция core `0006_notification_outbox.sql` (journal idx 6, `when: 1789430400000`):

```sql
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
CREATE INDEX IF NOT EXISTS "notification_outbox_due_idx" ON "core"."notification_outbox" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "notification_outbox_user_idx" ON "core"."notification_outbox" ("user_id", "created_at" DESC);
```

FK на `identity_user` нет сознательно: получателем может быть не пользователь (позже — алерты на
технический адрес из env), а `user_id` в строке нужен для поиска/фильтра.

## Сервис

`packages/platform-core/src/backend/services/notification-service.ts`:

- конструктор `{ db, eventBus, config: { maxAttempts, retryBaseMs, retentionDays } }`;
- `registerChannel` — `Map<id, channel>`, повторная регистрация того же id перетирает (последний
  подключённый модуль выигрывает);
- `send`:
  1. канал — `message.channel` из реестра либо перебор каналов, пока `resolveAddress(userId)` не
     вернёт адрес;
  2. нет канала/адреса → `logger.warn` и `null`;
  3. `INSERT` строки (`maxAttempts` снапшотом из конфига) → `void this.deliver(id)` → `{ id }`;
- `deliver(id)` — атомарный claim условным UPDATE (`status='pending'` → `sending`), чтобы два процесса
  не отправили письмо дважды; успех → `sent` + `sent_at`; ошибка → `attempts+1`, `last_error`, и либо
  `pending` с бэкоффом, либо `failed` + `eventBus.emit(NOTIFICATION_EVENTS.failed, …)`;
- `requeueStaleSending()` — `sending` старше 5 минут (краш процесса между claim и завершением):
  `attempts+1`, дальше pending или failed — как в `workflow-automation-worker.ts`;
- `dispatchDue()` — `SELECT id … WHERE status='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 20`,
  затем `Promise.allSettled(ids.map(deliver))`;
- `cleanupOld()` — удаление `sent`/`failed` старше `retentionDays` (для failed — чтобы не терять
  доказательства слишком долго; окно настраивается);
- `listDeliveries` / `retry` — для админки ([03](./03-admin-delivery-log.md)).

Бэкофф: `nextAttemptAt = now + min(retryBaseMs · 2^attempts, 60 · 60_000)`.

События: `sent` и `failed` (payload — `{ deliveryId, userId, channel, kind, attempts, lastError? }`).
На `failed` ядро не подписывается — это точка для будущих алертов/метрик.

## Диспетчер

`packages/platform-core/src/backend/services/notification-dispatcher.ts` — тонкий цикл по образцу
`TaskReconciler`:

```ts
export class NotificationDispatcher {
  constructor(private notification: NotificationServiceImpl, private intervalMs = 10_000) {}
  async run(): Promise<void> {
    await this.notification.requeueStaleSending();
    await this.notification.dispatchDue();
    await this.notification.cleanupOld(); // внутри — не чаще раза в час
  }
  start(): void { /* setInterval + защита от наложения */ }
  stop(): void { /* clearInterval */ }
}
```

`app.ts`:
- в `createApp` — `services.register('notification', new NotificationServiceImpl({ db, eventBus, config }))`,
  конфиг из env с дефолтами;
- в `bootstrap` — `NotificationDispatcher` создаётся и регистрируется как сервис
  `notification-dispatcher`; `start()` — только под `isWorkerRole()` (eager-попытка в `send()` работает
  и на web-роли, так что письмо уходит и без воркера, а ретраи — на воркере);
- `registerShutdown` → `stopBackground: [{ name: 'notification-dispatcher', run: () => dispatcher.stop() }]`.

## Env

| Переменная | Дефолт | Смысл |
|------------|--------|-------|
| `NOTIFICATION_MAX_ATTEMPTS` | `5` | Попыток до `failed` (снапшот в строке) |
| `NOTIFICATION_RETRY_BASE_MS` | `30000` | База экспоненциального бэкоффа |
| `NOTIFICATION_RETENTION_DAYS` | `30` | Хранение `sent`/`failed` строк |

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `platform-core/src/contracts/notification.ts` | + контракты, `NotificationChannel`, события |
| `platform-core/src/contracts/index.ts`, `contracts/backend/index.ts` | экспорты |
| `platform-core/src/backend/schemas/notification-outbox.ts` | + схема |
| `platform-core/src/backend/schemas/index.ts` | экспорт таблицы/типов |
| `platform-core/migrations/0006_notification_outbox.sql` + `meta/_journal.json` | + миграция |
| `platform-core/src/backend/services/notification-service.ts` | + сервис (реестр, send, claim, ретраи, ретенция) |
| `platform-core/src/backend/services/notification-dispatcher.ts` | + цикл диспетчера |
| `platform-core/src/backend/app.ts` | регистрация сервиса, старт/стоп диспетчера |
| `platform-core/src/backend/index.ts` | экспорт `NotificationServiceImpl` |
| `platform-core/src/backend/services/notification-service.test.ts` | + юнит на бэкофф/резолв канала (без БД) |

## Порядок реализации

- [x] Контракты + схема + миграция 0006 + экспорты
- [x] `NotificationServiceImpl`: `send`/`deliver`/claim/бэкофф/`retry`/`listDeliveries`
- [x] `NotificationDispatcher` + провод в `app.ts` (worker role, shutdown)
- [x] Юнит-тесты на чистые функции (бэкофф, выбор канала)
- [x] `pnpm build && pnpm typecheck && pnpm lint`

## Проверка

1. **Канал не зарегистрирован** — `send()` возвращает `null`, в логе warning; исключений нет.
2. **Eager-доставка** — временный публичный тест-роут (или вызов из консоли воркера) с фиктивным
   каналом-логгером: строка сразу `sent`, событие `sent` в eventBus.
3. **Ретраи** — фиктивный канал, падающий N раз: `attempts` растёт, `next_attempt_at` растёт по
   бэкоффу, после `maxAttempts` — `failed` и событие `failed`.
4. **Зависший `sending`** — вручную оставить строку в `sending` с `updated_at` в прошлом →
   диспетчер вернул в `pending`/`failed`.
5. **Ретенция** — строка `sent` старше `retentionDays` удаляется диспетчером.
6. Проверить, что `pnpm dev` (web-роль) без `ROLE=worker` не запускает диспетчер, но eager-доставка
   работает.
