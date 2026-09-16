---
title: Module Structure
type: guide
tier: 3
status: implemented
date: 2026-09-16
source: clean/07-module-structure
---

# Module Structure

## Ожидаемая структура

```
packages/module-{name}/
├── package.json
├── tsconfig.json
├── migrations/              # SQL миграции (если нужны)
│   └── 0000_*.sql
└── src/
    ├── contracts/           # Модульные типы (LoginRequest, LoginResponse и т.д.)
    │   ├── index.ts         # Re-export
    │   ├── manifest.ts      # Module identity: id, name, version (from package.json)
    │   └── types.ts         # Определения типов
    ├── backend/
    │   ├── setup.ts         # BackendModule определение (id, name, version, setup)
    │   ├── index.ts         # Re-export из setup.ts + schemas/services/documents
    │   ├── services/        # Публичные сервисы, регистрируемые через context.services.register()
    │   │   ├── index.ts     # Barrel
    │   │   ├── engine.ts    # WorkflowEngine
    │   │   └── plugin.ts    # PasswordAuthProvider
    │   ├── schemas/         # Drizzle ORM схемы — одна сущность = один файл
    │   │   ├── index.ts     # Barrel: re-export всех таблиц и типов
    │   │   ├── identity-user.ts
    │   │   └── ...
    │   ├── documents/       # Document registration — одна сущность = один файл
    │   │   ├── index.ts     # Barrel entity-функций
    │   │   ├── user.ts
    │   │   └── ...
    │   └── ...              # routes.ts, routes/, errors.ts, conditions.ts и т.д.
    └── frontend/              # Feature-Sliced Design v2.1 — см. ADR-003
        ├── setup.tsx         # FrontendModule определение (id, name, version, setup)
        ├── index.ts          # Баррель-экспорт публичного API модуля
        ├── tailwind.css      # @source "../" для Tailwind scanning
        ├── app/              # App-level: провайдеры, лэйауты (только если специфичны для модуля)
        │   └── layouts/
        ├── pages/            # Срезы роут-уровня; каждая папка = FSD-слайс
        │   └── <name>/
        │       ├── index.ts  # Public API слайса
        │       └── ui/
        │           └── <name>.tsx
        ├── widgets/          # Крупные составные UI-блоки, переиспользуемые на 2+ страницах
        │   └── <name>/
        │       ├── index.ts
        │       └── ui/
        │           └── <name>.tsx
        ├── features/         # Пользовательские интеракции, переиспользуемые на 2+ страницах
        │   └── <name>/
        │       ├── index.ts
        │       └── ui/
        │           └── <name>.tsx
        ├── entities/         # Бизнес-доменные модели (редко; только при подтверждённом multi-use)
        ├── shared/           # Внутримодульные утилиты (большая часть shared — из platform-core)
        │   └── lib/
        └── components/       # Только в platform-core: app-level компоненты (ExtensionPoint, ModuleRoutes)
```

## Паттерны

### Module Manifest (contracts/manifest.ts)

В package.json: `amplicada: true`; стороны и CSS обнаруживаются по exports,
порядок — по пакетным dependencies/peers. Идентичность хранится в коде:

```ts
import packageJson from '../../package.json' with { type: 'json' };

export const moduleManifest = { id: 'example', name: 'Example', version: packageJson.version };
```

Обе стороны используют moduleManifest. Их публичные index.ts экспортируют объект
регистрации под именем `module`: `export { myModule as module } from './setup.js'`.
Generated-код добавляет dependencies; вручную их повторять не нужно.
См. [application-composition.md](application-composition.md).

### BackendModule (setup.ts)

```ts
import type { BackendModule, BackendDbService } from "@amplicada/platform-core/contracts/backend"
import { moduleManifest } from "../contracts/manifest.js"

export const myModule: BackendModule = {
  ...moduleManifest,

  setup(context) {
    context.migrations.register("my-module", migrationsPath)
    const db = context.services.resolve<BackendDbService>("db")
    context.services.register("my-service", new MyService(db))
    context.routes.register("get", "/api/my", myHandler)
  },
}
```

