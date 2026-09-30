---
title: Notification API v2 — план реализации
type: plan
tier: 2
status: implemented
date: 2026-09-30
---

# Notification API v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести ветку `feat/notifications` (PR #3) до готового к мержу состояния: синхронизировать с main, реализовать контракт v2 (шаблоны-документы ядра, `sendMany`, dedupe, `scheduledAt`, вложения), покрыть проверками и живым прогоном Mailpit.

**Architecture:** Граница ADR-04 сохраняется: ядро маршрутизирует и владеет надёжностью (outbox, claim, бэкофф, ретенция), каналы — транспорт и адресные книги. V2 добавляет в ядро рендер `{{path}}`, шаблоны-документы (`core.notification_template`), fixture-строки с read-only флагом типа, `sendMany`/`dedupeKey`/`scheduledAt`; email-канал получает именованных отправителей, cc/bcc/replyTo/headers и вложения из storage.

**Tech Stack:** TypeScript 7 (type stripping, сборка `tsc`), Fastify 5, Drizzle ORM 0.45 (ручные SQL-миграции), React 19 + TanStack Query, nodemailer, PostgreSQL 16, Redis, SeaweedFS (S3), Mailpit, Playwright (headless).

**Spec:** `ref/plans/2026-09-17-notification-contract-v2.md` (решения от 2026-09-30). ADR-контекст — `ref/adr/04-notifications.md`; ADR-07 пишется в Task 1.

## Global Constraints

- Установка зависимостей — только `pnpm install`; политика `pnpm-workspace.yaml`: база main «7 дней» + strict-набор; исключения не расширять ради установки (AGENTS.md, `ref/context.md`).
- `drizzle-kit` не подключён: SQL-миграции и `migrations/meta/_journal.json` пишутся руками; `when` новой записи больше максимального применённого.
- Данные одноразовые: схемные миграции обязательны, миграции данных — нет; ломающий формат БД допустим с пометкой в PR/плане.
- Тесты — `node:test` по `dist/**/*.test.js`; перед тестами обязательна сборка (`turbo test` зависит от `build`). Одиночный пакет: `pnpm --filter @amplicada/<pkg> build && pnpm --filter @amplicada/<pkg> test`.
- Документация: ADR — по скиллу `architecture-decision-records`; `packages/<pkg>/docs/` и `ref/notes/<pkg>.md` — по скиллу `module-docs` (AGENTS.md).
- Live UI — Playwright только headless, скрипты/скриншоты в `/tmp/opencode/` (`ref/guides/playwright-sandbox.md`, появляется после rebase).
- Лимиты вложений — одна константа `NOTIFICATION_ATTACHMENT_LIMITS` (10 МиБ/файл, 20 МиБ/письмо) в `contracts/notification.ts`; на отправке реальный размер проверяется через `storage.headObject`.
- Read-only для fixture-документов действует только у типов с флагом `DocumentType.fixtureReadonly: true` (иначе сломается редактируемая карточка scheduled-task — тоже фикстур).
- `sendMany` — без eager: строки только в outbox, доставка worker-диспетчером; trade-off «нужна worker-роль» фиксируется в docs/notes.

## Review Focus

Входные классы/режимы, которые спека подразумевает, но простой TDD-цикл не ловит; каждый закрывается тестом в указанной задаче:

1. **Гонка `dedupeKey`** — параллельные `send` с одним ключом не создают вторую доставку (уникальность на partial unique index, `ON CONFLICT DO NOTHING` + выборка существующей) — Task 6 + live-проверка Task 19.
2. **Локаль шаблона** — отсутствующая/неизвестная локаль не роняет `send`: точная → `ru` → любая + warn — Task 5.
3. **Вложения** — пропавший объект, превышение лимита файла/суммы → ошибка доставки с `lastError` (retry/failed), не silent skip — Task 12.
4. **HTML-подстановки** — экранирование в `html`-части, но не в `subject`/`body`; отсутствующая переменная → пустая строка + warn — Task 3.
5. **`scheduledAt` в будущем** — eager не запускается даже у одиночного `send`, `next_attempt_at = scheduledAt` — Task 6 + live-проверка Task 19.

## File Structure

Создаются:

```
packages/platform-core/src/backend/services/notification-render.ts          # интерполятор и рендер контента
packages/platform-core/src/backend/services/notification-render.test.ts
packages/platform-core/src/backend/services/notification-template-resolver.ts
packages/platform-core/src/backend/services/notification-template-resolver.test.ts
packages/platform-core/src/backend/schemas/notification-template.ts
packages/platform-core/src/backend/documents/notification-template.ts
packages/platform-core/migrations/0007_notification_contract_v2.sql
packages/module-notification-email/src/backend/services/email-channel.test.ts
packages/module-admin/src/backend/lib/attachment-key.ts
packages/module-admin/src/backend/lib/attachment-key.test.ts
packages/platform-core/docs/reference/notifications.md                    # после rebase (каталог приходит с main)
ref/adr/07-notification-contract-v2.md
ref/notes/platform-core.md
ref/plans/2026-09-30-notification-v2-implementation.md                     # этот файл
```

Модифицируются (основные): `contracts/notification.ts`, `contracts/documents.ts`, `contracts/index.ts`, `contracts/backend/index.ts`, `backend/services/notification-service.ts`, `backend/services/document-runtime.ts`, `backend/services/document-runtime.test.ts`, `backend/services/notification-service.test.ts`, `backend/schemas/notification-outbox.ts`, `backend/schemas/index.ts`, `backend/documents/index.ts`, `backend/locales/{ru,en}.json`, `backend/app.ts`, `migrations/meta/_journal.json`, `module-notification-email/src/backend/{setup.ts,services/email-channel.ts}`, `module-notification-email/package.json`, `module-admin/src/backend/{index.ts,routes/notifications.ts,contracts/notification-template.ts,contracts/index.ts}`, `module-admin/src/frontend/{index.tsx,pages/admin-notifications/ui/...,pages/admin-document-card/ui/...,pages/admin-document-list/ui/...,widgets/notification-template-editor/ui/...,widgets/send-notification-template/ui/...,locales/{ru,en}.json}`, `ref/README.md`, `ref/context.md`, `ref/notes/module-admin.md`, `ref/notes/module-notification-email.md`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.env.host.example`.

Удаляются: `packages/module-admin/src/backend/schemas/notification-template.ts`, `packages/module-admin/src/backend/documents/notification-template.ts`, `packages/module-admin/src/backend/documents/index.ts` (вся папка), `packages/module-admin/migrations/` (вся папка).

---

### Task 0: Rebase ветки на `origin/main` и политика pnpm

**Files:**
- Modify: `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- Конфликты: `apps/api/package.json`, `packages/module-admin/{package.json,README.md,docs/index.md,src/contracts/index.ts,src/frontend/index.tsx}`, `ref/{README.md,context.md,notes/README.md,notes/module-admin.md}`

**Interfaces:**
- Produces: ветка `feat/notifications` на `origin/main` без конфликтов; `pnpm build/typecheck/test` зелёные; решение по nodemailer (^10 или ^8).

- [ ] **Step 1: Остановить dev-процессы**

