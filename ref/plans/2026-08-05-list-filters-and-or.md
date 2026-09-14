---
title: Фильтры списков — AND/OR + группировка (один уровень)
type: plan
status: implemented
date: 2026-08-05
---

> **Статус реализации.** Этапы 0–4 выполнены целиком (контракты, бэкенд, удаление `listFetch`,
> фронтенд, дедупликация). Этап 5 (populate `options` для select-колонок) — не делался, требует
> источника значений и не блокирует остальное. `pnpm build`/`lint`/`check:depcruise` чисты,
> `pnpm test` — 31 тест зелёный. **Живой прогон на БД не делался** (нет в среде реализации) —
> протокол в разделе «Проверка», исполняется на стороне пользователя.

# Фильтры списков: AND/OR + группировка

## Контекст и мотивация

Amplicada пишется как замена legacy-продукта. В legacy есть сложные условия фильтрации
(AND/OR + группы), и клиенты при переходе должны пользоваться тем, к чему привыкли — это
требование паритета, а не гипотетическое улучшение.

Текущая система фильтров плоская: `FilterCondition[]`, всегда склеиваемые через `and(...)`
(`document-runtime.ts:247`). Выразить `active = true AND (dept = A OR dept = B)` невозможно.

Попутно вскрылись реальные дефекты, которые чинятся в рамках этой же работы (решение
пользователя) — см. раздел «Дефекты».

## Решение

**Рекурсивный контракт, UI на один уровень.** Формат хранения — дерево произвольной глубины
(рекурсия на бэкенде стоит ~20 строк и избавляет от миграции формата навсегда), интерфейс
показывает ровно один уровень групп, как Airtable/Notion/Retool. Глубже двух уровней на
практике почти никто не строит, а стоимость хорошего UI для произвольной вложенности высокая.

### Ключевые решения

| Решение | Обоснование |
|---|---|
| Явный дискриминатор `kind: 'condition' \| 'group'` | Структурная проверка (`'children' in node`) хуже сужается в TS и не выражается как JSON-schema `oneOf` |
| Корень — всегда `FilterGroup` | Иначе некуда положить `combinator` для первых двух условий |
| `values?: string[]` отдельным полем для `in`/`notIn` | `value: string \| string[]` ломает сигнатуру `coerceValue`; запятая-разделитель не имеет escape-стратегии |
| `between` остаётся на `value`/`value2` | Уже в localStorage и на проводе; менять — миграция ради нуля |
| Нет `not` на группе | У каждого оператора есть отрицание; `NOT (a AND b)` по nullable-колонкам трёхзначен. Опциональное поле — добавляется потом без миграции |
| Невалидный фильтр → **400**, а не тихий дроп | См. ниже — с OR тихий дроп становится семантически опасным |
| Формат НЕ выравнивается с `module-workflow/conditions.ts` (JSONLogic) | JSONLogic позиционен (нет слота «колонка»), нет `ilike`/`between`/`isEmpty`/`notIn`. Тот эвалуатор считает в JS по payload, наш компилируется в SQL — переиспользование иллюзорно |

### Почему тихий дроп больше не годится

Сегодня любая проблема (неизвестная колонка, недопустимый оператор, неприводимое значение)
приводит к `continue` — условие молча выбрасывается, ответ 200. При чистом AND это лишь
**расширяло** выборку. С OR:

- дроп листа внутри OR — **сужает** выборку (строки, которые пользователь просил, исчезают);
- дроп всех листьев группы — группа исчезает из родительского AND и **расширяет** выборку.

Молчаливый 200 с неправильными строками в кадровой системе — худший вариант отказа.
Единственная допустимая тишина — пустая группа, созданная пользователем (фронт вырезает её
через `pruneEmptyGroups` до отправки).

## Дефекты, чинимые в этой же работе

1. **`listFetch` обходит фильтры.** 5 типов (`hr-cost-center`, `hr-department`,
   `hr-legal-entity`, `hr-staff-unit`, `hr-virtual-team`) уходят в `listViaCustomFetch`
   (`document-runtime.ts:477-478`), который не читает `params.filters`. Пользователь видит
   бейдж «1 фильтр» и нефильтрованные данные.
   **Дополнительно выяснено:** `streamExportBatches` (712-774) short-circuit'а на `listFetch`
   вообще НЕ имеет — значит экспорт этих 5 типов уже сломан сегодня (в CSV попадают только
   `id` + колонки node-таблицы, остальные заголовки есть, данных нет).
