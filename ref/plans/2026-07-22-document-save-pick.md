---
title: Типизированный save в document extensions — pickFields
type: plan
tier: 2
status: implemented
date: 2026-07-22
---

# Типизированный save в document extensions — pickFields

> **Частично устарело (2026-08-06).** Поле `DocumentExtension.mode` из этого плана удалено:
> сателлитная таблица теперь всегда пишется upsert-ом, базовая таблица документа — всегда `UPDATE`,
> а расширение без `schema` хранится в базовой таблице документа. См.
> [`plans/2026-08-05-document-model/04-extension-upsert.md`](./2026-08-05-document-model/04-extension-upsert.md).

## Что не так

В `DocumentExtension` тип `save` — `(tx, id, data: Record<string, unknown>) => Promise<void>`.
Из-за этого каждый module extension, которому нужно сохранить поля в свою таблицу, вынужден:

1. **Вручную деструктурировать** каждое поле из `data` с кастом `data as { ... }`
2. **Собирать объект заново** (явно или через `if (x !== undefined) values.x = x`)
3. **Повторять названия полей** в нескольких местах

### module-hr (16 полей — худший случай)

```typescript
// 1. 30 строк деструктуризации с кастом (строки 54–88)
const { code, lastName, firstName, middleName, gender, birthDate,
        hireDate, positionStartDate, terminationDate, isTerminated,
        phone, internalPhone, email, internalEmail,
        residentialAddress, registrationAddress } = data as {
  code?: string; lastName?: string; firstName?: string; // ...
};

// 2. Пересборка (строки 89–106)
const values = { code, lastName, firstName, middleName, gender, birthDate,
                 hireDate, positionStartDate, terminationDate, isTerminated,
                 phone, internalPhone, email, internalEmail,
                 residentialAddress, registrationAddress };
```

Каждое поле названо вручную **дважды** в `save`, плюс ещё по разу в `HR_LIST_FIELDS`,
`HR_LIST_META` и `fields` расширения — до 4 повторений одного ключа.

### module-workflow (4 поля — тот же паттерн)

```typescript
const { code, name, description, isActive } = data as { code?: string; ... };
const values: Record<string, unknown> = {};
if (code !== undefined) values.code = code;
if (name !== undefined) values.name = name;
// ...
```

### module-hr-request (аналогично)

Проблема системная — каждый новый extension будет повторять тот же шаблон.

## Чего добиваемся

1. **Единый источник ключей** — поля перечисляются ровно один раз, компилятор проверяет их наличие в Drizzle-схеме
2. **Тип values от схемы** — `string | null`, `Date | null` и т.д., а не `unknown`
3. **Без ручной деструктуризации** — `pickFields(data, KEYS)` вместо 50 строк destructure + rebuild
4. **Переиспользуемость** — утилита в platform-core, доступна всем модулям

## Варианты

### A. pickFields — утилита в platform-core

Новый файл `packages/platform-core/src/backend/lib/pick.ts`:

```typescript
export function pickFields<T, K extends keyof T>(
  data: Record<string, unknown>,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    const v = data[key as string];
    if (v !== undefined) (result as Record<string, unknown>)[key as string] = v;
  }
  return result;
}
```

Использование:

```typescript
import type { InferInsertModel } from 'drizzle-orm';
import { pickFields } from '@amplicada/platform-core/backend';
import { hrUserProfile } from '../schemas/index.js';

type HRInsert = InferInsertModel<typeof hrUserProfile>;

const HR_SAVE_KEYS = [
  'code', 'lastName', 'firstName', 'middleName', 'gender',
  'birthDate', 'hireDate', 'positionStartDate', 'terminationDate',
  'isTerminated', 'phone', 'internalPhone', 'email', 'internalEmail',
  'residentialAddress', 'registrationAddress',
] as const satisfies readonly (keyof HRInsert)[];

save: async (tx, id, data) => {
  const values = pickFields<Pick<HRInsert, typeof HR_SAVE_KEYS[number]>>(data, HR_SAVE_KEYS);
  // values: Partial<{ code: string | null; lastName: string | null; ... }>
  if (!Object.keys(values).length) return;
  await tx.insert(hrUserProfile)
    .values({ userId: id, ...values })
    .onConflictDoUpdate({ target: hrUserProfile.userId, set: values });
},
```