```bash
pkill -f "[t]urbo dev"; pkill -f "[v]ite/bin/vite.js"; pkill -f "[t]sx --watch"
```

- [ ] **Step 2: Fetch и rebase**

```bash
git fetch origin && git checkout feat/notifications && git rebase origin/main
```

- [ ] **Step 3: Резолв конфликтов по правилам**

| Файл | Резолв |
|---|---|
| `apps/api/package.json` | union: зависимости main + `@amplicada/module-notification-email` |
| `packages/module-admin/package.json` | версия main как есть (file-viewer/dnd-kit; содержательных изменений ветки нет) |
| `packages/module-admin/src/contracts/index.ts` | union экспортов: storage/types (main) + notification-template (ветка) |
| `packages/module-admin/src/frontend/index.tsx` | union регистраций: storage (main) + notifications-страницы/виджеты/toolbar (ветка) |
| `packages/module-admin/README.md`, `docs/index.md` | union абзацев |
| `ref/README.md`, `ref/context.md`, `ref/notes/README.md`, `ref/notes/module-admin.md` | union строк/секций |
| `pnpm-workspace.yaml` | целевое содержимое из Step 4 |
| `pnpm-lock.yaml` | на конфликте: `git checkout --theirs -- pnpm-lock.yaml`; лок перегенерируется на Step 6 |

- [ ] **Step 4: Целевой `pnpm-workspace.yaml` (гибрид: возраст main + strict-набор)**

При конфликте в коммите `7c49ceac` записать полную версию (с исключениями main); при конфликте в `463862e6` — вариант с почищенными `minimumReleaseAgeExclude` и `trustPolicyExclude: [semver@6.3.1]`, как в ветке. Финальное содержимое:

```yaml
packages:
  - "packages/*"
  - "apps/*"
ignoreScripts: true
blockExoticSubdeps: true
strictDepBuilds: true
dangerouslyAllowAllBuilds: false
minimumReleaseAge: 10080
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
trustPolicy: no-downgrade
trustLockfile: false
trustPolicyExclude:
  - semver@6.3.1
strictStorePkgContentCheck: true
strictPeerDependencies: true
engineStrict: true
preferFrozenLockfile: true
allowBuilds:
  bcrypt: true
# Пины @smithy/* держат доверенные версии для всех потребителей, чтобы под них
# не заводить отдельные trustPolicyExclude: иначе trustPolicy: no-downgrade
# придётся разрешать поимённо.
overrides:
    "@smithy/core": 3.33.2
    '@smithy/fetch-http-handler': 5.7.2
    '@smithy/node-http-handler': 4.11.2
    '@smithy/types': 4.17.2
    '@smithy/signature-v4': 5.7.2
    '@smithy/credential-provider-imds': 4.5.2
```

- [ ] **Step 5: Завершить rebase**

```bash
git rebase --continue   # повторять до конца
git log --oneline origin/main..HEAD
```

- [ ] **Step 6: Перегенерация lock под гибридную политику**

```bash
pnpm install
```

Если install падает на `minimumReleaseAge`/`trustPolicy`: вернуть **только точную падающую запись** в соответствующий exclude-список с комментарием; политику не отключать. Затем:

```bash
git add pnpm-lock.yaml
git commit -m "chore(deps): regenerate lockfile after rebase onto main"
```

- [ ] **Step 7: Гейты**

Run: `pnpm build && pnpm typecheck && pnpm test`
Expected: все задачи успешны (13+/13+ сборок, тесты платформы).

- [ ] **Step 8: Решение по nodemailer (D-001)**

Проверить доступность `nodemailer@^10` (свои типы) под 7-дневным окном:

```bash
pnpm --filter @amplicada/module-notification-email add nodemailer@^10
```

Прошло → удалить `@types/nodemailer` из devDependencies, `pnpm build` зелёный, коммит:

```bash
git add packages/module-notification-email/package.json pnpm-lock.yaml
git commit -m "chore(notification-email): bump nodemailer to ^10"
```

Не прошло (политика возраста/типы) → откатить `git checkout -- packages/module-notification-email/package.json pnpm-lock.yaml`, остаёмся на `^8`; результат зафиксировать в Task 18 (обновление D-001).

- [ ] **Step 9: Commit (если остались правки после гейтов)**

```bash
git status --short   # должно быть пусто
```

---

### Task 1: ADR-07 и карты `ref/`

**Files:**
- Create: `ref/adr/07-notification-contract-v2.md`
- Modify: `ref/README.md`, `ref/plans/2026-09-17-notification-contract-v2.md`

**Interfaces:**
- Produces: ADR-07 (`status: accepted`); в спеке зафиксирован opt-in флаг `fixtureReadonly`; карты ссылаются на ADR-07 и план реализации.

- [ ] **Step 1: Загрузить скилл `architecture-decision-records`** и написать ADR-07: Context (потребители auth/workflow/learning; чего не хватает v1-контракту), Decision (контент-union и шаблоны-документы ядра; code-фикстуры read-only через `fixtureReadonly`; `sendMany` без eager → worker-trade-off; `dedupeKey`; `scheduledAt`; вложения 10/20 МиБ и `headObject`; именованные отправители), Consequences, Related (`adr/04-notifications.md` — заменяет части; план v2 и план реализации).

- [ ] **Step 2: Актуализировать спеку по отклонению от риска**

В `ref/plans/2026-09-17-notification-contract-v2.md`: в секции «Fixtures и read-only» заменить «`update`/`delete`/`bulkDelete` отклоняют fixture-документы» на формулировку с флагом типа: guard действует у типов с `fixtureReadonly: true` (у `notification-template` включён; `scheduled-task` не затронут). Строку риска про вынос в флаг пометить закрытой.

- [ ] **Step 3: Карты**

`ref/README.md`: строка ADR-07 в таблице ADR; строка этого плана (`plans/2026-09-30-notification-v2-implementation.md`, in-progress); статус спеки v2 — `in-progress`.

- [ ] **Step 4: Commit**

```bash
git add ref/adr/07-notification-contract-v2.md ref/README.md ref/plans/2026-09-17-notification-contract-v2.md ref/plans/2026-09-30-notification-v2-implementation.md
git commit -m "docs(adr): add ADR-07 for notification contract v2"
```

---

### Task 2: Контракт v2

**Files:**
- Modify: `packages/platform-core/src/contracts/notification.ts` (полная замена), `packages/platform-core/src/contracts/index.ts`
- Test: компиляция (`pnpm --filter @amplicada/platform-core build`)

**Interfaces:**
- Produces (используется всеми последующими задачами): `NotificationContent`, `NotificationAttachment`, `NOTIFICATION_ATTACHMENT_LIMITS`, `NotificationMessage`, `SendManyRequest`, `SendBatchResult`, `NotificationChannel.listSenders?()`, `ResolvedNotification`, `NotificationDelivery.batchId`, `NotificationDeliveryListParams.batchId`, `BackendNotificationService.{sendMany,listSenders,retryBatch}`.

- [ ] **Step 1: Записать контракт**

