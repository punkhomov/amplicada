---
title: Multiple extend() per module (DocumentExtension/ListExtension key)
type: plan
tier: 4
status: done
date: 2026-07-27
source: session/2026-07-27-document-actor-and-custom-fields
note: >-
  Ревизия 2, РЕАЛИЗОВАНО. Первая версия предлагала обязательный key либо плоский namespace
  `module#key` — отклонено в пользу опционального key с дефолтом 'base', нормализуемым при
  регистрации, и единообразного wire-формата `module:key:field` / `data[module][key][field]`.
  Отличия факта от плана — в разделе «Что вышло иначе». Против реальной БД не гонялось.
---

# Multiple extend() per module — Plan (ревизия 2)

## Проблема

`docs.objects.extend(docId, ext)` (`platform-core/src/backend/documents.ts:36-43`) кидает исключение, если
для `docId` уже зарегистрирован extension с тем же `ext.module`. Один модуль не может дважды расширить
один тип документа — например, двумя независимыми наборами кастомных полей.

Ограничение не косметическое: `ext.module` сегодня работает как **ключ хранения**, а не метка владельца.

- `saveExtensionData` — `body[ext.module]` (откуда брать данные при save), `document-runtime.ts:301`
- `getAnyById` — `data[ext.module] = ...`, `document-runtime.ts:437`
- `exportData` — `data[ext.module]`, `columns[ext.module]`, `document-runtime.ts:554,563,565`
- `document_custom_fields` — PK `(doc_id, module)`
- Список — префикс колонки `${ext.module}:${key}`, `document-runtime.ts:106,114`
- Фронтенд карточки (`admin-document-card.tsx:100,181,297,300,327,346,360`) — `editData[ext.module]`;
  `onChange` компонента делает `setEditData(prev => ({ ...prev, [ext.module]: data }))`, **заменяя бакет
  целиком**

Снять проверку уникальности, не тронув ключ хранения, нельзя: два extension'а одного модуля начнут писать
в один бакет, и второй `onChange` молча затрёт данные первого. Гарантированная порча, не гипотетическая.

## Решение: `key` с дефолтом `'base'`, нормализуемым при регистрации

`key?: string` — опционален в API (все 21 существующий вызов `extend()` не трогаем), но
`DocumentRegistryImpl` при регистрации подставляет `'base'`, если не задан. После этого **в реестре у
каждого extension `key` — конкретная строка**; рантайм никогда не видит `undefined`, никаких `?? 'base'`
по коду и никакого ветвления «есть ключ / нет ключа». Это инвариант, обеспеченный кодом, а не
договорённость.

Отсюда — единообразный wire-формат без исключений:

| Слой | Формат |
|------|--------|
| Object (`DocumentObject.data`) | `data[module][key][field]` |
| List (ключ колонки) | `module:key:field` (всегда ровно 3 сегмента) |
| `document_custom_fields` | PK `(doc_id, module, key)` |

Отвергнутая альтернатива — схлопывать namespace в голый `module`, когда `key === 'base'` (дешевле: ноль
правок фронта и ноль слетевших настроек), — заводит неявное правило, которое обязан знать каждый будущий
потребитель формата. Ровно тот класс неявностей, что потом даёт тихие баги.

### Цена и как она гасится

Ключи колонок персистятся в localStorage (`admin-table-settings`, см. `table-settings.ts:7-12`):
`columnOrders`, `columnSizing`, `columnVisibility`, `stickyColumns`, `filters`. Смена формата ключа
молча сбросила бы пользователям ширины/порядок/видимость колонок и сохранённые фильтры (не потеря
данных, но заметно). Гасится точечной нормализацией при чтении — ровно тем приёмом, что уже применён в
этом же файле для legacy-фильтров (`filtersForType()`): старый 2-сегментный ключ `module:field`
достраивается до `module:base:field`.

## Изменения по файлам

### 1. `platform-core/src/contracts/documents.ts`
- `DocumentExtension.key?: string`, `ListExtension.key?: string` (опциональны на входе).
- `export const DEFAULT_EXTENSION_KEY = 'base';`
- Обновить doc-комментарий `FilterCondition.column`: `${module}:${field}` → `${module}:${key}:${field}`.
- Обновить комментарий у `LayoutCell` (`documents.ts:55-59`): «делят общее состояние `data[module]`» →
  `data[module][key]`; правило «один редактируемый компонент на модуль» ослабляется до «на
  (module, key)» — это как раз то, ради чего фича и делается.