2. **Тихие дропы** → 400 (см. выше).
3. **`select`-колонки без `options`** — `ListFieldMeta` не имеет `options`, диалог рисует
   free-text и значение приходится угадывать руками.
4. **`ilike` по нетекстовым колонкам** — колонка без `type` падает в `DEFAULT_FILTER_OPERATORS`
   (= текстовые), `contains` доходит до uuid/timestamp и роняет запрос на уровне БД.

## Контракт

`packages/platform-core/src/contracts/documents.ts`:

```ts
export type FilterCombinator = 'and' | 'or';
export type FilterOperator =
  | 'eq' | 'ne' | 'contains' | 'notContains' | 'in' | 'notIn'
  | 'isEmpty' | 'isNotEmpty' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';

export interface FilterCondition {
  kind: 'condition';
  column: string;          // префиксный ключ `${module}:${field}`
  operator: FilterOperator;
  value?: string;
  value2?: string;         // верхняя граница between
  values?: string[];       // для in/notIn
}
export interface FilterGroup { kind: 'group'; combinator: FilterCombinator; children: FilterNode[] }
export type FilterNode = FilterCondition | FilterGroup;
export type FilterTree = FilterGroup;   // корень всегда группа

export const FILTER_MAX_DEPTH = 5;
export const FILTER_MAX_NODES = 100;
export const FILTER_MAX_IN_VALUES = 200;
export const FILTER_MAX_PARAM_LENGTH = 16_000;
```

`ListFieldMeta` получает `options?: { label: string; value: string }[]` (label — i18n-ключ,
резолвится в `resolveListColumns`, `module-admin/src/backend/lib/resolve-document-labels.ts`).

`DEFAULT_FILTER_OPERATORS` сужается — **без** `contains`/`notContains` (дефект 4):
`['eq','ne','in','notIn','isEmpty','isNotEmpty']`.

## Обратная совместимость

Новый файл `packages/platform-core/src/contracts/filters.ts` (чистый, без drizzle/React —
импортируется с обеих сторон, легально по `check:depcruise`):

- `normalizeFilterInput(input: unknown): FilterTree` — принимает `undefined`/`null`/`''`/
  legacy `FilterCondition[]`/`FilterNode`/`FilterTree`. Никогда не бросает, мусор отбрасывает.
  **Идемпотентна и детерминирована** — на этом держится совпадение queryKey между route
  loader'ом и компонентом. Никаких `randomUUID` внутри.
- `countFilterConditions(node)` — число листьев (бейдж тулбара, «фильтр пуст?»).
- `pruneEmptyGroups(tree)` — фронт зовёт перед `onApply`.

Legacy-массив → `{kind:'group', combinator:'and', children:[...]}` — ровно сегодняшняя
неявная семантика AND.

Применяется в трёх местах: backend `parseFilterParam`, компонент списка, route loader.
Читается всегда через общий `filtersForType(settings, type)`.

**Новый бэкенд принимает legacy-массивы → бэкенд может ехать раньше фронта. Обратное неверно.**

## Бэкенд

Новый `packages/platform-core/src/backend/services/filter-sql.ts` — `coerceValue` и вся
сборка WHERE выносятся из 1063-строчного `document-runtime.ts` в чистые функции
(тестируемо без БД).

- `buildFilterWhere(tree, columns, selectObj)` — рекурсия; собирает **все** проблемы в
  `FilterIssue[]` и бросает `DocumentRuntimeError(400, ..., issues)` разом.
- Группа из одного ребёнка не оборачивается; пустая группа возвращает `undefined`.
- Лимиты `FILTER_MAX_DEPTH` / `FILTER_MAX_NODES` / `FILTER_MAX_IN_VALUES`.
- Оба вызова (`list()` и `streamExportBatches()`) заменяются одним приватным `resolveWhere()`;
  `count(*)` в `list()` продолжает переиспользовать тот же `whereClause`.
- `DocumentRuntimeError` получает опциональный третий аргумент `details`, error-handler
  (`module-admin/src/backend/index.ts:43-45`) его пробрасывает. Изменения аддитивны.
