---
title: document_index как первичная таблица документов
type: plan
tier: 4
status: implemented
date: 2026-08-05
source: session/2026-08-05-document-index-primary
size: L
depends-on: [01, 02, 03, 04]
note: >-
  Все три этапа реализованы 2026-08-06: (1) индекс первичен, (2) deletedAt и stale только в индексе,
  (3) schema вон из register(). Принято: FK-целостность БЕЗ автокаскада (удаление остаётся ручным в
  коде); типизация межтиповых ссылок для table-less типов сознательно не обеспечивается.
  Против реальной БД не прогонялось — см. entry этапа 3.
---

# 06 — document_index как первичная таблица документов

## Три этапа, порядок жёсткий

1. ✅ **Индекс первичен** — id рождается в `document_index`, базовые таблицы ссылаются на него FK.
   Реализовано 2026-08-06, см. entry.
2. ✅ **`deletedAt` и `stale` только в индексе** — иначе на этапе 3 состояние документа читать неоткуда.
   Реализовано 2026-08-06, там же.
3. ✅ **`schema` вон из `docs.register()`** — таблица типа становится обычным extension'ом.
   Реализовано 2026-08-06, см. entry.

Это не три независимые задачи: 3 невозможен без 2, 2 бессмыслен без 1. Ниже этап 1 расписан подробно,
2 и 3 — по составу работ.

**`depends-on` в шапке — мягкая зависимость.** Пункты 01–05 не блокируют этот план технически; но это
миграции на 19 таблиц в пяти пакетах, и вести их поверх рантайма с известными дефектами значит
отлаживать две вещи разом. См. [00-overview](./00-overview.md).

## Сейчас

`document_index` — вторичный lookup. Id рождается в базовой таблице типа (`uuid DEFAULT gen_random_uuid()`),
а строка индекса дописывается следом вызовом `indexCreated(type, id)`. Порядок: `INSERT base` → `indexCreated`.

Целевая иерархия: `document_index` → `<базовая таблица типа>` → extension-таблицы. Id рождается в индексе,
базовая таблица ссылается на него внешним ключом.

## Зачем

1. **Ссылки «на документ» сегодня ничем не защищены.** `hr_*_version.source_document_id` — `uuid` без FK,
   `core.document_access.doc_id` — `varchar(255)` без FK. Указывать не на что: нет единой таблицы всех
   документов. С первичным индексом любая такая колонка становится настоящим `REFERENCES document_index(id)`.
   Это главная ценность; остальное — следствия.

