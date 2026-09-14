---
status: proposed
date: 2026-07-25
topic: document extension layout
---

# Document extension `layout` — page → group → grid

## Проблема

Сегодня `objects.extend(docId, { module, group, fields, ... })` привязывает вклад
модуля к **одной** группе плоской строкой `group: string`. Страница выясняется
транзитивно (через `registerGroup({ page })`). Внутри группы поля рендерятся в
**захардкоженном** 3-колоночном гриде
([admin-document-card.tsx:258](../../packages/module-admin/src/frontend/pages/admin-document-card/ui/admin-document-card.tsx#L258)):
управлять шириной поля, порядком по сетке или разложить вклад по нескольким
страницам/группам нельзя.

## Цель

Заменить `group: string` на декларативную карту `layout`:

```
layout = { [pageId]: { [groupId]: { rows } } }
```

где группа раскладывается **построчно**: каждая строка (`LayoutRow`) — массив
ячеек, ячейка ссылается на поле из `fields`, на компонент, либо пустой спейсер.
Строка сама решает, как поделить ширину — ширина строки = сумма `span` её ячеек
(строки автономны, как отдельные `grid grid-cols-N` в shadcn-форме). Группового
`cols` нет. Один extension может раскладывать вклад по нескольким страницам/группам.

## Что НЕ меняется (границы рефактора)

Только представление. Не трогаем: `load`/`save`/`schema`/`idColumn`/`mode`/`remove`,
персистенцию (`saveExtensionData`/`loadExtension`/`deleteExtensionData`),
`document_index`, fixtures, list-расширения (`lists.extend`), правило «один
extension на модуль на документ». `fields` остаётся пулом метаданных полей —
`layout` лишь решает, какие из них и где показать.

## Контракт (`platform-core/src/contracts/documents.ts`)

```ts
/** Раскладка вклада модуля по карточке: page → group → строки. Заменяет плоский `group`. */
export type DocumentLayout = Record<string, Record<string, GroupLayout>>;

export interface GroupLayout {
  /** Если не задан — каждое поле из `fields` своей строкой (одна колонка). */
  rows?: LayoutRow[];
}

/** Строка. Ширина = сумма span ячеек (по умолчанию 1 у каждой). */
export type LayoutRow = LayoutCell[];

/** `'code'` — краткая форма для `{ field: 'code', span: 1 }`. */
export type LayoutCell =
  | string
  | { field: string; span?: number }
  | { component: string; span?: number }  // id из frontend component-registry
  | { empty: true; span?: number };       // пустой спейсер — резервирует место
```

`DocumentExtension`: убрать `group: string` и `component?: string`, добавить
`layout: DocumentLayout`. Компонент теперь — ячейка (`{ component }`), это убирает
дублирующее «extension целиком = компонент». `fields` / persistence-поля без
изменений.

### Пример миграции (staff-unit)

Было:
```ts
docs.objects.extend('hr-staff-unit', {
  module: 'hr', group: DocumentGroups.DEFAULT,
  fields: { code: {...}, minSalary: {...}, maxSalary: {...}, departmentNodeId: {...}, ... },
  load, save,
});
```
Станет:
```ts
docs.objects.extend('hr-staff-unit', {
  module: 'hr',
  layout: {
    [DocumentPages.DEFAULT]: {
      [DocumentGroups.DEFAULT]: {
        rows: [
          ['code', 'gradeId', 'isActive'],                       // три равные трети
          [{ field: 'departmentNodeId', span: 2 }, 'templateId'],// 2/3 + 1/3
          ['minSalary', 'maxSalary'],                            // две половины
          [{ empty: true, span: 2 }, 'quantity'],                // поле в правой трети
        ],
      },
    },
  },
  fields: { code: {...}, minSalary: {...}, /* без изменений */ },
  load, save,
});
```
Компонентный пример (`user-auth-log`):
```ts
layout: { [DocumentPages.USER_LOG]: { [DocumentGroups.AUTH_LOG]: {
  rows: [[{ component: 'user-auth-log' }]],
} } }
```

## Реестр (`platform-core/src/backend/documents.ts`)

- `objects.extend`: хранит `layout` вместо `group` (проверка уникальности по
  `module` — как есть).
- `getGroupExtensions(docId, groupId)` больше не нужен в текущем виде — удалить из
  контракта `DocumentObjectRegistry` и из impl. `getExtensions` / `getPages` /
  `getGroups` остаются.
- `registerPage`/`registerGroup` без изменений (label/order/icon/nav/linkTemplate).
  `layout` ссылается на их **id**; незарегистрированные page/group — **падаем**
  (ошибка на этапе сборки enriched-структуры). Ячейка `{ field }`, которой нет в
  `ext.fields` — тоже ошибка.

## Runtime (`document-runtime.ts` → `buildEnrichedPages`)

Переписать агрегацию. Сейчас: page → `getGroups` → `getGroupExtensions(group)`.
Станет: собрать индекс `page → group → placements[]`, пройдя `getExtensions(type)`
и развернув `ext.layout`. Для каждого `(page, group)` GroupLayout → один
`EnrichedExtension` с резолвленной сеткой.

Контракт результата (`contracts/backend/document-runtime.ts`):
```ts
export interface EnrichedExtension {
  module: string;
  fields: Record<string, FieldMetadata>;  // пул метаданных (как сейчас) — cell резолвится по нему на фронте
  rows: EnrichedRow[];
}
export type EnrichedRow = EnrichedCell[];
export type EnrichedCell =
  | { kind: 'field'; field: string; span: number }
  | { kind: 'component'; component: string; span: number }
  | { kind: 'empty'; span: number };
```
`EnrichedGroup.extensions[]` остаётся списком (несколько модулей в одной группе —
стек с разделителями, как сейчас). `EnrichedPage` — без изменений. `fields`
оставляем на `EnrichedExtension` (а не дублируем `meta` в каждую ячейку): фронт
резолвит `ext.fields[cell.field]`, а компонент получает `ext.fields` как проп.

Раскрытие `rows?`: если не задан — **legacy-дефолт**: поля разложены
`DEFAULT_LAYOUT_COLUMNS`-колоночной сеткой (chunk по 3), чтобы не-мигрированные
документы выглядели как сейчас (`grid-cols-3`). Явный `rows` перекрывает.
Валидация: page/group зарегистрированы, `field` есть в `ext.fields` — иначе исключение.

## Фронтенд (`admin-document-card.tsx`)

- Локальные типы `ExtensionData`/`GroupData` → под новый `EnrichedExtension`
  (`fields` + `rows`).
- Замена захардкоженного `grid grid-cols-3` на построчный рендер: на каждую строку
  свой grid с `gridTemplateColumns: repeat(sum(span), minmax(0,1fr))`, каждая ячейка
  `gridColumn: span N`.
- Ячейки: `kind:'field'` → `<FieldWidget meta={ext.fields[cell.field]}>`;
  `kind:'component'` → `getComponent(...)` со старыми пропсами `{data, fields:
  ext.fields, readonly, onChange}`; `kind:'empty'` → пустой div на свой span.
- `seedDefaults`: обходить `ext.fields` extension'а (пул), брать `meta.default`.
  `editData` по-прежнему keyed by `module`.

## Точки, которые НЕ трогаем, но проверяем

- Роуты `/registry/documents/:type` и `/documents/:type/:id`
  ([registry.ts:41](../../packages/module-admin/src/backend/routes/registry.ts#L41),
  [documents.ts:18](../../packages/module-admin/src/backend/routes/documents.ts#L18))
  просто прокидывают `getRegistryMeta().pages` — новый shape дойдёт до фронта сам.
- `exportData`/`importData`/`list` не читают `group`/layout — не трогаем.

## Список мест `objects.extend` для миграции (~20)

`module-hr`: staff-unit, virtual-team, cost-center, department, legal-entity,
work-schedule, user, tag, role, position-grade, position-template, job-family.
`platform-core`: user, user-group, scheduled-task. `module-workflow`: workflow,
process-instance. `module-hr-request`: request-type. `module-auth-password`: user.
(+ `core-pages.ts` — дефолтные page/group остаются, они не extend.)

Для дефолтного кейса: `rows?` можно не указывать → legacy 3-колоночная сетка (как
сейчас), т.е. многие миграции = обернуть текущий `group` в
`layout: { [page]: { [group]: {} } }` без перечисления полей. Ни визуальных, ни
данных-изменений нет.

## Порядок реализации

1. Контракты: `DocumentLayout`/`GroupLayout`/`LayoutItem`, правка `DocumentExtension`
   и `DocumentObjectRegistry` (убрать `getGroupExtensions`); `EnrichedExtension`/
   `EnrichedLayoutItem`.
2. Реестр impl + `buildEnrichedPages`.
3. Фронтенд-рендер + `seedDefaults`.
4. Миграция всех `objects.extend` (staff-unit — первым, как эталон с реальной сеткой;
   остальные — обёрткой без `items`, точечно доводя грид где нужно).
5. `pnpm typecheck` + прогон карточек в UI.

## Решения по открытым вопросам

- Незарегистрированные page/group (и неизвестное `field`) в layout — **падаем**.
- DX-хелпер не нужен: дефолт «`rows` не задан → поле на строку» закрывает массовый
  кейс.
- Выравнивание колонок между строками не гарантируем (строки автономны, сумма span
  на строку). Общий выровненный грид (`cols` на группу) — отложен, добавим опцией
  только если понадобится вертикальное выравнивание.