**Плюсы:**
- Минимум изменений в platform-core (один новый файл)
- Типы от Drizzle-схемы — значения не `unknown`, а конкретные `string | null` и т.д.
- `satisfies readonly (keyof HRInsert)[]` ловит расхождение ключей со схемой на этапе компиляции
- Модули-потребители (workflow, hr-requests) переезжают на ту же утилиту

**Минусы:**
- Ключи всё ещё нужно перечислить один раз в массиве (но это 16 строк вместо 50+)
- `pickFields` не гарантирует, что ключи из массива совпадают с ключами из `fields` extension'а (но `satisfies` закрывает проверку со стороны схемы)

### B. Generic extend

Сделать `DocumentExtension<TFields extends Record<string, FieldMetadata>>`:

```typescript
interface DocumentExtension<TFields extends Record<string, FieldMetadata> = Record<string, FieldMetadata>> {
  fields?: TFields;
  save?: (tx: BackendDbService, id: string, data: Partial<{ [K in keyof TFields]: unknown }>) => Promise<void>;
}
```

Тогда `data` в `save` знает свои ключи:

```typescript
docs.objects.extend('user', {
  fields: { code: { label: 'Код', widget: 'text' }, ... },
  save: (tx, id, data) => {
    // data: Partial<{ code: unknown; lastName: unknown; ... }>
    // ключи известны, значения — unknown
  },
});
```

**Плюсы:**
- Ключи в `data` выведены из `fields` — не нужно поддерживать отдельный массив
- Компилятор заметит, если в `save` используется ключ, которого нет в `fields`

**Минусы:**
- Значения всё равно `unknown` — типы от Drizzle всё равно нужны
- `DocumentObjectRegistry.extend` тоже должен стать generic — цепная реакция изменений в интерфейсах
- `DocumentExtension` хранится в `Map<string, DocumentExtension[]>` — generic стирается, имплементации нужны касты
- Выигрыш в типах только на уровне конкретного вызова `extend()`, но не при итерации экстеншенов в runtime

### C. Комбинация A + B

Типизировать `extend`, чтобы `data` знала ключи, и использовать `pickFields` для фильтрации + приведения типов от схемы.

```typescript
docs.objects.extend('user', {
  module: 'hr',
  group: DocumentGroups.BASE,
  fields: { ...HR_LIST_FIELDS, internalPhone: { ... } },
  save: (tx, id, data) => {
    // data: Partial<{ code: unknown; lastName: unknown; ... internalPhone: unknown }>
    const values = pickFields<HRFields>(data, HR_SAVE_KEYS);
    // values: Partial<HRFields> — типы от Drizzle
  },
});
```

**Плюсы:**
- Двойная проверка: ключи и от `fields`, и от Drizzle-схемы
- data.key подсвечивается в IDE известными полями

**Минусы:**
- Сложность изменений в platform-core (generic на двух интерфейсах)
- На практике `pickFields` + `HR_SAVE_KEYS` + `satisfies` покрывают те же гарантии
- В рантайме generic не существует — усложнение ради типов, которые стираются

## Рекомендация

**Вариант A** (pickFields) — minimum viable improvement для #2 и #3.

Аргументы:
1. Основная боль — ручная деструктуризация 16 полей + каст-тип. `pickFields` убирает это полностью
2. Типы от Drizzle-схемы (`InferInsertModel`) точнее, чем от `FieldMetadata` (`unknown`), так что generic `extend` не даёт лучших типов для значений
3. `satisfies readonly (keyof HRInsert)[]` на массиве ключей даёт ту же compile-time гарантию, что ключи существуют в схеме
4. Generic на `extend` потребует изменения `DocumentObjectRegistry` и `DocumentExtension` — цепная реакция, при этом типы всё равно стираются при хранении в `Map<string, DocumentExtension[]>`
5. module-workflow и module-hr-request переезжают на `pickFields` без изменения их интерфейсов