2. **Индексация держится на дисциплине вызова, и дисциплина уже дырявая.** `HrStructureService` вставляет
   node напрямую в пяти методах (`createDepartment`/`createCostCenter`/`createLegalEntity`/`createStaffUnit`/
   `createVirtualTeam`, [hr-structure-service.ts:259](../../../packages/module-hr/src/backend/services/hr-structure-service.ts#L259))
   и `indexCreated` не зовёт. **Сегодня это не баг** — у этих методов ноль вызывающих, карточка идёт через
   generic `create()`. Но сервис экспортируется как `HR_STRUCTURE_SERVICE_TOKEN` ровно для внешних
   потребителей, и первый же из них создаст документ, которого нет в индексе: не найдётся по id, не сможет
   иметь custom fields (там FK), и «починится» сам на следующем бутстрапе через `backfillIndex()`. Схема
   закрывает этот класс ошибок структурно — вставка без lookup-строки станет невозможной.

3. **`backfillIndex()` исчезает** — единственное место с сырым SQL и именами таблиц
   (`document-runtime.ts`, ~20 строк + хелпер `qualifiedName`).

4. **Глобальная уникальность id** перестаёт зависеть от того, что все типы используют uuid v4. Сейчас
   `document_index.id` — `text`, и тип с натуральным/числовым ключом дал бы коллизию между типами.

## Принятые развилки

- **Каскада нет.** `base.id REFERENCES core.document_index(id)` без `ON DELETE` (поведение по умолчанию —
  `NO ACTION`). Удаление остаётся ручным в коде. Причина: в одном только module-hr 34 внешних ключа и ни
  одного с `ON DELETE`; полный каскад потребовал бы решения по каждому, причём для самоссылок иерархии
  (`parent_node_id`) cascade заведомо неверен. Существующий порядок в `hardDelete`/`deleteMany`
  (extension → base → index) уже снизу вверх, то есть с `NO ACTION` работает как есть — **менять не нужно**.
- **soft-delete на этапе 1 не трогаем**, но и «отдельной задачей» он больше не является: без него не
  поедет этап 3, поэтому он стал этапом 2 (см. ниже).
- **Типизация межтиповых ссылок для table-less типов не обеспечивается.** FK вида
  `hr_staff_unit_node.department_node_id → hr_department_node(id)` сегодня физически не даёт положить туда
  id опроса. Для типа, у которого своей таблицы нет вообще (данные целиком в `customFields`), единственной
  целью ссылки остаётся `document_index(id)`, где лежат документы всех типов, — и БД перепутанный тип не
  поймает. Принято сознательно: гарантия переезжает в код. Обходной путь (составной уникальный ключ
  `(id, type)` в индексе + генерируемая колонка с зашитым типом в ссылающейся таблице) существует, но
  как основной не закладывается.
  **Важно:** это НЕ цена этапа 3. Отказ от `schema` в `register()` таблицы не удаляет — они остаются как
  schema обычных extension'ов, поэтому у всех 19 существующих типов входящие FK и `UNIQUE` сохраняются
  без изменений. Ограничение касается только нового стиля типов — без собственной таблицы.

## Изменения

### 1. Типы колонок (обязательное условие FK)

`document_index.id` сейчас `text`, все 19 базовых таблиц — `uuid` (проверено: department/cost-center/
legal-entity/staff-unit/virtual-team/job-family/position-grade/position-template/role/tag/work-schedule,
poll, poll-response, request-type, workflow, process-instance, user, user-group, scheduled-task). Для FK
типы обязаны совпадать:

- `core.document_index.id`: `text` → `uuid`, с `DEFAULT gen_random_uuid()` (раньше дефолта не было — id
  всегда приходил снаружи).
- `core.document_custom_fields.doc_id`: `text` → `uuid` (у неё уже есть FK на индекс — его придётся снять
  и пересоздать вокруг смены типа).

### 2. Где живут миграции — в модулях, не в core

FK на таблицах модуля обязан объявляться в миграции этого модуля: core-миграции применяются раньше, чем
таблицы модулей вообще существуют (ровно та причина, по которой `backfillIndex()` был вынесен в bootstrap).
Каждая модульная миграция делает два шага для своих типов:

```sql
INSERT INTO "core"."document_index" ("id", "type")
SELECT "id", '<doc-type>' FROM "<schema>"."<table>" ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "<schema>"."<table>"
  ADD CONSTRAINT "<table>_id_document_fk" FOREIGN KEY ("id") REFERENCES "core"."document_index"("id");
```

Разбивка по пакетам: platform-core — 3 типа (user, user-group, scheduled-task), module-hr — 11,
module-hr-poll — 2, module-hr-request — 1, module-workflow — 2.

Порядок внутри core-миграции важен: смена типа `document_index.id` на `uuid` должна пройти **до** того, как
модульные миграции начнут вешать FK. Bootstrap уже гарантирует core → модули.

Сид админа и группы Administrators в `0000_init.sql` вставляет строки напрямую в `identity_user`/`user_groups`
— в уже существующих БД они подхватятся backfill-шагом core-миграции; в новых `0000_init.sql` должен
дополнительно завести для них lookup-строки (иначе FK упадёт).

### 3. Аллокация id (инверсия порядка вставки)

Новый метод рантайма рядом с существующим `indexCreated`:

```ts
/** Заводит строку document_index и возвращает сгенерированный id. Базовая строка вставляется следом, с этим id. */
allocateDocumentId(type: string, db?: BackendDbService, opts?: { actor?: DocumentActor }): Promise<string>
```

`indexCreated(type, id, ...)` **остаётся** — он нужен там, где id известен заранее: fixtures с pinned
`{ id }`, `importData` с явным id в item'е. Меняется только его роль: не «дописать индекс после факта», а
«зарезервировать конкретный id перед вставкой базовой строки».

Точки, где порядок инвертируется:

| Место | Сейчас | Станет |
|-------|--------|--------|
| `DocumentRuntime.create` | insert base (id авто) → `indexCreated` | `allocateDocumentId` → insert base с этим id |
| `DocumentRuntime.importData` | то же, две ветки (с id и без) | ветка без id — `allocateDocumentId`; ветка с id — `indexCreated(id)` перед insert |
| `WorkflowEngine.startProcess` ([engine.ts:135-149](../../../packages/module-workflow/src/backend/services/engine.ts#L135-L149)) | insert `processInstances` → `indexCreated` | `allocateDocumentId` → insert с этим id |
| `HrStructureService` × 5 `create*` | insert node, индекс не трогается | `allocateDocumentId` → insert node с этим id |

`reconcileFixtures` — отдельный случай, см. ниже.

### 4. reconcileFixtures: natural key перестаёт быть одним запросом

Сейчас fixture с `{ column: 'code', value }` — один `INSERT ... ON CONFLICT (code) DO UPDATE ... RETURNING id`,
id генерит базовая таблица. С первичным индексом id взять неоткуда до вставки, поэтому:

1. `SELECT id FROM <base> WHERE <column> = <value>`
2. нашли → `UPDATE` базовой строки + `indexCreated(type, id, { fixture: true })` (как сейчас, upsert);
3. не нашли → `allocateDocumentId` → `INSERT` базовой строки с этим id.

Атомарность сохраняется транзакцией; теряется только однозапросность. Ветка с pinned `{ id }` проще —
`indexCreated(type, pinnedId)` перед upsert базовой строки.

### 5. Удаляется

- `DocumentRuntime.backfillIndex()` + хелпер `qualifiedName()` + вызов из bootstrap
  (`platform-core/src/backend/app.ts`) + метод в контракте `BackendDocumentRuntime`. После FK строка не
  может существовать без lookup-записи, бэкфиллить нечего.

## Этап 2 — состояние документа только в индексе (`deletedAt` + `stale`)

> **Реализовано 2026-08-06.** Ниже — исходный разбор; что разошлось с ним, собрано в конце раздела
> («Как получилось на деле»).

Одно и то же состояние хранится в двух местах, и это касается **двух** флагов сразу — их надо схлопывать
одним заходом, операция идентичная.

### `deletedAt`

Пишется дважды: в базовую таблицу и в `document_index` (`deleteMany`/`restore`), а читается из базовой
(`softDeleteColumn`/`activeFilter`). Две копии одного состояния, которые в принципе могут разойтись —
конкретный сценарий расхождения описан в
[02-fixtures-stale-scope](./02-fixtures-stale-scope.md) («смежная деталь»): `indexCreated` в
conflict-ветке всегда ставит `deletedAt: null`, базовую таблицу не трогая.

- `softDeleteColumn`/`activeFilter` перестают смотреть на схему типа и работают по `documentIndex.deletedAt`.
- `list()`/`streamExportBatches` начинают джойнить индекс (на этапе 3 он и так станет FROM-таблицей —
  тогда джойн уйдёт).
- `deleteMany`/`restore` пишут в одно место.
- Колонки `deleted_at` в базовых таблицах становятся мёртвыми. Дропать их в этой же миграции не
  обязательно — но пока они есть, есть и соблазн их прочитать; лучше снести сразу (`identity_user`,
  `user_groups` и те hr-таблицы, где они заведены).
- Частичные индексы вида `idx_identity_user_active (id) WHERE deleted_at IS NULL` теряют смысл — вместо
  них нужен аналог на `document_index`.

### `stale`

Ровно то же дублирование, но с перекосом: индексная копия (`documentIndex.stale`) **не читается никем**,
а работает базовая (`scheduledTasks.stale` — роут задач и UI карточки). Под мёртвую индексную копию при
этом заведён частичный индекс `idx_document_index_stale ON (type) WHERE stale`, обслуживающий ноль
запросов. Подробности и обоснование направления — в
[02-fixtures-stale-scope](./02-fixtures-stale-scope.md).

- Схлопывать **в индекс**: он generic и не требует от каждого fixture-типа заводить свою колонку.
- Роут задач (`module-admin/backend/routes/tasks.ts`) и карточка задачи начинают читать индекс.
- Колонка `stale` в `scheduled_tasks` становится мёртвой — дропать вместе с `deleted_at` остальных.
- Мёртвый частичный индекс наконец начинает работать.
- `reconcileFixtures` теряет ветку «разметить базовую таблицу, если у неё есть колонка `stale`» — вместе
  с допущением «все её строки fixtures» (скоуп из [02](./02-fixtures-stale-scope.md) к этому моменту уже
  сделан, но здесь ветка уходит целиком).

### Как получилось на деле

**Способность к soft-delete пришлось объявить явно.** Раньше она выводилась из формы схемы («у базовой
таблицы есть колонка `deleted_at`»); колонки не стало — не стало и объявления. Появился
`DocumentType.softDelete?: boolean`, выставленный четырём типам, у которых soft-delete был и раньше:
`user`, `user-group`, `hr-poll`, `hr-request-type`. Альтернатива «раз состояние в индексе, значит
soft-delete у всех» отвергнута: она молча поменяла бы семантику удаления пятнадцати типов, в том числе
превратила бы hard-delete `hr-tag` в мягкий.

**Потребителей оказалось больше, чем перечислено выше.** Кроме роута задач и карточки:

- **вход в систему** — `PasswordAuthProvider` фильтровал по `identityUser.deletedAt` в двух местах
  (`validateCredentials`, `findUserIdByLogin`); теперь джойнит индекс. Без этой правки soft-deleted
  пользователь снова смог бы залогиниться;
- **`TaskScheduler`** — `triggerNow` и `reconcileTimers` читали `scheduledTasks.stale`;
- **контракт** `ScheduledTaskRow` потерял `stale` (`TaskRunner` его не читает, так что дальше не пошло).

**Колонка списка `stale` не выражалась через `ListExtension`.** Расширение с `schema: documentIndex`
дало бы второй джойн той же таблицы без алиаса — SQL-ошибка, потому что рантайм джойнит индекс сам.
Решено фолбэком `INDEX_STATE_COLUMNS` в `buildListSelect`: поле, не найденное ни в таблице расширения,
ни в базовой, ищется среди колонок состояния индекса. Список явный (`stale`, `deletedAt`), а не «все
колонки индекса», — иначе поле с именем `type`/`createdAt` молча подхватило бы чужую колонку вместо
того, чтобы честно выпасть из выборки.

**Импорт стал явно отказываться воскрешать удалённый документ** (409). Прежним стражем был фильтр
`deleted_at IS NULL` по базовой таблице; теперь проверка обязана идти **до** `indexCreated`, потому
что тот в conflict-ветке сам сбрасывает `deletedAt`.

**`assertDocumentActive` заодно сверяет тип.** Проверка переехала с базовой таблицы на индекс, а там
тип лежит рядом — `update('hr-tag', <id пользователя>)` больше не проходит.

**Частичный индекс заменён, а не добавлен.** `idx_document_index_active (id) WHERE deleted_at IS NULL`
не обслуживал ничего (id и так PK); вместо него `idx_document_index_type_active (type)
WHERE deleted_at IS NULL` — тот самый, который понадобится этапу 3 под `FROM document_index WHERE type = ?`.

## Этап 3 — `schema` вон из `docs.register()`

### Зачем

Сейчас таблица типа объявляется **дважды**: в `docs.register({ schema })` и снова в
`docs.objects.extend({ schema })` — см. [user-group.ts:9,29](../../../packages/platform-core/src/backend/documents/user-group.ts#L9).
`docs.lists.extend` там же таблицу вообще не указывает, полагаясь на неявный фолбэк. Это протекло в рантайм:

- **`buildListSelect`** — двойной фолбэк: `ext.schema ?? doc.schema`, затем ещё
  `getTableColumns(table)[field] ?? getTableColumns(doc.schema)[field]`.
- **`create()`** — поля пишутся дважды. `flattenBody` сливает данные всех модулей в одну плоскую мапу, всё
  совпавшее по имени с колонкой базовой таблицы уходит в `insert(doc.schema)`, а затем те же поля пишет
  `saveExtension`. Побочно `flattenBody` схлопывает модули: два модуля с одноимённым полем молча затрут
  друг друга.

То есть на create данные текут через базовую таблицу, на update — через extension. Один и тот же `name`
ходит двумя разными путями.

### Что делаем

`docs.register(id, {...})` теряет `schema`/`idColumn` и становится чистым описанием типа
(`label`, `section`, `topic`, `creatable`, `deletable`). Таблица владельца объявляется как обычный
extension — та же форма, что у всех остальных модулей:

```ts
docs.register('user-group', { label: 'core:user_group_label' });
docs.objects.extend('user-group', { module: 'core', schema: userGroups, idColumn: 'id', fields, layout });
docs.lists.extend('user-group', { module: 'core', schema: userGroups, foreignKey: 'id', fields });
```

Следствия в рантайме:
- `list()`/`streamExportBatches`/`exportData` берут `FROM document_index WHERE type = ?` вместо базовой
  таблицы; все extension'ы становятся джойнами на общих правах.
- оба фолбэка в `buildListSelect` уходят;
- ветка `flattenBody`/`baseValues` из `create()` исчезает — запись только через `saveExtension`;
- `getDocOrFail` больше не может требовать `doc.schema`;
- `reconcileFixtures` работает по extension'у, объявившему нужный natural key.

### Цена

Все списки всех типов начинают ходить в одну таблицу. Индекс по `type` для этого уже появился на
этапе 2 (`idx_document_index_type_active (type) WHERE deleted_at IS NULL`).

### Состав работ (реализовано 2026-08-06)

> Ниже — план работ, каким он был записан. Что разошлось с ним, собрано в конце раздела
> («Как получилось на деле»).

Порядок — от рантайма к регистрациям: рантайм проверяется typecheck'ом, регистрации после него
падают компилятором поштучно, так что незавершённое состояние видно сразу.

1. **Контракт.** `DocumentType` теряет `schema`/`idColumn` и становится чистым описанием типа.
2. **Рантайм** (в сумме становится проще, чем сейчас):
   - `list`/`streamExportBatches`/`exportData` — `FROM document_index WHERE type = ? AND deleted_at
     IS NULL`, `idColRef` = `documentIndex.id`, все расширения на общих правах джойнов;
   - оба фолбэка в `buildListSelect` уходят (`INDEX_STATE_COLUMNS` остаётся — индекс теперь и есть
     FROM-таблица);
   - `getAnyById` — строка индекса и **есть** документ, отдельная проверка базовой строки не нужна;
   - `create` — `allocateDocumentId` + `saveExtensionData`, ветка `flattenBody`/`baseValues`
     исчезает (вместе с ней — молчаливое схлопывание одноимённых полей разных модулей);
   - `importData` — то же самое, без работы с базовой строкой;
   - `deleteMany`/`hardDelete` — `deleteExtensionData` + `indexRemoved`, отдельного удаления базовой
     строки нет;
   - `reconcileFixtures` — natural key ищется среди extension'ов, объявивших нужную колонку.
3. **`saveExtension` — `UPDATE ... RETURNING`, при нуле задетых строк `INSERT`.** Без базовой
   таблицы деления «базовая → UPDATE, сателлит → upsert» (см. [04](./04-extension-upsert.md))
   больше нет, но и голый `ON CONFLICT` не годится: Postgres проверяет `NOT NULL` до разрешения
   конфликта, а карточка присылает только свои поля. UPDATE-then-INSERT решает это по построению
   и стоит одного лишнего запроса лишь при первой записи.
4. **19 регистраций** — перенос `schema`/`idColumn` из `register` в `objects.extend`.
5. **Все `lists.extend` получают явные `schema`/`foreignKey`** — сейчас они держатся на фолбэке.
6. **Пять hr-типов: список распадается на два расширения.** `code` живёт на узле, остальное на
   версии, а фолбэка больше нет. Значит нужен второй `lists.extend` с ключом (например `node`), и
   ключ колонки меняется `hr:base:code` → `hr:node:code` — с миграцией сохранённых настроек таблиц
   и фильтров (`migrateColumnKey` в `table-settings.ts`, `migrateFilterColumns` в `list-query.ts`).
7. **Пять hr `save` создают узел сами.** Сейчас строку узла вставляет generic `create()` — на это
   прямо рассчитывает комментарий в
   [department.ts](../../../packages/module-hr/src/backend/documents/department.ts). После правки
   `create()` узел должен появляться в `save` (upsert по `id`), причём у `hr_staff_unit_node` есть
   `NOT NULL` за пределами `code` (`department_node_id`, `template_id`) — их карточка присылает,
   но это надо проверить по каждому типу.

**Порядок относительно 05.** Пункт 7 переписывает ровно те места, которые правил
[05-hr-versioning](./05-hr-versioning.md), — поэтому 05 сделан первым (2026-08-06), чтобы не
переписывать их дважды.

### Как получилось на деле

**Read-only типы держались на ОТСУТСТВИИ `schema`, а не на `readonly` в UI.** `poll-response` и
`workflow-process` объявлены без таблицы намеренно: `saveExtensionData` пропускает расширение, у
которого нет ни `save`, ни `schema`. Механический перенос `schema` из `register()` в
`objects.extend()` сделал бы их записываемыми — оставлены без неё.

Обратная сторона: `poll-response` — `deletable: true`, и без базовой таблицы удалять его строку
стало некому (она бы пережила документ, а `document_index` не удалился бы вовсе — ответ на него
ссылается). Понадобился явный `remove` на расширении. Это же место — общая проверка на будущее:
**у deletable-типа каждая таблица данных обязана быть достижима через `schema` либо `remove`.**

**`scheduled-task`, наоборот, `schema` получил** при ручных `load`/`save`: по ней
`reconcileFixtures` находит natural key `code`. Поиск fixture-таблицы стал отдельным шагом
(`fixtureTable`) — своей таблицы у типа нет, нужную ищем среди расширений по объявленной колонке;
для pinned-варианта (`{ id }`) колонки нет и берётся первое расширение с таблицей.

**Пункт 6 сделан без миграции сохранённых настроек** — по решению заказчика и действующей политике
(`CLAUDE.md`, «Data & Migrations Policy»). Цена: сохранённый **фильтр** по `code` у пяти hr-типов
даёт 400 «неизвестная колонка», пока не очищен `admin-table-settings` в localStorage. Ширины,
порядок и видимость колонок деградируют молча. `migrateColumnKey`/`migrateFilterColumns` не
трогались.

**`create` сменил возвращаемое значение** на `{ id }` — отдавать строку базовой таблицы больше
неоткуда. Фронт перестал угадывать id (`created.id ?? created.login ?? первое попавшееся поле`).

**`getAnyById` заодно сверяет тип из URL** с типом документа: раньше несовпадение читалось чужими
расширениями и давало пустую карточку, теперь 404. Тем же заходом `importData` отвечает 409 на id,
занятый документом другого типа, — `indexCreated` в conflict-ветке переписывает `type` и молча
угнал бы чужой id.

**`flattenBody` не удалён целиком, а сжался до `findItemId`**: импорту всё ещё надо достать `id` из
трёхуровневого тела item'а.

## Не в скоупе

- **`core.document_access`** — таблица объявлена и экспортируется, но **нигде не читается и не пишется**
  (грep: только `schemas/document-access.ts` и реэкспорт в `schemas/index.ts`). Первичный индекс делает
  возможным `doc_id uuid REFERENCES document_index(id)`, но вкладываться в мёртвую таблицу сейчас незачем.
- **`source_document_id`** в `hr_*_version` — сделать FK можно и нужно, но это отдельная правка module-hr
  со своей миграцией; здесь только создаётся возможность.
- Ревизия 34 FK module-hr на предмет `ON DELETE` (см. развилки).
- Уход данных типа в `customFields` вместо собственной таблицы. Этап 3 такую возможность открывает, но ни
  один существующий тип так не переводится: у них натуральные ключи под `UNIQUE` и входящие FK, которые
  jsonb не воспроизводит (предикат «только среди отделов» в индекс не записать — `type` лежит в другой
  таблице).

## Риски

- **Миграция необратима и падает на грязных данных.** Если в базовой таблице есть строка, которой нет в
  индексе и которую backfill-шаг не подхватил (например, тип не зарегистрирован в момент миграции), FK не
  создастся. Backfill в каждой модульной миграции пишется по фактическому имени таблицы, а не по реестру, —
  это как раз защита от «тип не зарегистрирован».
- **Цикл FK вокруг пользователя** (замечено при реализации этапа 1). `identity_user.id →
  document_index.id` и `document_index.created_by_user_id → identity_user.id` образуют цикл между
  таблицами. Обычные пути его не задевают: строки разные, порядок вставки «индекс → базовая» цикла не
  замыкает. Но `hardDelete` пользователя, которого кто-то указан создателем (в том числе он сам),
  теперь упрётся в FK. Практически недостижимо — у `user` есть soft-delete, а сид создаётся с
  `created_by_user_id = NULL`; но если понадобится физическое удаление пользователей, сначала нужно
  решить, что делать с этой ссылкой (`ON DELETE SET NULL` — очевидный кандидат).
- **Порядок в транзакции создания меняется на всех путях сразу.** Если какой-то путь пропущен, он упадёт с
  нарушением FK **сразу и громко** — что лучше нынешнего «молча не проиндексировался», но проверять надо все
  4 точки + 5 методов HrStructureService.
- Против реальной БД ничего из этого не проверено; нужен прогон миграций на копии данных.

## Проверка

`pnpm build` + `pnpm test` + `pnpm check:depcruise`. Обязателен smoke на реальной БД: bootstrap с нуля
(миграции + reconcileFixtures + сид), создание документа каждого типа через админку, hard-delete, импорт
с явным id и без, старт workflow-процесса.
