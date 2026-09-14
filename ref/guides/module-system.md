---
title: Module System & Patterns
type: guide
tier: 3
status: implemented
date: 2026-07-13
source: clean/03-modules (main2, frontend-core-plan, current code)
---

# Module System & Patterns

> Source: main2, frontend-core-plan, current code

---

## Module Structure (DDD Vertical Slice)

Each module is a self-contained package with all layers:

```text
module-name/
  src/
    frontend/       React components, pages, setup
    backend/        Routes, services, schema, plugin
    contracts/      Shared types (DTO, events, commands)
    shared/         Validators, enums, constants (optional)
  migrations/       Per-module SQL migrations
  package.json
  tsconfig.json
```

One package per module — not split into `module-frontend` and `module-backend`.

```text
// Why one package? Because changes stay in one directory.
// Not this:
packages/frontend/audio
packages/backend/audio
// But this:
packages/module-audio-question/
```

## What Goes Where

### contracts/

Shared types used by both backend and frontend:

```text
contracts/
  dto.ts          Data Transfer Objects (request/response shapes)
  events.ts       Event type definitions
  permissions.ts  Permission constants
  api.ts          API contract types
  models.ts       Domain models
```

This is the most important layer — it's the public API between frontend and backend, and between modules.

### shared/

Optional. Validators, Zod schemas, enums, constants, utils:

```text
shared/
  validators.ts   Zod schemas for validation
  zod.ts          Shared Zod refinements
  enums.ts        Business enums (QuestionType, AssessmentStatus)
  constants.ts    Magic numbers, limits
  utils.ts        Pure functions
```

### frontend/

Only React. No Fastify, no Drizzle, no Node.js APIs.

### backend/

Only Fastify. No React, no DOM APIs.

### migrations/

Per-module SQL migrations. Each folder has its own `_journal.json`. Tracked separately per module.

## Subpath Exports Pattern

Each package publishes separate entry points:

```json
{
  "exports": {
    "./backend": { "types": "...", "import": "..." },
    "./frontend": { "types": "...", "import": "..." },
    "./contracts": { "types": "...", "import": "..." }
  }
}
```

Import separation prevents React from leaking into backend:

```ts
// Backend
import { SomeModule } from "@amplicada/some-module/backend"

// Frontend
import { SomeModule } from "@amplicada/some-module/frontend"
```

## Core Package Structure

`@amplicada/platform-core` uses subpath exports for internal separation:

```
@amplicada/platform-core               contracts (shared types)
@amplicada/platform-core/contracts     same as above
@amplicada/platform-core/contracts/backend   backend-specific types
@amplicada/platform-core/contracts/frontend  frontend-specific types
@amplicada/platform-core/backend       implementations (Fastify, Drizzle, etc.)
@amplicada/platform-core/frontend      React core (registries, components, layouts, primitives)
```

Modules import only what they need:

```ts
// Backend module
import type { BackendModule, DbService } from "@amplicada/platform-core/contracts/backend"
import { identityUser } from "@amplicada/platform-core/backend"

// Frontend module
import type { FrontendModule } from "@amplicada/platform-core/contracts/frontend"
```

## Backend Module Pattern (BackendModule)

```ts
export const myModule: BackendModule = {
  id: "my-module",
  name: "My Module",
  version: "1.0.0",

  setup(context) {
    // Register migrations
    context.migrations.register("my-module", migrationsPath)

    // Register services
    const db = context.services.resolve<DbService>("db")
    context.services.register("my-service", new MyService(db))

    // Register routes
    context.routes.register("get", "/api/my/stuff", handler)
  },
}
```

## Frontend Module Pattern (FrontendModule)

```ts
import type { FrontendModule } from "@amplicada/platform-core/contracts/frontend"

export const myFrontendModule: FrontendModule = {
  id: "my-module",
  name: "My Module (Frontend)",
  version: "1.0.0",

  setup(context) {
    context.routes.register("/my-page", <MyPage />, { layout: "app" })
    context.slots.register("my:component", MyComponent)
    context.extensions.contribute("my:point", { component: MyExtension })
    context.navigation.register({ id: "my-nav", label: "My Page", path: "/my-page" })
    context.layouts.register("custom", CustomLayout)
    context.services.register("my-service", new MyService())
    context.eventBus.on("my:event", handler)
    context.lifecycle.register({ name: "init", phase: "after", handler: () => {} })
  },

  start() {
    // Called after all modules have been set up
  },

  stop() {
    // Cleanup (not currently called by bootstrapFrontend)
  },
}
```

## BackendSetupContext

`BackendSetupContext` — контейнер для бэкенд-части. Доступен в `setup()` каждого `BackendModule`.

| Registry | Тип | Методы |
|----------|-----|--------|
| `services` | `ServiceRegistry` | `register(token, service)`, `resolve(token)`, `has(token)` |
| `routes` | `BackendRouteRegistry` | `register(method, path, handler)` |
| `extensions` | `BackendExtensionPointRegistry` | `contribute(pointId, contribution)` |
| `registry` | `BackendRegistry` | Generic type registry |
| `modules` | `BackendModuleRegistry` | `register(module)`, `getAll()` |
| `eventBus` | `EventBus` | `on(event, handler)`, `off(event, handler)`, `emit(event, data)` |
| `lifecycle` | `Lifecycle` | `register(hook)`, `execute(name)` |
| `pipeline` | `BackendPipeline` | Pipeline for data transformation |
| `migrations` | `BackendMigrationRegistry` | `register(id, path)` |
| `documents` | `DocumentRegistry` | Document type/pages/groups registration |