```ts
export type NotificationContent =
  | { subject: string; body: string; html?: string }
  | { template: { code: string; data?: Record<string, unknown>; locale?: string } }
  | { template: { id: string; data?: Record<string, unknown> } };

export interface NotificationAttachment {
  storageKey: string;
  filename: string;
  contentType?: string;
  size?: number;
}

export const NOTIFICATION_ATTACHMENT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
} as const;

export interface NotificationMessage {
  userId: string;
  kind: string;
  content: NotificationContent;
  sender?: string;
  channel?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  attachments?: NotificationAttachment[];
  scheduledAt?: Date;
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
  deduped: number;
}

export interface ResolvedNotification {
  deliveryId: string;
  userId: string;
  kind: string;
  channel: string;
  address: string;
  subject: string;
  body: string;
  html?: string;
  locale?: string;
  sender?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  attachments?: NotificationAttachment[];
}
```

`NotificationChannel` получает `listSenders?(): string[]`; `NotificationDelivery` — `batchId: string | null`; `NotificationDeliveryListParams` — `batchId?: string`;
`BackendNotificationService` — `sendMany(request): Promise<SendBatchResult>`, `listSenders(): string[]`, `retryBatch(batchId): Promise<number>`; `send` сохраняет сигнатуру.
`NotificationStatus`, `NOTIFICATION_EVENTS`, `NotificationSentEvent`, `NotificationFailedEvent` — без изменений.

- [ ] **Step 2: Обновить экспорты** в `contracts/index.ts` (добавить `NotificationAttachment`, `NotificationContent`, `SendManyRequest`, `SendBatchResult`, `NOTIFICATION_ATTACHMENT_LIMITS`) и `contracts/backend/index.ts` (без изменений, если `BackendNotificationService` уже экспортируется).

- [ ] **Step 3: Сборка**

Run: `pnpm --filter @amplicada/platform-core build`
Expected: PASS (ошибок типов в контракте нет; потребители ещё не обновлены — сборка пакета core проходит, общий `pnpm build` временно красный на module-admin/email — это ожидаемо до Tasks 6–17; последующие задачи чинят).

- [ ] **Step 4: Commit**

```bash
git add packages/platform-core/src/contracts/notification.ts packages/platform-core/src/contracts/index.ts
git commit -m "feat(platform-core)!: break notification contract to v2"
```

---

### Task 3: Интерполятор `{{path}}` и рендер контента (TDD)

**Files:**
- Create: `packages/platform-core/src/backend/services/notification-render.ts`, `notification-render.test.ts`

**Interfaces:**
- Produces: `interpolate(template, data, opts?): { value: string; missing: string[] }`; `renderContent(content, data): RenderedContent`; `type RenderedContent = { subject: string; body: string; html?: string; missing: string[] }`.