- Минимальная Fastify querystring-схема на `GET /documents/:type` и `.../export-view` —
  главное в ней `maxLength` на `filters` (граница до `JSON.parse`). `additionalProperties: true`,
  `page`/`pageSize` остаются строками, **response-схемы нет** (срезала бы динамический payload).

### Три семантических решения

1. **`nullSafeNegative`** — `ne`/`notContains`/`notIn` матчат NULL (`or(clause, isNull(col))`).
   В SQL `col <> 'x'` при NULL не матчит; пользователь (и legacy-продукт) ожидает обратного,
   Airtable «is not» тоже матчит пустое. Самая неожиданная строка в диффе — документируется.
2. **`escapeLike`** — экранируем `\`, `%`, `_`. Сегодня `50%` в поиске работает как wildcard.
3. **`contains` через `sql\`${column}::text\`** — тотальный способ применить `ilike` к колонке
   любого типа (дефект 4). Индекс всё равно не используется (`ilike '%x%'` не sargable).

## `listFetch` → удаляем

Рассмотрены варианты: протащить фильтры в 5 реализаций / сигналить в UI «фильтры не
применены» / пометить колонки `filterable: false` / **мигрировать на generic-путь**.

Выбран последний. Все 5 структурно одинаковы: база `hrX_node` + `hrX_version` по
`nodeId = node.id AND valid_to IS NULL`. Generic-путь уже умеет base+join+where+order+limit+count,
не хватает двух вещей:

```ts
// ListExtension
joinOn?: (table: any) => SQL | undefined;   // доп. предикат ON, для effective-dated: t => isNull(t.validTo)
joinType?: 'left' | 'inner';                // Node+Version → 'inner'
```
плюс фолбэк в `buildListSelect` (`:145`), чтобы одно расширение могло объявить и `code` (node),
и `name` (version): `getTableColumns(table)?.[key] ?? getTableColumns(doc.schema)?.[key]`.

Протаскивать фильтры внутрь `listFetch` бессмысленно: колонки версии вообще отсутствуют в
`selectObj` (для `hr-department` резолвится только `code`), клауза для них непостроима в принципе.

Чинит одним махом для 5 типов: фильтрацию, **сортировку** (сегодня молча игнорируется —
ни одна реализация не читает `params.sortBy`), корректность `count(*)`, **экспорт**.

Затем `listFetch` удаляется целиком (контракт, `listViaCustomFetch`, short-circuit) — мёртвый
код, определяющее свойство которого «молча обходит фильтры».

Риск на проверку: затенение имён между node и version (внимательно — `hr-staff-unit`), и
`total` меняется с `count(node)` на `count(node ⋈ current version)` — это **фикс**: сегодня
узел без актуальной версии раздувает `total`, но не появляется ни на одной странице.

## Фронтенд

Airtable-конвенция: строка 1 — `Где`, строка 2 — `Select` (И/ИЛИ) = комбинатор группы,
строки 3+ — тот же комбинатор статическим текстом. Группы добавляются только на верхнем
уровне; ограничение глубины выражено самим типом драфта (дети группы — `DraftCondition`,
не `DraftItem`).

```
widgets/admin-filter-dialog/
  lib/draft.ts                 ← draft <-> FilterTree, makeCondition, operatorsFor, valueInputType
  ui/admin-filter-dialog.tsx   ← Dialog shell, DraftState, reset-on-open, apply/reset
  ui/filter-group.tsx          ← комбинатор + строки + «добавить условие/группу»
  ui/filter-condition-row.tsx  ← расширенный текущий FilterConditionRow
  ui/filter-value-input.tsx    ← редактор значения по (meta.type, operator)