## FrontendSetupContext

`FrontendSetupContext` — это DI-контейнер для фронтенд-части. Доступен в `setup()` каждого `FrontendModule`.

| Registry | Тип | Методы |
|----------|-----|--------|
| `layouts` | `FrontendLayoutRegistry` | `register(name, Component)`, `get(name)` |
| `routes` | `FrontendRouteRegistry` | `register(path, element, opts?)`, `getAll()` |
| `slots` | `FrontendSlotRegistry` | `register(name, Component)`, `override(name, Component)`, `get(name)`, `has(name)` |
| `extensions` | `FrontendExtensionPointRegistry` | `contribute(pointId, contribution)`, `getAll(pointId)` |
| `navigation` | `FrontendNavigationRegistry` | `register(item)`, `getAll()` |
| `modules` | `FrontendModuleRegistry` | `register(module)`, `getAll()`, `getById(id)` |
| `services` | `ServiceRegistry` | `register(token, service)`, `resolve(token)`, `has(token)` |
| `eventBus` | `EventBus` | `on(event, handler)`, `off(event, handler)`, `emit(event, data)` |
| `lifecycle` | `Lifecycle` | `register(hook)`, `execute(name)` |

`createFrontendApp()` создаёт все registry, регистрирует встроенные layouts (`public`, `app`) и API-клиент. `bootstrapFrontend(modules, context)` запускает модули: `register → setup (все) → start (все)`.

## ModuleRoutes + Layout Grouping

```tsx
import { ModuleRoutes } from "@amplicada/platform-core/frontend"

// ModuleRoutes группирует все зарегистрированные routes по полю layout:
// - routes без layout рендерятся напрямую
// - routes с layout — оборачиваются в <Route element={<Layout />}>
// - Если layout не зарегистрирован — console.warn + fallback (route без layout)
//
// См. packages/platform-core/src/frontend/components/module-routes.tsx
```

## Dependency & Import Graph

```
@amplicada/platform-core                         (единый пакет)
  └── contracts                         (типы, без зависимостей)
      ├── shared                        (event-bus, lifecycle, pipeline, registry, service-registry)
      ├── backend                       (auth, db, module, route-registry, setup, migration)
      └── frontend                      (module, setup, route-registry, slot-registry,
                                          extension-point, navigation, layout-registry, module-registry)
  ├── backend                           (fastify, pg, drizzle-orm)
  └── frontend                          (react, react-dom, @tanstack/react-query)

@amplicada/module-{name}
  ├── backend  ← depends on: @amplicada/platform-core/contracts/backend, peer: platform-core/backend
  └── frontend ← depends on: @amplicada/platform-core/contracts/frontend, peer: platform-core/frontend

@amplicada/app-api  ← composes backend modules
@amplicada/app-web  ← composes frontend modules
```

```ts
// Backend module
import type { BackendModule, DbService } from "@amplicada/platform-core/contracts/backend"
import { identityUser } from "@amplicada/platform-core/backend"

// Frontend module
import type { FrontendModule } from "@amplicada/platform-core/contracts/frontend"
import { useFrontendContext } from "@amplicada/platform-core/frontend"

// apps/api
import { createApp, bootstrap } from "@amplicada/platform-core/backend"

// apps/web
import { createFrontendApp, bootstrapFrontend, FrontendProvider, ModuleRoutes } from "@amplicada/platform-core/frontend"
```

## Tailwind CSS v4 + Modules

В Tailwind v4 классы генерируются на основе сканирования исходников. Чтобы модуль работал, нужно:

### 1. Создать tailwind.css в модуле

```css
/* packages/module-{name}/src/frontend/tailwind.css */
@source "../";
```

Директива `@source "../"` указывает Tailwind сканировать папку `src/frontend/` модуля на предмет использования Tailwind-классов. Без этого Tailwind не увидит классы из модуля и не сгенерирует для них CSS.

### 2. Экспортировать tailwind.css в package.json

```json
{
  "exports": {
    "./frontend/tailwind.css": "./src/frontend/tailwind.css"
  }
}
```

### 3. Импортировать в index.css приложения

```css
/* apps/web/src/index.css */
@import "@amplicada/platform-core/frontend/styles/base.css";  /* @import "tailwindcss" + theme */
@import "@amplicada/platform-core/frontend/tailwind.css";     /* core source scan */
@import "@amplicada/module-auth-password/frontend/tailwind.css";
@import "@amplicada/module-hr/frontend/tailwind.css";
```

Порядок:
- `base.css` — единственное место, где вызывается `@import "tailwindcss"` (ядро Tailwind + shadcn + theme tokens)
- `tailwind.css` модулей — только `@source` для сканирования файлов

Если новый модуль не добавить в `index.css` приложения — его Tailwind-классы не будут сгенерированы.

## Demo Application

A reference application in the repo that uses all official modules. Its purposes:

- Example of platform usage
- SDK demonstration
- Integration tests
- Manual testing of new features
- Reference implementation

```ts
// apps/demo/src/index.ts
import { createApp, bootstrap } from "@amplicada/platform-core/backend"
import { authPasswordModule } from "@amplicada/module-auth-password/backend"
// import { hrModule } from "@amplicada/module-hr/backend"
// import { testingModule } from "@amplicada/module-testing/backend"

const { app, context } = await createApp()
await bootstrap(app, [authPasswordModule /*, hrModule, testingModule */], context)
```