### FrontendModule (setup.tsx)

```tsx
import type { FrontendModule } from "@amplicada/platform-core/contracts/frontend"
import { moduleManifest } from "../contracts/manifest.js"
import { MyPage } from "./my-page.js"

export const myFrontendModule: FrontendModule = {
  ...moduleManifest,

  setup(context) {
    context.routes.register("/my", <MyPage />)
    context.slots.register("my:content", MyPage)
    context.navigation.register({
      label: "My Page",
      path: "/my",
      icon: "my-icon",
    })
  },
}
```

### index.ts (re-export)

```ts
// backend/index.ts
export { myModule } from "./setup.js"
export { MyService } from "./service.js"

// frontend/index.ts
export { myFrontendModule } from "./setup.js"
export { MyPage } from "./pages/my/index.js"
export { MyWidget } from "./widgets/my-widget/index.js"
```

## FSD Conventions for Frontend

Каждый модуль следует Feature-Sliced Design v2.1 (ADR-003) для структуры `src/frontend/`.

### Правила слоёв

Импорт только вниз по слоям: `app → pages → widgets → features → entities → shared`

```
app/  →  pages/  →  widgets/  →  features/  →  entities/  →  shared/
```

- Слой может импортировать любой слой ниже (кроме самого себя на том же уровне)
- Cross-import между слайсами одного слоя запрещён
- `shared/` не содержит бизнес-логики — только утилиты и инфраструктуру
- `platform-core` является внешним `shared/` + `app/` слоем для всех модулей

### Public API каждого слайса

Каждый слайс экспортирует только через `index.ts`. Прямые импорты внутренних файлов запрещены:

```ts
// ✅ Correct
import { LoginPage } from '../pages/login/index.js';
import { GenericRequestForm } from '../../features/request-form/index.js';

// ❌ Violation
import { LoginPage } from '../pages/login/ui/login-page.js';
```

### Domain-based naming

Файлы именуются по домену, а не по технической роли:

```
// ❌ Technical-role names
model/types.ts
model/utils.ts

// ✅ Domain-based names
model/user.ts
model/order.ts
api/fetch-profile.ts
```

### Когда создавать слой

| Слой | Когда создавать |
|------|----------------|
| `pages/<name>/` | Всегда, когда есть роут |
| `widgets/<name>/` | Компонент используется на 2+ страницах |
| `features/<name>/` | Интеракция (форма, диалог) используется на 2+ страницах |
| `entities/<name>/` | Доменная модель потребляется 2+ слайсами |
| `shared/` | Внутримодульные утилиты (большая часть shared — из platform-core) |
| `app/` | Лэйауты или провайдеры, специфичные для модуля |

**Golden Rule:** Когда сомневаешься, держи код в `pages/`. Извлекай в нижние слои только при подтверждённом multi-use.

### Миграция с components/

Существующие модули мигрируются инкрементально:

1. `components/` → `widgets/` (крупные UI-блоки) или `features/` (интеракции)
2. `pages/<name>.tsx` → `pages/<name>/ui/<name>.tsx` + `pages/<name>/index.ts`
3. Одноразовые компоненты остаются в `components/` внутри слайса страницы
4. Обновляются импорты в `setup.tsx` и `index.ts`
5. Старые файлы удаляются

## Drizzle Schema

Каждая таблица БД — отдельный файл в `src/backend/schemas/`. Barrel `index.ts` реэкспортирует все таблицы и типы.

### Конвенции