Generic extend (**B** или **C**) может быть следующим шагом, если появится реальная потребность
в типобезопасной итерации extension'ов или в compile-time проверке соответствия полей UI и БД.

## Изменения в других модулях

Попутно рефакторим существующие save-паттерны:

### module-workflow workflow.ts

```typescript
import type { InferInsertModel } from 'drizzle-orm';
import { pickFields } from '@amplicada/platform-core/backend';

type WFInsert = InferInsertModel<typeof workflows>;
const WF_SAVE_KEYS = ['code', 'name', 'description', 'isActive'] as const satisfies readonly (keyof WFInsert)[];

save: async (tx, id, data) => {
  const values = pickFields<Pick<WFInsert, typeof WF_SAVE_KEYS[number]>>(data, WF_SAVE_KEYS);
  if (!Object.keys(values).length) return;
  await tx.update(workflows).set(values).where(eq(workflows.id, id));
},
```

### module-hr-request request-type.ts

```typescript
type RTInsert = InferInsertModel<typeof hrRequestTypes>;
const RT_SAVE_KEYS = ['code', 'label', 'titleTemplate', 'portalEnabled'] as const satisfies readonly (keyof RTInsert)[];

save: async (tx, id, data) => {
  const values = pickFields<Pick<RTInsert, typeof RT_SAVE_KEYS[number]>>(data, RT_SAVE_KEYS);
  if (values.titleTemplate === '') values.titleTemplate = null; // единственная special-case логика
  if (!Object.keys(values).length) return;
  await tx.update(hrRequestTypes).set(values).where(eq(hrRequestTypes.id, id));
},
```

## Дублирование ключей в UI-метаданных (#1)

`HR_LIST_FIELDS` (виджеты формы), `HR_LIST_META` (колонки таблицы) и новый `HR_SAVE_KEYS` (ключи для БД)
содержат одни и те же строки. Полностью автоматизировать не выйдет — лейблы, виджеты и размеры колонок
не хранятся в Drizzle-схеме, это UI-константы.

Минимальная защита — добавить `satisfies`-проверку для `HR_LIST_FIELDS` и `HR_LIST_META`:

```typescript
const HR_LIST_FIELDS = {
  code: { label: 'Табельный номер', widget: 'text' },
  // ...
} as const satisfies Partial<Record<(typeof HR_SAVE_KEYS)[number], { label: string; widget: string }>>;
```

Это не убирает дублирование, но делает его **безопасным** — если ключ появляется в `HR_SAVE_KEYS`,
но отсутствует в `HR_LIST_FIELDS` (или наоборот) — ошибка компиляции.

## Порядок имплементации

1. **Создать** `packages/platform-core/src/backend/lib/pick.ts` — `pickFields`
2. **Экспортировать** из `packages/platform-core/src/backend/index.ts`
3. **Рефакторинг** `module-hr/src/backend/documents/user.ts` — `HR_SAVE_KEYS`, `pickFields`, `satisfies` на UI-метаданных
4. **Рефакторинг** `module-workflow/src/backend/documents/workflow.ts` — то же для 4 полей
5. **Рефакторинг** `module-hr-request/src/backend/documents/request-type.ts` — то же для 4 полей, special-case `titleTemplate`
6. **Проверка** `pnpm typecheck` во всех изменённых пакетах

## Реализовано (вариант D — schema-driven load/save, отличается от рекомендации)