### 2. `platform-core/src/backend/documents.ts` (`DocumentRegistryImpl`)
- `objects.extend`: нормализация `const key = ext.key ?? DEFAULT_EXTENSION_KEY` перед `push`, хранить
  уже нормализованным; проверка уникальности — `e.module === ext.module && e.key === key`; текст ошибки
  включает key.
- `lists.extend`: та же нормализация key. Проверку уникальности там **не добавляем** — её нет и сегодня,
  это вне скоупа.

### 3. `platform-core/src/backend/schemas/document-custom-fields.ts`
- Колонка `key: text('key').notNull()` (без DB-дефолта: значение всегда приходит из нормализованного
  реестра; дефолт нужен только миграции для backfill существующих строк).
- PK → `(docId, module, key)`.

### 4. Миграция `platform-core/migrations/0003_document_custom_fields_key.sql` (+ `_journal.json`, idx 3)
```sql
ALTER TABLE "core"."document_custom_fields" ADD COLUMN IF NOT EXISTS "key" text NOT NULL DEFAULT 'base';
ALTER TABLE "core"."document_custom_fields" DROP CONSTRAINT IF EXISTS "document_custom_fields_pkey";
ALTER TABLE "core"."document_custom_fields" ADD CONSTRAINT "document_custom_fields_pkey"
  PRIMARY KEY ("doc_id", "module", "key");
ALTER TABLE "core"."document_custom_fields" ALTER COLUMN "key" DROP DEFAULT;
```
`DEFAULT 'base'` нужен только чтобы `NOT NULL` прошёл на существующих строках (все они по определению
base — key до этой миграции не существовал); сразу после — снимается, чтобы БД не молчала при
пропущенном значении.

### 5. `platform-core/src/contracts/backend/document-runtime.ts`
- `EnrichedExtension` получает `key: string` (фронтенду нужен для доступа к своему бакету).

### 6. `platform-core/src/backend/services/document-runtime.ts`
Хелпера-склейки для object-слоя не нужно (вложенность, а не строка). Для list — приватный
`private listColumnKey(ext, field) { return \`${ext.module}:${ext.key}:${field}\` }`.

- `buildListSelect` (:104,106,114) — prefixedKey через `listColumnKey`; SQL-алиас customFields-джойна
  `cf_${ext.module}_${ext.key}` (идентификатор PG — только `[a-z0-9_]`, поэтому `_`, а не `:`).
- `applyJoins` (:146-147) — тот же алиас + условие `and(eq(docId, idColRef), eq(module, ext.module),
  eq(key, ext.key))`.
- `loadExtension` customFields-ветка (:258) — добавить `eq(documentCustomFields.key, ext.key)`.
- `saveExtension` customFields-ветка (:277) — `values({ docId, module, key, values })`,
  `onConflictDoUpdate({ target: [docId, module, key], ... })`.
- `deleteExtensionData` customFields-ветка (:329) — добавить `eq(key, ext.key)`.
- `saveExtensionData` (:301) — `body[ext.module]?.[ext.key]`.
- `getAnyById` (:437) — `data[ext.module] ??= {}; data[ext.module][ext.key] = ...`.
- `exportData` (:554,563,565) — та же вложенность для данных и для `columns`.
- `exportDataFiltered` (:649, :700) — распаковка `prefixedKey.split(':')` из 2 частей в 3
  (`[module, key, field]`); namespace для JSON-структуры экспорта — вложенный, симметрично `exportData`.