- Один файл = одна сущность (название файла — kebab-case: `identity-user.ts`, `password-credential.ts`)
- **Каждый пакет владеет своей PG-схемой** (`core`, `hr`, `workflow`, ...): инстанс `pgSchema('<name>')` в `schemas/_schema.ts`, таблицы объявляются через `<schema>.table(...)`, а не `pgTable(...)`. Drizzle квалифицирует запросы сам — `search_path` не нужен. Имя схемы = moduleId с дефисами → underscore.
- Файлы, ссылающиеся на другие таблицы этого же модуля, импортируют их напрямую из соседнего файла (не из `index.ts`), чтобы избежать циклических зависимостей
- Cross-package / cross-schema FK — импорт таблицы через barrel пакета: `@amplicada/platform-core/backend` (FK — уровень БД, в ручных миграциях пишется `REFERENCES "core"."identity_user"(...)`)
- Все типы экспортируются: `typeof table.$inferSelect` и `typeof table.$inferInsert`
- `index.ts` переэкспортирует все таблицы и типы из директории (`_schema.ts` — внутренний, не реэкспортируется)

### Пример

```ts
// schemas/_schema.ts — один инстанс схемы на пакет
import { pgSchema } from 'drizzle-orm/pg-core';

export const coreSchema = pgSchema('core');
```

```ts
// schemas/identity-user.ts
import { timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';

export const identityUser = coreSchema.table('identity_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  login: varchar('login', { length: 255 }).unique().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type IdentityUser = typeof identityUser.$inferSelect;
```

```ts
// schemas/group-users.ts (внутримодульная зависимость — прямой импорт файла)
import { primaryKey, uuid } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';
import { identityUser } from './identity-user.js';
import { userGroups } from './user-groups.js';

export const groupUsers = coreSchema.table('group_users', {
  groupId: uuid('group_id').references(() => userGroups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => identityUser.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.groupId, t.userId] })]);
```

```ts
// schemas/index.ts — barrel
export { identityUser } from './identity-user.js';
export type { IdentityUser } from './identity-user.js';
export { passwordCredential } from './password-credential.js';
export type { PasswordCredential, NewPasswordCredential } from './password-credential.js';
export { groupUsers } from './group-users.js';
```

```ts
// backend/index.ts — импорт из barrel schemas
export { identityUser, passwordCredential } from './schemas/index.js';
```

### Импорт через другой модуль

```ts
import { identityUser } from '@amplicada/platform-core/backend';
import { processInstances } from '@amplicada/module-workflow/backend';
```

**Важно:** Drizzle используется как type-safe query builder — `relations()` не применяются, связи только через FK в схеме. Централизованный schema object не создаётся (тип `NodePgDatabase<Record<string, never>>`).

## Document Registration

Каждый модуль, у которого есть document-сущности (регистрация новых типов документов или расширение существующих), размещает их в `src/backend/documents/`. Один файл = одна сущность.

### Конвенции

- Один файл = одна entity (название файла — kebab-case: `user.ts`, `scheduled-task.ts`, `process-instance.ts`)
- Файл содержит всё, что относится к entity: `docs.register()`, `registerPage()`, `registerGroup()`, `objects.extend()`, `lists.extend()`
- Экспортируется одна функция на entity: `register{EntityName}Doc(docs: DocumentRegistry): void`
- Модули, которые только расширяют существующий документ, экспортируют `extend{DocumentName}Doc(docs: DocumentRegistry): void`
- `index.ts` — barrel, реэкспортирует все entity-функции; если нужна агрегатная функция для вызова из setup — определяется здесь же
- В `setup.ts` вызывается entity-функция (или агрегат) одним вызовом: `registerWorkflowDoc(context.documents)`
- Если entity-функций несколько, их можно вызывать по одной или обернуть в агрегат

### Пример

У типа документа нет собственной таблицы: `docs.register()` — чистое описание, а таблица
модуля-владельца объявляется обычным `objects.extend({ schema, idColumn })`, наравне с расширениями
других модулей. Единственная общая таблица — `core.document_index`, из неё же читаются списки.