По ходу обсуждения выяснилось, что исходная цель шире, чем убрать boilerplate деструктуризации:
`fields` в `DocumentExtension` должен остаться единственным местом, где описывается **метаинформация**
над колонкой (label, widget, readonly, ...), а `load`/`save` для случая "просто читаем/пишем строку
таблицы по id" не должны писаться вручную вообще — ни как деструктуризация, ни как вызов утилиты.
Кастомный `load`/`save` нужен только когда логика отличается от простой схемы (JOIN, вычисляемые поля,
как `docs.objects.extend(Documents.USER_GROUP, { component: 'user-group-members', load: ...join... })`
в `user-group.ts`).

### Механизм

`DocumentExtension` (`packages/platform-core/src/contracts/documents.ts`) получил три новых опциональных поля:

```typescript
export interface DocumentExtension {
  // ...
  // biome-ignore lint/suspicious/noExplicitAny: runtime Drizzle table, backend-only
  schema?: any;                    // drizzle-таблица для авто load/save
  idColumn?: string;               // колонка, сопоставляемая с docId. default 'id'
  mode?: 'update' | 'upsert';      // upsert = insert + onConflictDoUpdate. default 'update'
}
```

`schema?: any`, а не `Table` из `drizzle-orm` — намеренно, чтобы не тащить реальный Drizzle-тип
в `contracts/documents.ts` (файл шарится между backend и frontend через `./contracts` export).
Тот же паттерн уже использовался для `DocumentType.schema`/`ListExtension.schema`. Проверено:
frontend нигде не импортирует `@amplicada/*/backend`, `apps/web/package.json` не содержит `drizzle-orm`,
`DocumentExtension` экспортируется как `export type` (стирается при сборке) — leak невозможен.

Сама логика — в `DocumentRuntime` (`packages/platform-core/src/backend/services/document-runtime.ts`):
два приватных резолвера `loadExtension`/`saveExtension`. Если `ext.load`/`ext.save` заданы явно —
используются они (как раньше). Если нет, но есть `ext.schema` — рантайм сам:
- **load**: `select().from(schema).where(eq(idCol, docId)).limit(1)`, вырезает `idColumn` из результата;
- **save**: берёт из `data` только те ключи, что реально есть колонками таблицы (`getTableColumns`),
  игнорирует `undefined`; при `mode: 'upsert'` — `insert().onConflictDoUpdate()`, иначе `update().set()`.

Резолверы вызываются из тех же 4 точек, где раньше были прямые `ext.load(...)`/`ext.save(...)`:
`saveExtensionData`, `getById`, `exportData` (было `if (ext.load)`, стало `if (ext.load || ext.schema)`).

**Можно смешивать** — `schema` даёт авто-load, а `save` при этом остаётся ручным для спецкейса
(так сделано в `request-type.ts`: `titleTemplate: '' → null` не выражается декларативно).

### Итог по файлам

- `user.ts` (module-hr): 70 строк load+save → `schema: hrUserProfile, idColumn: 'userId', mode: 'upsert'`
- `workflow.ts` (module-workflow): load+save → `schema: workflows` (idColumn/mode — дефолты)
- `user-group.ts` (platform-core), базовый extend: load+save → `schema: userGroups`; members-extend
  (JOIN) не тронут — там нет `schema`, только кастомный `load`
- `request-type.ts` (module-hr-request): добавлен `schema: hrRequestTypes` для авто-load,
  `save` оставлен ручным (спецкейс `titleTemplate`)

### Почему не вариант A (pickFields + satisfies)

`pickFields` из варианта A всё ещё требовал перечислить ключи в массиве `HR_SAVE_KEYS` (один раз,
но вручную) и явно вызвать утилиту в каждом `save`. Реализованный механизм убирает перечисление
полностью — ключи берутся из `getTableColumns(schema)` в рантайме, `load`/`save` для простого
case'а не пишутся вообще. Цена — типобезопасность на входе `data` слабее, чем `satisfies keyof Insert`
из варианта A: опечатка в имени поля не поймается компилятором, просто будет молча проигнорирована
резолвером (ключа нет в `getTableColumns`, значит не запишется). Для проекта это приемлемый компромисс:
`fields` и колонки схемы и так расходятся редко, а выигрыш в лаконичности — кардинальный.