- `buildEnrichedPages` (:215) — `EnrichedExtension` получает `key: ext.key`.
- Сообщения об ошибках layout (`normalizeCell`/`normalizeRows`, :162,170,205,212) — добавить key в текст
  (диагностика: с двумя extension'ами одного модуля иначе не понять, какой из них сломан).

### 7. `module-admin/src/frontend/pages/admin-document-card/ui/admin-document-card.tsx`
- `ExtensionData` (:41-45) — добавить `key: string`.
- `seedDefaults` (:93-107) — вложенный seed.
- `updateField(module, fieldKey, value)` (:181) — принимает ещё и `key`, вложенное обновление.
- Рендер: `editData[ext.module]?.[ext.key] ?? {}` (:297), React-key `` `${ext.module}:${ext.key}` `` (:300),
  `setEditData` компонентных ячеек (:327,346) — вложенная замена бакета, `updateField` (:360).

### 8. `module-admin/src/frontend/pages/admin-document-list/lib/table-settings.ts`
- Точечная нормализация legacy-ключей колонок при чтении (по образцу `filtersForType`): ключ ровно с
  одним `:` → `module:base:field`. Применяется к `columnOrders`/`columnSizing`/`columnVisibility`/
  `stickyColumns` и к `column` внутри `FilterTree`.

### Изменений НЕ требует (проверено)
- `module-admin/src/backend/lib/resolve-document-labels.ts` — ключи колонок обрабатывает непрозрачно
  (`Object.entries` → ключ проходит насквозь), `resolveExtension` делает `{ ...ext }`, так что новое
  поле `key` доезжает до фронта само.
- Список (`admin-document-list`) — использует ключи колонок как непрозрачные id (TanStack column id).

## Не в скоупе

- Уникальность в `docs.lists.extend` (её нет и сегодня).
- `ext.remove` — кастомная ветка удаления вызывается как была, `ext.remove(db, id)`; учёт key внутри —
  забота модуля.
- Участие customFields в `exportData`/`importData` — отдельное, ранее принятое ограничение, этим планом
  не пересматривается.
- `extract()`/`NamespaceKey` (`contracts/documents.ts`) — сейчас мёртвый код (грep: ни одного
  конструктора `NamespaceKey`, ни одного вызова `extract`). Форма `NamespaceKey<T>` при вложенности
  становится двухуровневой; трогать до появления первого реального потребителя не нужно, но при его
  появлении ключ обязан быть парой (module, key), а не одной строкой.

## Что вышло иначе, чем в плане

- **Хелпера `extensionNamespace()` нет.** При вложенности склеивать нечего: object-слой адресуется парой
  `data[module][key]`. В рантайме вместо него три приватных метода `DocumentRuntime`: `extKey()`
  (единственное место коалесинга `?? DEFAULT_EXTENSION_KEY` — нужно только для типов, т.к. `key`
  опционален во ВХОДНОМ контракте), `listColumnKey()` и `customFieldsAlias()`.
- **Появился `parseListColumnKey()`** (модульная функция) — обратная операция к `listColumnKey`,
  используется обеими ветками `exportDataFiltered` (CSV-заголовки и JSON-структура).
- **`NamespaceKey`/`extract()` всё-таки обновлены**, хотя план оставлял их «до первого потребителя»:
  `NamespaceKey` стал парой `{ module, key? }`, `extract()` читает `data[module][key]`. Оставить как
  было значило бы оставить API, который молча возвращает бакет всего модуля вместо данных одного
  extension'а — мина для первого же потребителя, а правка стоила пары строк.
- **Задет публичный API карточки для модулей** (в плане не был перечислен): `ToolbarActionProps` и
  `DocumentCardContextValue` несут `editData` трёх уровней и `updateField(module, key, field, value)`.
  Обновлены оба существующих потребителя — `module-auth-password` (change-password) и `module-hr-poll`
  (publish-poll), оба явно передают `DEFAULT_EXTENSION_KEY`.
- **`resolveExportResult`** (`module-admin/backend/lib/resolve-document-labels.ts`) всё же потребовал
  правки — план утверждал, что файл менять не нужно. Это верно для `columns` списка (ключи там
  непрозрачны) и для `resolveExtension` (спред `{ ...ext }` донёс новое поле сам), но `columns`
  экспорта разбирается поэлементно и стал на уровень глубже.
- **Аксессоры настроек таблицы** оформлены как `columnOrderForType`/`columnSizingForType`/
  `columnVisibilityForType`/`stickyColumnsForType` в `table-settings.ts` + `migrateColumnKey`,
  переиспользуемый в `filtersForType`. Все 6 мест чтения в `admin-document-list.tsx` переведены на них.

## Проверка

`pnpm build` (9/9 пакетов), `pnpm test` (31/31), `pnpm check:depcruise` (0 нарушений) — чисто.
`pnpm lint` даёт 4 ошибки и 8 предупреждений, все в незатронутых файлах (`field-widget.tsx`,
`use-swipe-select.ts`, `generic-poll-form.tsx`, `hr-poll/routes.ts`) — существовали до этой правки.

**Против реальной БД не гонялось**, миграция `0003` не применялась. Ни один модуль пока не регистрирует
`key` явно, так что фактически проверен только путь `key = 'base'` (типами и сборкой, не рантаймом).
Нужен smoke-тест: два `extend()` одного модуля с разными key на одном docId — save/read карточки, join
и фильтр в списке, soft/hard delete (в т.ч. что не остаётся висячих строк в `document_custom_fields`),
плюс что старые сохранённые настройки таблицы переживают `migrateColumnKey`.