- [ ] **Step 1: Написать падающие тесты** `notification-render.test.ts` (`node:test` + `node:assert/strict`):
  - `'{{user.name}} подставляется по dot-path'` → `'Привет, Иван!'`;
  - `'отсутствующий путь → пустая строка и missing'` → `value: ''`, `missing: ['a.b']`;
  - `'null и undefined считаются отсутствующими'` (null → missing, пустая строка);
  - `'примитивы приводятся к строке'` (число/boolean);
  - `'объекты сериализуются в JSON'`;
  - `'escapeHtml экранирует & < > " \''` → `&amp; &lt; &gt; &quot; &#39;`;
  - `'renderContent не экранирует subject/body, но экранирует html'`;
  - `'renderContent собирает missing по всем частям'`.

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `pnpm --filter @amplicada/platform-core build; pnpm --filter @amplicada/platform-core test`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`interpolate`: regex `/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g`; путь — split('.'); значение по пути; `null`/`undefined`/отсутствие → `''` + путь в `missing`; примитив → `String`; объект → `JSON.stringify`. При `escapeHtml` — экранирование **только подставленного значения**.
`renderContent`: `subject` и `body` без escape, `html` (если есть) с escape; `missing` — объединение без дублей.

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @amplicada/platform-core build && pnpm --filter @amplicada/platform-core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/backend/services/notification-render.ts packages/platform-core/src/backend/services/notification-render.test.ts
git commit -m "feat(platform-core): add notification template interpolation"
```

---

### Task 4: Outbox-схема и миграция `0007`

**Files:**
- Modify: `packages/platform-core/src/backend/schemas/notification-outbox.ts`, `packages/platform-core/src/backend/schemas/index.ts`, `packages/platform-core/migrations/meta/_journal.json`
- Create: `packages/platform-core/migrations/0007_notification_contract_v2.sql`, `packages/platform-core/src/backend/schemas/notification-template.ts`

**Interfaces:**
- Produces: колонки outbox `batchId/dedupeKey/sender/replyTo/cc/bcc/headers/attachments`; drizzle-схема `notificationTemplate` и SQL-таблица `core.notification_template` (регистрация документ-типа — Task 8).

- [ ] **Step 1: Drizzle-схемы**

Дополнить outbox полями: `batchId: uuid('batch_id')`, `dedupeKey: text('dedupe_key')`, `sender: varchar('sender', { length: 64 })`, `replyTo: varchar('reply_to', { length: 320 })`, `cc: jsonb('cc').$type<string[]>()`, `bcc: jsonb('bcc').$type<string[]>()`, `headers: jsonb('headers').$type<Record<string, string>>()`, `attachments: jsonb('attachments').$type<NotificationAttachment[]>().notNull().default(sql\`'[]'::jsonb\`)`; индексы `notification_outbox_batch_idx (batch_id)` и частичный unique `notification_outbox_dedupe_idx (kind, dedupe_key, user_id) where dedupe_key is not null`.
Создать `schemas/notification-template.ts`: `notificationTemplate` в `coreSchema` — колонки 1:1 с SQL ниже (`fixtureKey`, `code`, `locale`, `name`, `subject`, `body`, `html`, `sender`, `attachments` jsonb `$type<NotificationAttachment[]>()`, `createdAt`, `updatedAt`); экспорт из `schemas/index.ts`.

- [ ] **Step 2: Написать миграцию** `0007_notification_contract_v2.sql`:

```sql
-- Notification contract v2 (ref/plans/2026-09-17-notification-contract-v2.md).
-- Шаблоны переезжают из admin в core (документ-тип ядра), outbox получает батчи,
-- dedupe, отправителя, конверты и вложения. Данные одноразовые: перенос строк не делается.

CREATE TABLE IF NOT EXISTS "core"."notification_template" (
  "id" uuid PRIMARY KEY,
  "fixture_key" varchar(255) UNIQUE,
  "code" varchar(128),
  "locale" varchar(10),
  "name" varchar(100) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "html" text,
  "sender" varchar(64),
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notification_template_id_document_fk"
    FOREIGN KEY ("id") REFERENCES "core"."document_index"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_template_code_locale_idx"
  ON "core"."notification_template" ("code", "locale") WHERE "code" IS NOT NULL;

ALTER TABLE "core"."notification_outbox"
  ADD COLUMN IF NOT EXISTS "batch_id" uuid,
  ADD COLUMN IF NOT EXISTS "dedupe_key" text,
  ADD COLUMN IF NOT EXISTS "sender" varchar(64),
  ADD COLUMN IF NOT EXISTS "reply_to" varchar(320),
  ADD COLUMN IF NOT EXISTS "cc" jsonb,
  ADD COLUMN IF NOT EXISTS "bcc" jsonb,
  ADD COLUMN IF NOT EXISTS "headers" jsonb,
  ADD COLUMN IF NOT EXISTS "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "notification_outbox_batch_idx"
  ON "core"."notification_outbox" ("batch_id");

CREATE UNIQUE INDEX IF NOT EXISTS "notification_outbox_dedupe_idx"
  ON "core"."notification_outbox" ("kind", "dedupe_key", "user_id")
  WHERE "dedupe_key" IS NOT NULL;

DROP TABLE IF EXISTS "admin"."notification_template";
```

- [ ] **Step 3: Запись в journal**

В `migrations/meta/_journal.json` добавить `{ "idx": 7, "version": "7", "when": 1790755200000, "tag": "0007_notification_contract_v2", "breakpoints": true }` (больше `when` записи 0006).

- [ ] **Step 4: Сборка**

Run: `pnpm --filter @amplicada/platform-core build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/backend/schemas/notification-outbox.ts packages/platform-core/src/backend/schemas/index.ts packages/platform-core/migrations
git commit -m "feat(platform-core)!: add v2 outbox columns and core.notification_template"
```

---

### Task 5: Резолв шаблонов (TDD)

**Files:**
- Create: `packages/platform-core/src/backend/services/notification-template-resolver.ts`, `notification-template-resolver.test.ts`

**Interfaces:**
- Consumes: `notificationTemplate` (Task 4), `NotificationAttachment`.
- Produces: `pickTemplateLocale<T extends { locale: string | null }>(rows: T[], requested?: string): T | null`; `loadTemplate(db, ref, locale?): Promise<LoadedTemplate | null>`; `interface LoadedTemplate { subject: string; body: string; html: string | null; sender: string | null; attachments: NotificationAttachment[]; locale: string | null }`.

- [ ] **Step 1: Падающие тесты**
  - `pickTemplateLocale`: точная локаль; fallback `ru`; fallback «любая» (первая); пустой список → null;
  - `loadTemplate({ id })` — `recordingDb` (паттерн `document-runtime.test.ts:38-51`): строка найдена; нет строки → null + warn;
  - `loadTemplate({ code, locale })` — exact-локаль; fallback ru; любой доступный + warn.

- [ ] **Step 2: Убедиться, что падают**

Run: `pnpm --filter @amplicada/platform-core build; pnpm --filter @amplicada/platform-core test`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`loadTemplate`: `{ id }` → `select().from(notificationTemplate).where(eq(id)).limit(1)`; `{ code }` → `select().from(notificationTemplate).where(eq(code))` (все локали) → `pickTemplateLocale(rows, locale)`. `null` → `logger.warn({ ref }, 'Шаблон уведомления не найден')`.

- [ ] **Step 4: Тесты зелёные** (команда Step 2)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/backend/services/notification-template-resolver.ts packages/platform-core/src/backend/services/notification-template-resolver.test.ts
git commit -m "feat(platform-core): resolve notification templates by id and code"
```

---

### Task 6: `send()` v2 — контент, dedupe, scheduledAt

**Files:**
- Modify: `packages/platform-core/src/backend/services/notification-service.ts`, `notification-service.test.ts`

**Interfaces:**
- Consumes: `renderContent` (Task 3), `loadTemplate` (Task 5), outbox-схема (Task 4).
- Produces: `send(message): Promise<{ id: string } | null>` v2; снапшот контента и конвертов в outbox; dedupe-конфликт возвращает существующий id; будущий `scheduledAt` отменяет eager.

- [ ] **Step 1: Падающие тесты** (recordingDb + стаб `eventBus: { emit() {} }`):
  - `'send без dedupe вставляет строку и делает eager'` — после insert есть вызов delivery (recordingDb фиксирует UPDATE claim);
  - `'send с существующим dedupeKey возвращает существующий id и не вставляет'` — insert c `ON CONFLICT DO NOTHING` возвращает `[]`, следующий запрос — select существующей;
  - `'send с scheduledAt в будущем не запускает eager и ставит next_attempt_at'`.

- [ ] **Step 2: Убедиться, что падают** (команда Task 5 Step 2). Expected: FAIL.

- [ ] **Step 3: Реализовать**

Порядок `send`: (1) контент: inline или `loadTemplate` (нет шаблона → warn + `null`); `renderContent` (missing → warn со списком); (2) `resolveTarget` (нет → warn + `null`); (3) `scheduledAt` в будущем → `nextAttemptAt = scheduledAt`, eager не запускать; (4) insert с полями v2 (`batchId: null`, `dedupeKey`, `sender`, `replyTo`, `cc`, `bcc`, `headers`, `attachments`); при `dedupeKey` — `.onConflictDoNothing().returning()`; пустой результат → select существующей по `(kind, dedupeKey, userId)` и вернуть её id; (5) eager `void this.deliver(id)` только если не будущий scheduledAt.

- [ ] **Step 4: Тесты зелёные** (команда Task 5 Step 2). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/backend/services/notification-service.ts packages/platform-core/src/backend/services/notification-service.test.ts
git commit -m "feat(platform-core): render content, dedupe and schedule in notification send"
```

---

### Task 7: `sendMany`, `retryBatch`, `listSenders`, фильтр `batchId`

**Files:**
- Modify: `packages/platform-core/src/backend/services/notification-service.ts`, `notification-service.test.ts`

**Interfaces:**
- Consumes: всё из Task 6.
- Produces: `sendMany(request): Promise<SendBatchResult>` (один `batchId`, по строке на получателя, без eager); `retryBatch(batchId): Promise<number>`; `listSenders(): string[]` (union каналов, сортировка); `listDeliveries({ batchId })` и `NotificationDelivery.batchId`.

- [ ] **Step 1: Падающие тесты**
  - `'sendMany без шаблона не вставляет строк и считает skipped'` — recordingDb: первый select шаблона → `[]`, число запросов не растёт;
  - `'listSenders объединяет имена каналов без дублей'` — два канала `listSenders` (`['no-reply','support']`, `['support']`) → `['no-reply','support']`;
  - `'счётчики sendMany агрегируют queued/skipped/failed/deduped'` — юнит на чистую функцию `countBatchOutcomes(outcomes): Omit<SendBatchResult,'batchId'|'total'>` (вынести отдельно и экспортировать).

- [ ] **Step 2: Убедиться, что падают** (команда Task 5 Step 2). Expected: FAIL.

- [ ] **Step 3: Реализовать**

`sendMany`: контент резолвится один раз; `batchId = randomUUID()`; цикл по `userIds`: `resolveTarget` → `skipped`; insert → `queued`/`deduped` (по dedupe-пути Task 6); исключение → `failed` + warn. Eager не вызывать. `total = userIds.length`.
`retryBatch`: `UPDATE ... WHERE batch_id = ? AND status = 'failed'` → count. `listSenders`: union + sort. `listDeliveries`: фильтр `batchId`; в маппинг добавить `batchId`.

- [ ] **Step 4: Тесты зелёные** (команда Task 5 Step 2). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/backend/services/notification-service.ts packages/platform-core/src/backend/services/notification-service.test.ts
git commit -m "feat(platform-core): add notification sendMany, batch retry and senders"
```

---

### Task 8: Документ-тип ядра `notification-template`

**Files:**
- Create: `packages/platform-core/src/backend/documents/notification-template.ts`
- Modify: `packages/platform-core/src/backend/documents/index.ts`, `packages/platform-core/src/contracts/documents.ts`, `packages/platform-core/src/backend/locales/{ru,en}.json`, `packages/platform-core/src/backend/app.ts`

**Interfaces:**
- Consumes: drizzle-схема `notificationTemplate` и SQL-таблица (Task 4), `BackendStorageService`.
- Produces: `Documents.NOTIFICATION_TEMPLATE = 'notification-template'`; `registerNotificationTemplateDoc(docs: DocumentRegistry, storage: BackendStorageService): void`; `remove`-хук чистит объекты вложений best-effort и удаляет строку расширения.

- [ ] **Step 1: Регистрация типа** `backend/documents/notification-template.ts` (схема создана в Task 4):

```ts
docs.register(Documents.NOTIFICATION_TEMPLATE, {
  module: 'core',
  label: 'core:notification_template_label',
  topic: DashboardTopics.SYSTEM,
});
```

Extension (module `'core'`): layout `[name, locale]`, `[subject span 2]`, `[{ component: 'notification-template-editor', span: 2 }]`;
fields: `name` (text, required), `subject` (text, required), `locale` (select: ru/en), `body` (text), `html` (text), `sender` (text), `attachments` (text) — последние четыре только как метки для компонента;
`schema: notificationTemplate`, `idColumn: 'id'`;
`remove: async (tx, docId) => { const [row] = await tx.select().from(notificationTemplate).where(eq(notificationTemplate.id, docId)).limit(1); for (const a of row?.attachments ?? []) { try { await storage.deleteObject(a.storageKey); } catch (err) { logger.warn({ err, key: a.storageKey }, 'Не удалось удалить вложение шаблона'); } } await tx.delete(notificationTemplate).where(eq(notificationTemplate.id, docId)); }`.

List extension: `name`, `subject`, `locale`, `sender`, `updatedAt`, `fixture` (checkbox; label `core:notification_template_list_fixture`).

- [ ] **Step 2: Константа и карты**

`contracts/documents.ts:344`: `Documents` += `NOTIFICATION_TEMPLATE: 'notification-template'`.
`backend/documents/index.ts`: экспорт и вызов `registerNotificationTemplateDoc`.
`backend/app.ts`: `registerCoreDocuments(context.documents)` → `registerCoreDocuments(context.documents, context.services.resolve<BackendStorageService>('storage'))` (сервис `storage` зарегистрирован выше, `app.ts:157`).

- [ ] **Step 3: Локали** `backend/locales/{ru,en}.json` — ключи: `notification_template_label`, `notification_template_field_{name,subject,locale,body,html,sender,attachments}`, `notification_template_locale_{ru,en}`, `notification_template_list_fixture` («Из кода» / "From code").

- [ ] **Step 4: Сборка** `pnpm --filter @amplicada/platform-core build` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/backend packages/platform-core/src/contracts/documents.ts
git commit -m "feat(platform-core): register notification-template document type"
```

---

### Task 9: Флаг `fixture` в API и read-only guard (TDD)

**Files:**
- Modify: `packages/platform-core/src/contracts/documents.ts`, `packages/platform-core/src/backend/services/document-runtime.ts`, `document-runtime.test.ts`
- Modify: `packages/module-admin/src/backend/routes/documents.ts` (ответ карточки)

**Interfaces:**
- Produces: `DocumentType.fixtureReadonly?: boolean`; `DocumentObject.fixture?: boolean`; `INDEX_STATE_COLUMNS.fixture`; guard 409 у `update`/`delete`/`bulkDelete` для fixture-строк типов с `fixtureReadonly`; карточка отдаёт `fixture: boolean`.

- [ ] **Step 1: Падающие тесты** (`document-runtime.test.ts`, recordingDb):
  - `'update fixture-документа типа с fixtureReadonly → 409'`;
  - `'update fixture-документа типа без флага → проходит'`;
  - `'delete и bulkDelete fixture-документа типа с fixtureReadonly → 409'`;
  - `'getAnyById отдаёт fixture'`;
  - `'index-колонка fixture доступна списку через INDEX_STATE_COLUMNS'`.

- [ ] **Step 2: Убедиться, что падают** (команда Task 5 Step 2). Expected: FAIL.

- [ ] **Step 3: Реализовать**

`INDEX_STATE_COLUMNS` += `fixture: documentIndex.fixture`.
`getAnyById` (`document-runtime.ts:495-526`): select `{ type, fixture }`, вернуть `{ id, type, data, fixture }`.
`assertDocumentActive` (`:554-561`): select `{ id, fixture }`; если `row.fixture && this.getDocOrFail(type).fixtureReadonly` → `throw new DocumentRuntimeError(409, 'Документ объявлен кодом (fixture) и не редактируется вручную')`.
`deleteMany` (`:597-614`): перед транзакцией — если `doc.fixtureReadonly`, select `documentIndex.id` по `inArray(ids)` + `fixture = true`; непусто → `throw new DocumentRuntimeError(409, 'Документ объявлен кодом (fixture) и не удаляется вручную')`.
`contracts/documents.ts`: `DocumentType.fixtureReadonly?: boolean`, `DocumentObject.fixture?: boolean`.
Карточка (`module-admin/src/backend/routes/documents.ts:79-87`): добавить `fixture: doc.fixture ?? false`.

- [ ] **Step 4: Тесты зелёные** (команда Task 5 Step 2). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/contracts/documents.ts packages/platform-core/src/backend/services/document-runtime.ts packages/platform-core/src/backend/services/document-runtime.test.ts packages/module-admin/src/backend/routes/documents.ts
git commit -m "feat(platform-core): expose fixture flag and guard read-only fixtures"
```

---

### Task 10: Переезд шаблонов из `module-admin`

**Files:**
- Delete: `packages/module-admin/src/backend/schemas/notification-template.ts`, `packages/module-admin/src/backend/documents/` (папка), `packages/module-admin/migrations/` (папка)
- Modify: `packages/module-admin/src/backend/schemas/index.ts`, `src/backend/index.ts`, `src/contracts/notification-template.ts`, `src/contracts/index.ts`, `src/frontend/index.tsx`, `src/frontend/widgets/{notification-template-editor,send-notification-template}/ui/*.tsx` (импорт `Documents` вместо `AdminDocuments`), `src/backend/locales/{ru,en}.json` (убрать `template_label`/`template_field_*` — переехали в core)

**Interfaces:**
- Consumes: `Documents.NOTIFICATION_TEMPLATE` (Task 8), guard (Task 9).
- Produces: admin — только UI над core-типом; `AdminDocuments` удалён, `ADMIN_BROADCAST_KIND`/`ADMIN_BROADCAST_MAX_RECIPIENTS` остаются.

- [ ] **Step 1: Удалить v1-файлы и регистрации**

Удалить схему/документы/`migrations/`; из `module-admin/src/backend/index.ts` — строку `context.migrations.register('admin', ...)` (`:22`) и `registerNotificationTemplateDocuments(context.documents)` (`:26`).

- [ ] **Step 2: Перевести константу типа на core**

`src/contracts/notification-template.ts`: убрать `AdminDocuments`; экспорты `ADMIN_BROADCAST_KIND`, `ADMIN_BROADCAST_MAX_RECIPIENTS`; импорт `Documents` из `@amplicada/platform-core/contracts` в местах использования (widgets/send и frontend/index).
Dashboard-link `notification-templates` не меняется (путь строкой).

- [ ] **Step 3: Сборка**

Run: `pnpm --filter @amplicada/platform-core build && pnpm --filter @amplicada/module-admin build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A packages/module-admin
git commit -m "refactor(module-admin)!: move notification templates to platform-core"
```

---

### Task 11: Email-канал — именованные отправители и конверты (TDD)

**Files:**
- Modify: `packages/module-notification-email/src/backend/services/email-channel.ts`, `src/backend/setup.ts`, `package.json` (test-скрипт), `.env.host.example`
- Create: `packages/module-notification-email/src/backend/services/email-channel.test.ts`

**Interfaces:**
- Produces: `readSendersConfig(env): Record<string, SenderConfig>`; `selectSender(senders, name): SenderConfig | null`; `SmtpConfig.senders`; `EmailChannel.listSenders()`; `send` прокидывает `from`/`replyTo`/`cc`/`bcc`/`headers`.

- [ ] **Step 1: Падающие тесты**
  - `'SMTP_SENDERS парсится; битый JSON → {} + warn'`;
  - `'selectSender: известное имя → from/replyTo; неизвестное → null'`;
  - `'send: cc/bcc/replyTo/headers уходят в sendMail'` (fake transport записывает options);
  - `'send: явный replyTo сообщения приоритетнее sender.replyTo'`;
  - `'send: неизвестный sender → дефолтный from + warn'`.

- [ ] **Step 2: Добавить test-скрипт** в `package.json`: `"test": "node --test \"dist/**/*.test.js\""`; убедиться, что падают: `pnpm --filter @amplicada/module-notification-email build && pnpm --filter @amplicada/module-notification-email test` → FAIL.

- [ ] **Step 3: Реализовать**

`readSmtpConfig` читает `SMTP_SENDERS` (JSON-объект `{ name: { from, replyTo? } }`; пусто/битый → `{}` + warn) и кладёт в `SmtpConfig.senders`.
`EmailChannel` ctor: `(db, transport, from, senders, storage)` (storage — Task 12). `send`: `const sender = selectSender(this.senders, message.sender)` (имя есть, не найдено → warn + дефолт); `from = sender?.from ?? this.from`; `replyTo = message.replyTo ?? sender?.replyTo`; `cc/bcc/headers` — как есть.
`setup.ts`: передать `smtp.senders` и `context.services.resolve<BackendStorageService>('storage')`.

- [ ] **Step 4: `.env.host.example`** — под SMTP-блоком:

```
# Именованные отправители (JSON): имя → from/replyTo. Неизвестное имя — fallback на SMTP_FROM.
# SMTP_SENDERS={"no-reply":{"from":"Amplicada <no-reply@amplicada.local>"},"support":{"from":"Support <support@amplicada.local>","replyTo":"support@amplicada.local"}}
```

- [ ] **Step 5: Тесты зелёные** (команда Step 2). Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add packages/module-notification-email .env.host.example
git commit -m "feat(notification-email): named senders and message envelope"
```

---

### Task 12: Email-канал — вложения (TDD)

**Files:**
- Modify: `packages/module-notification-email/src/backend/services/email-channel.ts`, `email-channel.test.ts`

**Interfaces:**
- Consumes: `NOTIFICATION_ATTACHMENT_LIMITS`, `BackendStorageService.{headObject,getObjectStream}`.
- Produces: `send` падает с понятной ошибкой на пропавший объект/превышение лимита; вложения идут стримом.

- [ ] **Step 1: Падающие тесты** (fake storage: `headObject`/`getObjectStream`; fake transport):
  - `'пропавший объект → ошибка «Вложение не найдено»'`;
  - `'файл больше 10 МиБ → ошибка лимита'`;
  - `'сумма больше 20 МиБ → ошибка лимита'`;
  - `'вложения уходят в sendMail c filename/contentType и стримом'` (assert: `content` — Readable, не Buffer).

- [ ] **Step 2: Убедиться, что падают** (команда Task 11 Step 2). Expected: FAIL.

- [ ] **Step 3: Реализовать**

В `send` до `sendMail`: суммарная проверка по фактическим `headObject().size`; для каждого вложения `headObject` → null → `throw new Error(\`Вложение не найдено: ${storageKey}\`)`; `size > maxFileBytes` → `throw new Error('Вложение больше 10 МиБ')`; сумма > `maxTotalBytes` → `throw new Error('Сумма вложений больше 20 МиБ')`. Затем `const { body } = await storage.getObjectStream(key)` и `attachments.push({ filename, content: body, contentType: a.contentType ?? info.contentType })`.

- [ ] **Step 4: Тесты зелёные** (команда Task 11 Step 2). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/module-notification-email/src/backend/services/email-channel.ts packages/module-notification-email/src/backend/services/email-channel.test.ts
git commit -m "feat(notification-email): stream attachments with size limits"
```

---

### Task 13: Админ-роуты v2 — senders, `sendMany`, batch-retry

**Files:**
- Modify: `packages/module-admin/src/backend/routes/notifications.ts`, `src/contracts/notification-template.ts`

**Interfaces:**
- Consumes: `BackendNotificationService.{listSenders,sendMany,retryBatch}`, `SendBatchResult`.
- Produces: `GET /notifications/senders` → `{ senders: string[] }`; `POST /notifications/send-template` → `SendBatchResult`; `POST /notifications/batch/:batchId/retry` → `{ retried: number }`.

- [ ] **Step 1: Переписать роуты**

`send-template`: `normalizeRecipients` и проверки как сейчас; убрать прямой select шаблона; вызвать `notification.sendMany({ userIds, kind: ADMIN_BROADCAST_KIND, content: { template: { id: templateId } } })`; вернуть результат.
`senders`: `{ senders: notification.listSenders() }`.
`batch retry`: `{ retried: await notification.retryBatch(batchId) }` (400 на пустой `batchId`).

- [ ] **Step 2: Контракты**

`src/contracts/notification-template.ts`: `SendNotificationTemplateResponse` → алиас `SendBatchResult` (импорт типа из `@amplicada/platform-core/contracts`).

- [ ] **Step 3: Сборка**

Run: `pnpm --filter @amplicada/platform-core build && pnpm --filter @amplicada/module-admin build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/module-admin/src/backend/routes/notifications.ts packages/module-admin/src/contracts/notification-template.ts
git commit -m "feat(module-admin): switch broadcast to sendMany and add batch retry"
```

---

### Task 14: Админ-роуты — вложения шаблонов (TDD на sanitize)

**Files:**
- Create: `packages/module-admin/src/backend/lib/attachment-key.ts`, `attachment-key.test.ts`
- Modify: `packages/module-admin/src/backend/routes/notifications.ts`

**Interfaces:**
- Consumes: `NOTIFICATION_ATTACHMENT_LIMITS`, `BackendDocumentRuntime`, `BackendStorageService`, `Documents.NOTIFICATION_TEMPLATE`.
- Produces: `buildAttachmentKey(templateId: string, filename: string): string`; `POST /notifications/template-attachments?templateId=…` (multipart, поле `file`) → `{ attachments: NotificationAttachment[] }`; `DELETE /notifications/template-attachments` (JSON `{ templateId, storageKey }`) → `{ attachments: NotificationAttachment[] }`.

- [ ] **Step 1: Падающие тесты** `attachment-key.test.ts`:
  - `'ключ: notification-templates/<id>/<uuid>-<safe-name>'` (regex формы);
  - `'basename: пути ../../x и абсолютные не проходят'`;
  - `'спецсимволы заменяются, пробелы/скобки/дефис сохраняются'`.

- [ ] **Step 2: Убедиться, что падают** (`pnpm --filter @amplicada/module-admin build && pnpm --filter @amplicada/module-admin test`) → FAIL.

- [ ] **Step 3: Реализовать `buildAttachmentKey`**

`basename(filename)`, замена `/[^\w.() -]+/g` на `_`, префикс `randomUUID()`; полный ключ `notification-templates/${templateId}/${safe}`.

- [ ] **Step 4: Реализовать роуты**

POST: `templateId` из query; `runtime.getAnyById(id, type)` → 404; `fixture === true` → 409; `request.file({ limits: { fileSize: maxFileBytes } })` (try/catch → 413); `toBuffer()`; проверка суммы: манифест из `doc.data.core?.base?.attachments` + новый ≤ `maxTotalBytes` (иначе 400); `storage.putObject(key, buffer, { contentType: file.mimetype })`; `runtime.update(type, id, { core: { base: { attachments: next } } })`; при ошибке update — `storage.deleteObject(key)` best-effort и проброс; ответ `{ attachments: next }`.
DELETE: `getAnyById` → 404; найти вложение по `storageKey` (нет → 404); `runtime.update` без вложения; `storage.deleteObject` best-effort (ошибка → warn, не 500); ответ `{ attachments: next }`.

- [ ] **Step 5: Тесты зелёные** (команда Step 2). Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add packages/module-admin/src/backend/lib packages/module-admin/src/backend/routes/notifications.ts
git commit -m "feat(module-admin): template attachment upload and removal"
```

---

### Task 15: Frontend — fixture-бейдж и read-only

**Files:**
- Modify: `packages/module-admin/src/frontend/pages/admin-document-card/ui/admin-document-card.tsx`, `pages/admin-document-list/ui/admin-document-list.tsx`, `src/frontend/locales/{ru,en}.json`

**Interfaces:**
- Consumes: `fixture` из карточки (Task 9) и колонки `core:base:fixture` из списка (Task 8).

- [ ] **Step 1: Карточка**

`DocumentDetail` += `fixture?: boolean`; `const fixture = doc.fixture === true`; в шапке рядом с breadcrumbs — `<Badge variant="outline">{t('admin_doc_fixture_badge')}</Badge>`; `canSave` и кнопка Save: запрет при `fixture` (title `admin_toolbar_fixture_readonly`). Toolbar-действия (отправка) остаются.

- [ ] **Step 2: Список**

В параметр `columns` запросов списка добавлять `core:base:fixture` (если отсутствует) — backend игнорирует неизвестные колонки для типов без поля. В построении `tableColumns`: для ключа `core:base:fixture` — `cell: ({ getValue }) => getValue() ? <Badge variant="outline">{t('admin_list_fixture_badge')}</Badge> : null`. Кнопка удаления строки: `disabled={!deletable || row.original['core:base:fixture'] === true}` + title.

- [ ] **Step 3: Локали** (ru/en): `admin_doc_fixture_badge` («Из кода» / "From code"), `admin_list_fixture_badge`, `admin_toolbar_fixture_readonly`.

- [ ] **Step 4: Сборка** `pnpm --filter @amplicada/module-admin build` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/module-admin/src/frontend
git commit -m "feat(module-admin): fixture badge and read-only guards in UI"
```

---

### Task 16: Frontend — редактор: отправитель и вложения

**Files:**
- Modify: `packages/module-admin/src/frontend/widgets/notification-template-editor/ui/notification-template-editor.tsx`, `src/frontend/locales/{ru,en}.json`

**Interfaces:**
- Consumes: `GET /admin/notifications/senders` (Task 13), attachment-роуты (Task 14), `useDocumentCardContext`, `NOTIFICATION_ATTACHMENT_LIMITS`.

- [ ] **Step 1: Отправитель**

`useQuery(['admin','notifications','senders'])` → `{ senders }`; над табами — select (Base UI `Select`): пустое значение = дефолтный отправитель узла; `onChange({ ...data, sender: value || undefined })`.

- [ ] **Step 2: Вложения**

Секция под табами: список `attachments` (имя, размер) с кнопкой удаления; скрытый `<input type="file">` + кнопка загрузки; `FormData` → `api.post(`/admin/notifications/template-attachments?templateId=${documentId}`, fd)`; DELETE с `{ templateId, storageKey }`; ответ `{ attachments }` → `onChange({ ...data, attachments })`. Заблокировано при `readonly` или `documentId === null` (несохранённый шаблон — подсказка `template_attachments_save_first`). Ошибки — Alert.

- [ ] **Step 3: Локали** (ru/en): `template_editor_sender_label`, `template_editor_sender_default`, `template_editor_attachments_title`, `template_editor_attachment_upload`, `template_editor_attachment_remove`, `template_editor_attachment_error`, `template_attachments_save_first`.

- [ ] **Step 4: Сборка** `pnpm --filter @amplicada/module-admin build` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/module-admin/src/frontend/widgets/notification-template-editor packages/module-admin/src/frontend/locales
git commit -m "feat(module-admin): sender select and attachments in template editor"
```

---

### Task 17: Frontend — рассылка `sendMany` и батч в логе

**Files:**
- Modify: `packages/module-admin/src/frontend/widgets/send-notification-template/ui/send-notification-template.tsx`, `pages/admin-notifications/ui/admin-notifications.tsx`, `src/frontend/locales/{ru,en}.json`

**Interfaces:**
- Consumes: `SendBatchResult` (Task 2), `NotificationDelivery.batchId` (Task 2), batch-retry (Task 13).

- [ ] **Step 1: Рассылка**

Тип ответа — `SendBatchResult`; в результате показывать `total/queued/skipped/failed/deduped`; убрать `SendNotificationTemplateResponse`.

- [ ] **Step 2: Лог**

`DeliveryRow` += `batchId: string | null`; фильтр-поле `batchId` (Input, как kind/userId); колонка «Батч» (укороченный id, title полностью); кнопка «Повторить батч» в строке при `row.batchId && row.status === 'failed'` → `POST /admin/notifications/batch/${row.batchId}/retry`, инвалидация списка.

- [ ] **Step 3: Локали** (ru/en): `admin_notifications_filter_batch`, `admin_notifications_col_batch`, `admin_notifications_retry_batch`, `template_send_result_deduped`.

- [ ] **Step 4: Сборка** `pnpm --filter @amplicada/module-admin build` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/module-admin/src/frontend
git commit -m "feat(module-admin): sendMany result and batch retry in delivery log"
```

---

### Task 18: Документация и заметки (скилл `module-docs`)

**Files:**
- Create: `packages/platform-core/docs/reference/notifications.md`, `ref/notes/platform-core.md`
- Modify: `packages/platform-core/docs/index.md`, `packages/module-notification-email/docs/{index.md,reference/index.md,how-to/enable-smtp.md}`, `packages/module-admin/docs/{index.md,reference/notification-templates.md,reference/index.md}`, `ref/notes/module-notification-email.md`, `ref/notes/module-admin.md`, `ref/context.md`

- [ ] **Step 1: Загрузить скилл `module-docs`** и обновить:
  - core docs: новый `reference/notifications.md` (сервис, контракт v2, шаблоны, фикстуры, лимиты, worker-trade-off) + строка в `docs/index.md`;
  - email docs: `SMTP_SENDERS`, вложения, обновить устаревшее «публичного HTTP-роута отправки нет» в `how-to/enable-smtp.md`, `verified_commit` = текущий;
  - admin docs: `reference/notification-templates.md` — sendMany, вложения, batch-retry, fixture read-only; `docs/index.md`.
- [ ] **Step 2: Заметки разработчиков**
  - `ref/notes/module-notification-email.md`: D-001 — итог по nodemailer (^10 или ^8 после Task 0); новые записи: `SMTP_SENDERS`, лимиты/`headObject`, стрим вложений;
  - `ref/notes/module-admin.md`: D-002 — контракт больше не цикл `send`, а `sendMany`; шаблоны переехали в core;
  - `ref/notes/platform-core.md` (создать): шаблоны-документы в ядре, `fixtureReadonly` opt-in, `sendMany` без eager (trade-off), dedupe на partial unique.
- [ ] **Step 3: `ref/context.md`** — ключевые слова: `sendMany`, `dedupeKey`, `scheduledAt`, `SMTP_SENDERS`, `NOTIFICATION_ATTACHMENT_LIMITS`, `fixtureReadonly`, `core.notification_template`, batch retry.
- [ ] **Step 4: Commit**

```bash
git add packages/*/docs ref/notes ref/context.md
git commit -m "docs(notifications): document contract v2, senders and attachments"
```

---

### Task 19: Живой прогон Mailpit и финализация PR

**Files:**
- Create: `/tmp/opencode/live-notify.ts`, `/tmp/opencode/notify-smoke.mjs` (вне рабочего дерева)
- Modify: `ref/plans/2026-09-17-notification-contract-v2.md`, `ref/plans/2026-09-30-notification-v2-implementation.md`, `ref/README.md`

**Interfaces:**
- Consumes: всё выше; `createApp`/`bootstrap` из `@amplicada/platform-core/backend`; `ref/guides/playwright-sandbox.md`.

- [ ] **Step 1: Инфра и стеки**

```bash
pnpm infra:up && pnpm dev   # web :5173, api :3000; ROLE по умолчанию all — диспетчер запущен
```

- [ ] **Step 2: Playwright-смоук (headless)**

Скрипт по гайду: логин `admin`/`admin`; открыть `/admin`, карточку пользователя `admin`, выставить email в карточке (сохранение = `verified_at`); создать шаблон `notification-template` с `{{login}}` в subject/body, загрузить вложение через редактор, сохранить; запустить «Отправить» с получателем admin; проверить страницу `/admin/notifications`: `queued`/`sent`, `batchId`.
Проверить Mailpit через API: `GET http://127.0.0.1:8025/api/v1/messages` — письмо с подставленным логином, вложением и нужным `from`; `GET /api/v1/message/{ID}` — заголовки.
Скриншоты и скрипт — в `/tmp/opencode/`.

- [ ] **Step 3: Live-драйвер для dedupe/scheduledAt/cc/replyTo**

`/tmp/opencode/live-notify.ts`: `createApp()` → `bootstrap(app, modules, context)` (модули из `apps/api/src/generated/backend-modules.js`), резолв сервиса `notification`, от имени admin-пользователя:
- `send({ dedupeKey: 'live-1' })` дважды → второй вызов возвращает тот же id, в Mailpit одно письмо;
- `send({ scheduledAt: now + 60s })` → строка `pending`, письма нет; `dispatchDue()` после истечения (или прямое `deliver`) → доставка;
- `send({ cc: [...], replyTo: '...' , headers })` → заголовки видны в Mailpit API.
Запуск: `node --env-file=.env.host.example --import tsx /tmp/opencode/live-notify.ts`, в конце `await app.close()`.

- [ ] **Step 4: Batch-retry живьём**

Временно остановить Mailpit (`docker compose -f docker-compose.infra.yaml stop mailpit`), отправить шаблон → строки `failed` после попыток; поднять Mailpit; «Повторить батч» из UI → строки `sent`.

- [ ] **Step 5: Гейты**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm lint`
Expected: всё зелёное.

- [ ] **Step 6: Статусы и карты**

`ref/plans/2026-09-17-notification-contract-v2.md` → `status: implemented`; этот план → `implemented`; `ref/README.md` — обновить строки. Commit:

```bash
git add ref && git commit -m "docs(notifications): mark v2 plan implemented after live run"
```

- [ ] **Step 7: PR**

Обновить тело PR #3 (контракт v2, что проверено живьём, ломающие изменения БД), затем:

```bash
git push --force-with-lease origin feat/notifications
gh pr edit 3 --body-file /tmp/opencode/pr-body.md
gh pr ready 3
```

- [ ] **Step 8: Вернуть dev рабочим** (AGENTS.md): поднять `pnpm dev` и оставить запущенным.

---

## Self-Review (выполнен при написании)

- **Покрытие спеки:** все пункты спеки имеют задачу: контракт — T2, данные/миграция — T4/T8, поведение — T5–T7, fixtures/read-only — T9/T15, email — T11/T12, админка — T13/T14/T16/T17, docs — T18, живой прогон — T19; фаза 0 (синк/pnpm/D-001) — T0; ADR-07 — T1.
- **Review Focus:** пять классов закрыты тестами T3 (escape/missing), T5 (локаль), T6 (dedupe/scheduledAt), T12 (вложения); live-дубли — T19.
- **Типы согласованы:** `SendBatchResult`, `NotificationAttachment`, `NOTIFICATION_ATTACHMENT_LIMITS`, `Documents.NOTIFICATION_TEMPLATE`, `fixtureReadonly` используются одинаково во всех задачах.
- **Осознанный размен:** blanket-guard заменён на `fixtureReadonly` (заметка в спеке и ADR-07, T1).