```ts
// documents/workflow.ts — регистрация нового документа
import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { WorkflowDocuments, WorkflowGroups, WorkflowPages } from '../../contracts/documents.js';
import { workflows } from '../schemas/index.js';

export function registerWorkflowDoc(docs: DocumentRegistry): void {
  docs.register(WorkflowDocuments.WORKFLOW, {
    label: 'Процессы (шаблоны)',
    creatable: true,
    deletable: false,
  });

  docs.objects.registerPage(WorkflowPages.WORKFLOW_CARD, {
    document: WorkflowDocuments.WORKFLOW,
    label: 'Основная информация',
  });

  docs.objects.registerGroup(WorkflowGroups.WORKFLOW_BASE, {
    document: WorkflowDocuments.WORKFLOW,
    page: WorkflowPages.WORKFLOW_CARD,
    label: 'Основное',
    order: 0,
  });

  // Таблица владельца — такое же расширение. Ручные load/save нужны только для нестандартной
  // логики (JOIN, валидация); по одной schema рантайм читает и пишет сам.
  docs.objects.extend(WorkflowDocuments.WORKFLOW, {
    module: 'workflow',
    group: WorkflowGroups.WORKFLOW_BASE,
    schema: workflows,
    idColumn: 'id',
    fields: {
      code: { label: 'Код', widget: 'text', required: true },
      name: { label: 'Название', widget: 'text', required: true },
    },
  });

  docs.lists.extend(WorkflowDocuments.WORKFLOW, {
    module: 'workflow',
    schema: workflows,
    foreignKey: 'id',
    fields: {
      code: { label: 'Код', type: 'text', size: 160 },
      name: { label: 'Название', type: 'text', size: 240 },
    },
  });
}
```

```ts
// documents/user.ts — расширение существующего документа (модуль module-hr)
import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups } from '@amplicada/platform-core/contracts';
import { eq } from 'drizzle-orm';
import { hrUserProfile } from '../schemas/index.js';

export function extendUserDoc(docs: DocumentRegistry): void {
  docs.objects.extend('user', {
    module: 'hr',
    group: DocumentGroups.BASE,
    fields: { /* ... */ },
    load: async (db, docId) => { /* ... */ },
    save: async (tx, id, data) => { /* ... */ },
  });

  docs.lists.extend('user', {
    module: 'hr',
    fields: { /* ... */ },
    schema: hrUserProfile,
    foreignKey: 'userId',
  });
}
```

```ts
// documents/index.ts — barrel + агрегатная функция
import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { registerUserDoc } from './user.js';
import { registerUserGroupDoc } from './user-group.js';
import { registerScheduledTaskDoc } from './scheduled-task.js';

export { registerUserDoc } from './user.js';
export { registerUserGroupDoc } from './user-group.js';
export { registerScheduledTaskDoc } from './scheduled-task.js';

export function registerCoreDocuments(docs: DocumentRegistry): void {
  registerUserDoc(docs);
  registerUserGroupDoc(docs);
  registerScheduledTaskDoc(docs);
}
```

```ts
// backend/index.ts — реэкспорт entity-функций
export { registerWorkflowDoc, registerProcessInstanceDoc } from './documents/index.js';
```

### Импорт из другого модуля

```ts
import { registerWorkflowDoc } from '@amplicada/module-workflow/backend';
```

### Вызов в setup.ts

```ts
// Если одна entity
import { extendUserDoc } from './documents/index.js';
extendUserDoc(context.documents);

// Если несколько — через агрегат
import { registerWorkflowDocuments } from './documents/index.js';
registerWorkflowDocuments(context.documents);
```

## Tailwind CSS scanning

Каждый модуль должен иметь `src/frontend/tailwind.css`:

```css
@source "../";
```

Потребитель импортирует эти файлы:

```css
/* apps/web/src/index.css */
@import "@amplicada/platform-core/frontend/tailwind.css";
@import "@amplicada/module-auth-password/frontend/tailwind.css";
```