```

Драфт держит стабильные `id` для ключей React (индекс-ключи ломаются на удалении/реордере),
а маппинг `draftToTree` механически гарантирует, что `id` **никогда не попадёт в дерево** —
иначе queryKey менялся бы на каждое открытие диалога и давал рефетч-вспышку при каждой загрузке.

Значения: `in`/`notIn` → `ComboboxChips` (**уже есть** в `platform-core/.../ui/combobox.tsx:213-291`),
по `options` либо free-entry; `eq`/`ne` по `select` с `options` → `Select`; остальное как сейчас.

`activeFilterCount` = `countFilterConditions(filters)` — считаем **листья**, иначе группа из
четырёх условий покажется как «1». `admin-table-toolbar.tsx` менять не нужно.

## Дедупликация

Сериализация фильтров сегодня продублирована трижды: `adminDocumentListInfiniteQueryOptions`,
inline `pagesQuery`, `handleExportView`. Выносится в
`pages/admin-document-list/lib/list-query.ts`: `serializeFilters()` + `buildListQuery()`.
Заодно inline `pagesQuery` выносится в экспортируемый
`adminDocumentListPagesQueryOptions(...)` по образцу infinite-варианта, чтобы они перестали
расходиться.

## Этапы

| Этап | Содержание | Отгружается отдельно |
|---|---|---|
| 0 | `list-query.ts` + дедуп 3 мест; `filterable: false` на 5 HR-типах (временно) | да, без изменения контракта |
| 1 | Контракты: типы, операторы, `ListFieldMeta.options`, лимиты, `filters.ts` | вместе с 2 |
| 2 | `filter-sql.ts`, `resolveWhere`, `DocumentRuntimeError.details`, Fastify-схема | **до фронта** |
| 3 | Фронт: `TableSettings.filters: FilterTree`, диалог, i18n, loader — одним коммитом | после 2 |
| 4 | `joinOn`/`joinType`, миграция 5 HR-доков, удаление `listFetch` | после 2, независимо от 3 |
| 5 | Populate `options` для 5 select-колонок | опционально |

Порядок 2 → 3 и есть вся страховка: новый бэкенд понимает legacy-массивы, поэтому старый
фронт (в т.ч. закешированный бандл) продолжает работать. Обратное неверно.

## Проверка

**Тестовой инфраструктуры в проекте нет** (`turbo.json` объявляет задачу `test`, но ни один
пакет не определяет скрипт). Вводим `node --test` в `platform-core` — Node 20+ встроенный,
без зависимостей, и `filter-sql.ts`/`filters.ts` **чистые**, это самое дешёвое место начать.

Без БД проверяется больше, чем кажется:

- `pnpm typecheck` / `build` / `lint` / **`check:depcruise`** (новый `contracts/filters.ts`
  импортируется с обеих сторон — слоистость должна выполняться).
- **SQL-снапшоты без БД**: drizzle рендерит SQL офлайн — `db.select(...).where(clause).toSQL()`
  не делает I/O. Покрываем: OR внутри корневого AND; схлопывание группы из одного ребёнка;
  исчезновение пустой группы; биндинг `in`/`notIn` + арм `OR ... IS NULL` у `notIn`;
  `between`; `isEmpty`; `contains` → `::text` + экранирование; и **все** пути на 400.
- Round-trip без drizzle: legacy-массив → AND-группа; идемпотентность
  `JSON.stringify(normalize(x)) === JSON.stringify(normalize(normalize(x)))`;
  `draftToTree(treeToDraft(t)) === t`.

Нужна живая БД (`docker compose -f docker-compose.dev.yaml up`):
`ilike(sql\`${column}::text\`)` по `SQL.Aliased` jsonb-выражению кастомного поля — самая
рискованная строка плана; биндинг `inArray` для `timestamptz`/`numeric`; согласие `count(*)`
с данными при OR; **весь этап 4** (счётчики до/после миграции join'а по каждому из 5 типов).

Ручной прогон: `A AND (B OR C)` → бейдж **3**; перезагрузка без рефетч-вспышки (queryKey);
переключение режима пагинации даёт ту же выборку; экспорт содержит ровно отфильтрованное;
legacy-массив, вручную вписанный в `localStorage`, применяется; `?filters=[{"column":"nope"...}]`
→ **400 с внятным сообщением**, а не тихий 200.

## Сознательно вне скоупа

- **Сохранённые представления (views)** — `onOpenViews` заглушка, таблицы и API нет. Древовидный
  формат делает их тривиально сохраняемыми потом; это аргумент **не** смешивать их сюда.
- **Поиск в тулбаре** через синтетическую OR-группу — соблазнительно, как только появится OR
  (`searchQuery`/`onSearchChange` тоже заглушки), но размывает историю про паритет.
- **`not` на группе** — см. таблицу решений.
