---
title: Document Data Architecture
type: plan
tier: 4
status: in-progress
date: 2026-07-23
source: session/2026-07-23-document-data-architecture
note: Все шаги 1-9 порядка реализации — готово в коде (typecheck+biome чисты). Осталось только hooks/events (шаг 10, отложено). Миграции platform-core 0008-0011, module-hr-request 0002. НЕ прогонялось против реальной БД — bootstrap-ордер, reconcile-SQL, fixture stale-логика и soft-delete требуют smoke-теста на Postgres перед доверием. Кроме того: soft-delete у identity_user закрывает login, но не активные сессии (ок для dev); undelete-UI отложен.
---

# Document Data Architecture — Plan

## Проблема

Сейчас `DocumentRuntime` — generic-слой для админки (всё `Record<string, unknown>`). Для кода (background jobs, интеграции, сервисы, workflow) нужна удобная работа с документами: поиск по ID без типа, типизированный доступ к данным extension'ов, soft-delete, и в перспективе — event-модель и хуки жизненного цикла.

## Сделано (prerequisite hardening)

До index/soft-delete в `DocumentRuntime` (`packages/platform-core/src/backend/services/document-runtime.ts`) уже были две проблемы, на которых иначе строилась бы вся модель:

- **`delete()`/`bulkDelete()` были нетранзакционными и не чистили extension-строки** — удалялась только base row, extension-таблицы становились сиротами. Исправлено: оба метода теперь в транзакции, вызывают новый `deleteExtensionData()` (bulk `DELETE ... WHERE id IN (...)` по schema, либо кастомный `ext.remove` для нестандартных extension'ов). В `DocumentExtension` (`contracts/documents.ts`) добавлено поле `remove?`, симметричное `load`/`save`.
- **`getById()` читал base row + extension'ы N отдельными запросами без снапшота** — конкурентный `update()` между ними мог дать рваное чтение. Исправлено: обёрнут в `db.transaction(..., { isolationLevel: 'repeatable read', accessMode: 'read only' })`, по тому же паттерну, что уже был в `streamExportBatches`.
- **Не сделано, сознательно отложено:** `exportData()` (не потоковая версия) имеет тот же N+1/no-snapshot паттерн, что был у `getById` — не тронута.

## Модель

```
DocumentRuntime (ядро)
  ├── getAnyById(id, type?) — чтение, единый метод, type — опциональный fast-path
  ├── create/update/delete — запись (транзакция: базовая таблица + все extension'ы)
  ├── document_index — lookup-таблица (id → type), indexCreated/indexRemoved — низкоуровневый API
  ├── reconcileFixtures — code-defined документы, pinned uuid, upsert по known id + stale-маркировка
  ├── хуки (pre/post create/update/delete)
  └── event bus (document.created/updated/deleted)

Extension (модуль)
  ├── schema (Drizzle) → авто load/save
  ├── custom load/save — для нестандартной логики
  └── contracts/ — типы данных + typed key для consumer'ов
```

## Компоненты

### 1. Document Index (lookup-таблица)

```sql
CREATE TABLE core.document_index (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at  timestamp with time zone,
  stale       boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_document_index_active ON core.document_index (id) WHERE deleted_at IS NULL;
CREATE INDEX idx_document_index_stale ON core.document_index (type) WHERE stale;
```

- Пишется в `DocumentRuntime.create/delete/bulkDelete/importData` (+ явные вызовы `indexCreated`/`indexRemoved` из точек, что обходят эти методы — см. "Аудит и решения")
- Единый метод чтения: `getAnyById(id: string, type?: string): Promise<DocumentObject | null>`. Если `type` передан — пропускает lookup в index и читает сразу (это и есть бывший `getById(type, id)`); если не передан — резолвит тип через `SELECT type FROM document_index WHERE id = id AND deleted_at IS NULL`, дальше идентичная логика. Один метод вместо двух, без дублирования REPEATABLE READ + загрузки extension'ов.
- **`stale`** — не горячий путь чтения, в отличие от `deleted_at`; нужен только для редкого ops-lookup'а "какие fixture-документы (компонент 7) больше не объявлены в коде". Поэтому живёт только в `document_index`, не дублируется в базовые таблицы (в отличие от `deleted_at` — см. компонент 2, там дублирование оправдано горячим путём чтения). Пишется из generic `reconcileFixtures` (компонент 7); для не-fixture документов всегда `false`.
- Возвращает чистый `DocumentObject` (`{ id, type, data }`, см. компонент 3) — без `pages`. UI-метаданные (`pages`/`groups`/`component` для формы) — не забота этого метода, см. ниже.

**`pages` выносится из generic-чтения в admin-слой.** Сегодня `getById(type, id)` попутно возвращает `pages` через `buildEnrichedPages(type)` ([document-runtime.ts:353](packages/platform-core/src/backend/services/document-runtime.ts#L353)) — это чистые admin UI-метаданные (какой компонент рендерить, какие поля показывать), зависящие только от `type`, не от конкретного документа, и пересчитываемые заново на каждый вызов. Есть отдельный `getRegistryMeta(type)` ([document-runtime.ts:652-657](packages/platform-core/src/backend/services/document-runtime.ts#L652-L657)), который уже возвращает `{ type, pages }` — синхронно, без обращения к БД. Единственный вызывающий `getById` сегодня — `module-admin/routes/documents.ts:15` (для `admin-document-card.tsx`). Решение: роут вместо `runtime.getById(type, id)` делает `runtime.getAnyById(id, type)` + `runtime.getRegistryMeta(type)` и мержит перед ответом клиенту (`{ ...doc, pages: meta.pages }`) — бесплатно, `getRegistryMeta` не ходит в БД.

**Проблема с этим списком точек записи — см. "Аудит и решения" ниже: минимум два document-типа создаются в обход всех четырёх методов.**

### 2. Soft Delete — реализовано

- `deleted_at` — **не на каждой таблице, а только у deletable-типов**. Уточнение по ходу реализации: из 6 типов `deletable: false` у трёх (`scheduled-task`, `workflow`, `workflow-process`) — их `delete()` кидает 403 раньше soft-логики, колонка была бы мёртвым грузом. Колонка добавлена только `identity_user`, `user_groups`, `hr_request_types` (+ `document_index`).
- **Soft-delete условен по наличию колонки.** `DocumentRuntime` проверяет `getTableColumns(schema).deletedAt`: есть → `delete()` = `UPDATE SET deleted_at = NOW()` (base + `document_index`), extension-данные не трогаются (документ восстановим). Нет → `delete()` = hard (каскад extension + base + `indexRemoved`), как раньше. Это делает soft-delete opt-in через схему и robust к "свободе вне документов".
- `restore()` → `UPDATE SET deleted_at = NULL` (base + index); 400, если тип не поддерживает soft-delete.
- `hardDelete()` → физическое удаление (каскад + base + index), в обход soft; работает и для soft-deleted, и для активных строк.
- Read-методы фильтруют `WHERE deleted_at IS NULL` условно (по наличию колонки): `list` (data+count), `getAnyById` (base row; type-omitted путь ещё и `document_index`), `exportData`, `streamExportBatches`. `importData` existing-row lookup — тоже (soft-deleted строка не "воскресает" через update; если физически есть — insert упадёт на PK, ошибка в `errors[]`).
- Partial index `WHERE deleted_at IS NULL` на каждой из 3 таблиц + `document_index`.
- **Auth-интеграция для `identity_user`:** soft-deleted пользователь не может залогиниться — `PasswordAuthProvider` (`module-auth-password/services/plugin.ts`) фильтрует `deleted_at IS NULL` в login-запросе и `findUserIdByLogin`. Инвалидация активных сессий **не** сделана (приемлемо для dev; для prod — отдельная задача вместе с access-control).
- **Отложено (не в этой итерации):** undelete-UI в админке. Backend-методы `restore`/`hardDelete` есть, но роутов/кнопок нет — admin "delete" теперь soft, документ просто исчезает из списка (фильтр), восстановление пока только программно.

### 3. Plain JSON Document Object

**Решение:** документ — это POJO (JSON-serializable), без методов, без классов.

```ts
interface DocumentObject {
  id: string;
  type: string;
  data: Record<string, Record<string, unknown>>;
}
```

Причины:
- Можно передавать в Redis, очередь, другой процесс — без сюрпризов
- Легко замокать в тестах — просто JSON
- Никакого скрытого состояния

### 4. Typed Access через DocumentRuntime

Модули экспортируют typed key для своих extension-данных:

```ts
// module-hr/contracts
export type HrUserData = { code: string; lastName: string; firstName: string };
export const hrKey = { key: 'module-hr' as const, _type: null! as HrUserData };
```

Типизированный доступ — свободная функция в `contracts/documents.ts`, **не метод `BackendDocumentRuntime`**:

```ts
// platform-core/contracts — без зависимости от БД, доступна в любом процессе
type NamespaceKey<T> = { key: string; _type: T };

export function extract<T>(doc: DocumentObject, ns: NamespaceKey<T>): T | undefined {
  return doc.data[ns.key] as T | undefined;
}

interface BackendDocumentRuntime {
  getAnyById(id: string, type?: string): Promise<DocumentObject | null>;
}

// Использование:
const doc = await docRuntime.getAnyById(id);
const hr = extract(doc, hrKey); // HrUserData | undefined
```

`extract` — просто приведение типа, никакой магии в рантайме. Решено сделать её свободной функцией, а не методом рантайма: `extract` не делает I/O и не нуждается в `this`, а привязка к `BackendDocumentRuntime` заставила бы любой потребитель POJO (например, воркер, получивший `DocumentObject` из очереди без живого подключения к БД) тащить с собой рантайм ради чистого приведения типа — это подрывает саму причину выбрать POJO ("можно передать в другой процесс").

**`TypedDocument` класс — решено не вводить.** Он не даёт ничего, чего не даёт `extract()`: обе версии — непроверяемый каст, разница только в синтаксисе (`doc.get(key)` vs `extract(doc, key)`). Цена класса выше нуля: если инстанс `TypedDocument` случайно уедет в сериализацию (Redis/очередь/лог) — на другом конце окажется обычный объект без методов, то есть один и тот же документ будет иметь разную форму в зависимости от того, прошёл ли он через сериализацию. Ровно то, от чего отказался раздел 3.

### 5. Hooks / Events (будущее)

```ts
interface DocumentLifecycleHooks {
  beforeCreate?(type: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  afterCreate?(type: string, id: string, body: Record<string, unknown>): Promise<void>;
  beforeUpdate?(type: string, id: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  afterUpdate?(type: string, id: string, body: Record<string, unknown>): Promise<void>;
  beforeDelete?(type: string, id: string): Promise<void>;
  afterDelete?(type: string, id: string): Promise<void>;
}
```

- Хуки могут регистрировать любые модули
- Event bus (уже есть, но не используется DocumentRuntime) — `document.created`, `document.updated`, `document.deleted`
- Интеграции подписываются на события

### 6. Свобода вне документов

DocumentRuntime не претендует на все данные. Модули могут иметь свои таблицы вне document-системы. Если таблицу нужно показать в админке или привязать к документу — регистрируется extension с custom load/save.

### 7. Document Fixtures (reconcile-as-code) — реализовано, унифицировано

Обобщение паттерна `TaskRegistryImpl.reconcile()` в generic-механизм `DocumentRuntime.reconcileFixtures()`.

**Мотивация:** документы, от которых зависит бизнес-логика, существуют одинаково во всех контурах (dev/staging/prod) без экспорта данных — определяются в коде, восстанавливаются при каждом бутстрапе (CI/CD).

**Унификация двух кейсов (решение по ходу реализации).** Исходно план описывал только pinned-uuid fixtures. При реализации выяснилось, что `scheduled-task` — единственный реальный кандидат на миграцию — не вписывается в pinned-uuid модель (у него natural key `code` + авто-uuid id, а не литерал). Поэтому `FixtureKey` — union двух режимов:

```ts
export type FixtureKey = { id: string } | { column: string; value: string };

docs.fixtures.register({ type, key, values });
```

- **`{ id: pinnedUuid }`** — pinned uuid-литерал (System Admins group и т.п.): один и тот же id в любом окружении, другие таблицы/миграции могут хардкодить FK на него. `code` в этом кейсе не нужен для идентичности — orthogonal метка.
- **`{ column: 'code', value }`** — natural key (scheduled-task): upsert по `code`, id базовой таблицы авто-генерируется (uuid).

API — `docs.fixtures.register(def)` (отдельный суб-реестр рядом с `objects`/`lists`/`dashboard`), **не** `docs.objects.registerFixture` как в исходном наброске (fixtures — про данные, не про UI-структуру).

**reconcile (`DocumentRuntime.reconcileFixtures`):**
- Upsert: `INSERT ... ON CONFLICT (keyCol) DO UPDATE SET values` RETURNING id. `values` (code-owned) пишутся и при insert, и при update; `stale`/`updatedAt` базовой таблицы (если колонки есть — условно) сбрасываются/обновляются; user-owned колонки получают дефолты только при первом insert.
- Пометка в `document_index` через `indexCreated(type, id, db, { fixture: true })` — ставит `fixture=true`, `stale=false`.
- `stale`, не `delete` — fixture-строки, которых больше нет в коде, помечаются `document_index.stale = true` (+ базовая `stale`, если колонка есть). Скоуп через `document_index.fixture=true`, чтобы не задеть юзерские строки того же типа. Обрабатывает и случай "все fixture типа исчезли".
- Обходит `creatable`/`deletable`-гварды.

**`document_index.fixture`** (миграция `0011`) — boolean-маркер fixture-строк для scoping stale-маркировки.

**`TaskRegistryImpl.reconcile()` удалён.** Bootstrap (`app.ts`) транслирует `taskRegistry.getRegistrations()` → `docs.fixtures.register({ type: SCHEDULED_TASK, key: { column: 'code', value }, values: { description } })` и зовёт `reconcileFixtures`. Порядок бутстрапа: core-миграции → module-миграции → регистрация task-fixtures → `reconcileFixtures`.

> **Устарело в этой части (2026-08-06):** шага `backfillIndex` между миграциями и task-fixtures больше нет. `document_index` стал первичной таблицей (базовые таблицы ссылаются на него FK), поэтому строка без lookup-записи невозможна, а разовый бэкфилл переехал в миграции — по одной на модуль. См. [`plans/2026-08-05-document-model/06-index-primary.md`](./2026-08-05-document-model/06-index-primary.md).

## Слои

| Слой | Отвечает | Типизация |
|------|----------|-----------|
| **DocumentRuntime** | Generic CRUD, index, soft-delete, хуки | `Record<string, unknown>` |
| **Extension** (модуль) | Своя Drizzle-схема или load/save | `$inferSelect` или кастомный тип |
| **Consumer** (код) | Работа с конкретным документом | Через typed key из модуля |
| **Вне документов** | Всё, что не влезает в модель | Без ограничений |

## Аудит и решения

Всплыли при аудите текущего кода перед реализацией `document_index`. Не гипотетические — у каждого пункта есть конкретный существующий пример. Все пункты ниже — уже решены; открытых вопросов на данный момент не осталось.

### Точки записи base-строки — их больше, чем предполагалось

Аудит `.insert(...)` по каждой из 6 зарегистрированных document-схем (`identityUser`, `userGroups`, `scheduledTasks`, `workflows`, `processInstances`, `hrRequestTypes`) показал:

| Тип | id-схема | Обход `DocumentRuntime` |
|---|---|---|
| user, user-group, workflow, hr-request-type | `uuid().defaultRandom()` | не найден |
| **scheduled-task** | `varchar(255)`, значение — имя задачи из кода | `task-registry.ts:32`, `TaskRegistryImpl.reconcile()` — прямой `db.insert(scheduledTasks).onConflictDoUpdate(...)` при бутстрапе |
| **workflow-process** | `uuid().defaultRandom()` | `engine.ts:134`, `WorkflowEngine.startProcess()` — прямой insert, тип зарегистрирован с `creatable: false` |

Оба обхода — не баги, а осознанный дизайн: создание этих документов требует бизнес-логики за пределами generic CRUD (движок процессов, реконсиляция задач из кода), поэтому `creatable: false` у обоих типов. Значит план "index пишется в `create/delete/bulkDelete/importData`" неполон по построению — эти два типа никогда не пройдут через эти методы.

Дополнительно у `scheduled-task` (`scheduled-task.ts:24-70`) — `update()` не трогает base-таблицу напрямую вообще, только extension'ы; base-поля редактируются через self-referential `module: 'core'` extension, чей `save()` намеренно не включает `description`/`stale` (эти два поля — во владении кода/`reconcile()`, а не админки).

**Вывод:** нужен отдельный низкоуровневый метод (`DocumentRuntime.indexCreated(type, id)` / `indexRemoved(type, id)` — рабочее название), который пишет **только** в `document_index`, без `creatable`/`deletable`-гвардов admin-API. `create()`/`delete()`/`bulkDelete()`/`importData()` вызывают его изнутри как раньше; `task-registry.reconcile()` и `WorkflowEngine.startProcess()` вызывают его явно сразу после своего прямого insert/delete. Разводит два смешанных сейчас слоя: персистентность+индекс (нужен всем) vs авторизация admin-API (нужна только HTTP-слою).

### id — решено: uuid форсируется везде, fixture'ы используют pinned-литерал

Вероятность коллизии UUIDv4 — функция энтропии (122 случайных бита), не координации между вызовами; централизация генератора (`crypto.randomUUID()` в коде вместо `defaultRandom()` на схеме) коллизии не снижает. Не в этом был реальный вопрос.

**Решение:** тип колонки `id` — uuid без исключений, во всех document-таблицах. Различается только то, кто генерирует значение:
- обычные документы — `defaultRandom()`/рантаймовый `crypto.randomUUID()`, opaque, разный между контурами — это нормально, на такие id никто не ссылается по хардкоду;
- **fixture-документы** (компонент 7) — explicit uuid-литерал, зафиксированный в коде автором один раз; одинаков в любом окружении, потому что это константа, а не рантайм-генерация.

Апсерт по `code` как механизм кросс-контурной идентичности **отвергнут**: если id резолвится только через `code`, у одного и того же логического объекта в разных контурах будет разный физический uuid, и другие таблицы/миграции не смогут захардкодить FK на него напрямую. Апсерт вместо этого идёт по pinned id (`ON CONFLICT (id)`), как в компоненте 7.

**`scheduled-task` — реализовано (миграция `0008_scheduled_task_code_uuid_id.sql`).** `id` (varchar, имя задачи) переименован в `code`, добавлена новая `id uuid default gen_random_uuid()` как единственный внешний идентификатор — без исключений из общего правила.

Ловушка, которая по пути чуть не привела к откату uuid для этого типа: человекочитаемый id задачи — не просто метка, а ключ адресации внутри task-движка — Redis-лок (`TaskLock.acquire`), in-memory Map джобов в `TaskScheduler`, Redis pub/sub каналы (`RUN_NOW_CHANNEL`/`CANCEL_RUN_CHANNEL`), `TaskRegistryImpl.getRegistration()`. Отдельный (не generic-документный) admin-роут `/admin/tasks/:id` + фронтенд `AdminTaskDetail` получает `id` из generic-списка документов (uuid) и подставляет его в URL этого выделенного роута — значит роуты `/admin/tasks/*` тоже должны принимать uuid, а не `code`.

**Решение — не отказ от uuid, а разведение внешнего/внутреннего адреса:** снаружи (URL, generic document system, все `/admin/tasks/*` роуты, `document_index`) — везде uuid `id`, без исключений. `code` — чисто внутренняя деталь task-движка, никогда не светится как URL-параметр. Роуты, которым для локов/redis/registry нужен `code` (`GET /tasks/:id/runs`, `POST /tasks/:id/run`), сначала резолвят `code` по uuid одним `SELECT`, и только потом обращаются к движку. `PATCH /tasks/:id` и `GET /tasks` вообще не касаются `code` — работают чисто по uuid.

Итого изменено: `scheduled-tasks.ts`/`scheduled-task-runs.ts` (схемы), `task-registry.ts`, `task-scheduler.ts`, `task-runner.ts`, `task-reconciler.ts` (все внутренние операции — по `code`), `module-admin/routes/tasks.ts` (внешний контракт — uuid, с точечным резолвом в 2 роутах), `documents/scheduled-task.ts` (добавлено поле `code` в admin-форму/список — `id` теперь uuid, малоинформативен для человека).

### Решено в этом раунде

- **`TypedDocument` класс** — убран, см. компонент 4 (`extract` — свободная функция вместо метода/класса).

- **Уникальность `module` в рамках одного document-типа — форсируем на регистрации.** `DocumentObjectRegistry.extend()` должен кидать исключение сразу, если для `(docType, module)` уже зарегистрирован extension. Это регистрация на этапе `setup()` модулей, то есть падение происходит **при старте сервера**, а не в рантайме на случайном запросе — конфликт увидят сразу, при деплое, а не потом на проде при попытке молча перезаписать чужие данные в `data[ext.module]`.

- **Критерий "extension vs таблица вне документов" — уточнён, не только 1:1 vs 1:many.** Правило по `save`/write-стороне остаётся строгим: extension с `schema`/`save` — всегда 1:1 upsert. Но `load` — это отдельная ось: кастомный `load` может проецировать 1:many join для **чтения** (уже так сделано в `user-group.ts` — `core-members` extension без `schema`/`save`, только `load`, джойнящий `group_users` и возвращающий `{ members: [...] }` для отображения). То есть: 1:many данные *можно* показывать через extension (read-only projection), но *владеть* ими (создавать/удалять свои строки) через extension-механизм нельзя — сущности с собственным independent CRUD (вложения, комментарии) живут вне document-системы своей таблицей и своим API.

- **Композиция hooks и payload события — отложены вместе.** Обе относятся к компоненту 5 (Hooks/Events), который и так последний в очереди ("будущее"). Решать порядок/склейку hooks и форму payload (`changedModules` и т.п.) есть смысл только когда появится первый реальный consumer — раньше это гадание вслепую.

- **Реюз id при hard delete + `importData` — принимаем риск, не проектируем защиту сейчас.** `hardDelete()` — опциональная, редко используемая операция; коллизия требует, чтобы кто-то *намеренно* подсунул в `importData` id, совпадающий с ранее hard-deleted документом (не случайная коллизия — та же uuid-энтропия, что и везде). Blast radius мал, специальная защита не оправдана. Единственное, что стоит сделать отдельно и по факту не связано с hard delete: как только появится soft-delete, проверка "запись уже существует" в `importData` (`tx.select(...).from(doc.schema).where(eq(idCol, itemId))`) должна фильтровать `WHERE deleted_at IS NULL` — иначе импорт с id, совпадающим с soft-deleted документом, молча его "воскресит" в обход `restore()`.

- **Backfill `document_index` — не миграция, а часть generic bootstrap-реконсиляции.** `document_index` живёт в `platform-core`, а бэкфиллить нужно из таблиц модулей (`workflows`, `hr_request_types` и т.д.) — а порядок бутстрапа "core migrations → module migrations" не гарантирует, что таблицы модулей уже существуют в момент миграций `platform-core`. Поэтому backfill — не SQL-миграция, а код, который выполняется **после всех миграций**, использует `docs.getAll()` (реестр уже знает все зарегистрированные типы + их `schema`/`idColumn`) и для каждого типа делает `INSERT INTO document_index (id, type) SELECT id, :type FROM <schema> ON CONFLICT (id) DO NOTHING`. Идемпотентно, можно гонять при каждом старте (после первого раза — no-op), новые типы документов бэкфиллятся автоматически без отдельной миграции под каждый. По сути та же "reconcile-at-bootstrap" механика, что и в компоненте 7 — общий паттерн для этого плана, не совпадение.

## Порядок реализации (предварительный)

1. `scheduled-task`: rename `id`→`code`, новая uuid `id` — **готово** (миграция `0008_scheduled_task_code_uuid_id.sql`, uuid снаружи everywhere, `code` — внутренняя деталь task-движка, см. компонент "id — решено")
2. `DocumentRuntime.indexCreated`/`indexRemoved` — низкоуровневый API индекса, отделённый от `creatable`/`deletable`-гвардов (см. "Аудит и решения") — **готово**
3. `document_index` — таблица (`id uuid` без исключений — см. компонент "id — решено") + запись из create/delete/bulkDelete/importData + явные вызовы из `task-registry.reconcile()` и `WorkflowEngine.startProcess()` + `getAnyById` (type-omitted путь через lookup) + generic bootstrap-backfill по `docs.getAll()` (не миграция, см. "Аудит и решения") — **готово** (миграция `0009_create_document_index.sql`)
4. `deleted_at` — в базовые таблицы и index — **готово** (миграции `0010_soft_delete_columns.sql` в platform-core + `0002_soft_delete_request_types.sql` в module-hr-request; только для deletable-типов: `identity_user`, `user_groups`, `hr_request_types` — см. ниже)
5. Soft delete в DocumentRuntime (delete → UPDATE, restore, hardDelete); read-методы (`list`/`getAnyById`/`export`) и `importData` existing-row lookup — фильтр `WHERE deleted_at IS NULL` — **готово** (условно по наличию колонки `deletedAt` — типы без неё живут hard-delete'ом)
6. Document Fixtures (компонент 7) — `docs.fixtures.register`, generic `reconcileFixtures` (unified pinned-id | natural-key), `document_index.fixture`+`stale`; `task-registry.reconcile()` удалён, bootstrap транслирует задачи в fixtures — **готово** (миграция `0011_document_index_fixture.sql`)
7. Typed keys — контракты модулей + `extract()` как свободная функция (без `TypedDocument`, см. компонент 4) — **готово**
8. Assert на уникальность `(docType, module)` в `DocumentObjectRegistry.extend()` — падает при старте — **готово**
9. Слияние `getById`/`getAnyById` в единый `getAnyById(id, type?)`, `pages` — забота admin-роута — **готово** (type-provided путь; type-omitted — см. шаг 3)
10. Hooks / Event bus — жизненный цикл, порядок композиции и payload события проектируются по факту первого consumer'а

## Отложено

- `updated_at` — нужен, но требует детального проектирования partial-update extension'ов
- Partial-update — обновлять только extension'ы, чьи данные изменились
- `undelete` в админке (UI)
- Access control на уровне документа
- `exportData()` (не потоковая версия) — тот же N+1/no-snapshot паттерн, что был у `getById` до фикса; не тронута, см. "Сделано"