## Package.json

```json
{
  "name": "@amplicada/module-{name}",
  "amplicada": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    "./backend": {
      "types": "./dist/backend/index.d.ts",
      "import": "./dist/backend/index.js"
    },
    "./frontend": {
      "types": "./dist/frontend/index.d.ts",
      "import": "./dist/frontend/index.js"
    },
    "./contracts": {
      "types": "./dist/contracts/index.d.ts",
      "import": "./dist/contracts/index.js"
    },
    "./frontend/tailwind.css": "./src/frontend/tailwind.css"
  },
  "peerDependencies": {
    "@amplicada/platform-core": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@amplicada/platform-core": "workspace:*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^6.0.0"
  }
}
```

**Важно:**
- `"."` export не используется — потребители импортируют только через явные subpath: `./backend`, `./frontend`, `./contracts`
- `contracts/` — это shared-типы ДАННОГО модуля (DTO, event types, константы). ⚠️ **Запрещено импортировать из `./backend/` или `./frontend/`** — contracts должен быть безопасен для обеих сторон
- `@amplicada/platform-core` — peerDependency + devDependency
- `react`, `react-dom` — peerDependency + devDependency

### Что экспортировать

| Файл | Обязательно | Опционально |
|------|------------|-------------|
| `backend/index.ts` | module definition (`module`) | Drizzle schema, document registration функции, публичные сервисы |
| `backend/services/index.ts` | — | Barrel service-реализаций (engine, registry, plugin) |
| `backend/documents/index.ts` | — | Barrel entity-функций регистрации документов |
| `backend/schemas/index.ts` | — | Barrel Drizzle таблиц и типов |
| `frontend/index.ts` | module definition (`module`) | Публичные компоненты, хуки, registry API |
| `contracts/index.ts` | Всё, что нужно и backend и frontend | DTO, event types, константы, Zod схемы |

## Конвенции именования

### Backend (contracts/backend/)
- `BackendModule` — интерфейс модуля
- `BackendSetupContext` — контекст setup
- `BackendAuthProvider` — провайдер авторизации
- `BackendAuthService` — сервис авторизации
- `BackendDbService` — сервис БД
- `BackendRegistry`, `BackendRegistryKey`, `BackendRegistryEntry` — реестр
- `BackendPipeline`, `BackendPipelineStage` — пайплайн
- `BackendRouteHandler`, `BackendRouteDefinition`, `BackendRouteRegistry` — маршруты
- `BackendExtensionPointRegistry` — точки расширения
- `BackendMigrationEntry`, `BackendMigrationRegistry` — миграции

### Frontend (contracts/frontend/)
- `FrontendModule` — интерфейс модуля
- `FrontendSetupContext` — контекст setup
- `FrontendModuleRegistry` — реестр модулей
- `FrontendRouteDefinition`, `FrontendRouteRegistry` — маршруты
- `FrontendSlotRegistry` — слоты
- `FrontendExtensionPointRegistry` — точки расширения
- `FrontendNavigationRegistry` — навигация

### Shared (contracts/)
- `User`, `AuthResult` — авторизация
- `EventBus`, `EventBusEvent`, `EventHandler` — события
- `Lifecycle`, `LifecycleHook` — жизненный цикл
- `ServiceRegistry` — реестр сервисов

## Потребление

### В приложении (apps/web)

```tsx
import { createFrontendApp, bootstrapFrontend } from '@amplicada/platform-core/frontend';
import { modules } from './generated/frontend-modules.js';

const { context } = createFrontendApp();
await bootstrapFrontend(modules, context);
```

### В API (apps/api)

```ts
import { createApp, bootstrap } from '@amplicada/platform-core/backend';
import { modules } from './generated/backend-modules.js';

const { app, context } = await createApp();
await bootstrap(app, modules, context);
```
