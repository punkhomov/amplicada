---
title: Реорганизация core/sdk + Фронтенд-ядро
type: plan
tier: 4
status: implemented
date: 2026-07-13
---

# План: Реорганизация core/sdk + Фронтенд-ядро

> **Статус:** Implemented — знания мигрированы в `guides/module-system.md` (FrontendSetupContext, ModuleRoutes, граф зависимостей, lifecycle)
>
> Этот документ описывает план реорганизации пакетов `platform-core` и `platform-sdk` в единый пакет `core/{contracts,backend,frontend}` и создания фронтенд-ядра с модульной регистрацией компонентов, маршрутов и UI-слотов.

---

## Контекст

Текущая архитектура:
- `packages/platform-sdk` — типы (контракты)
- `packages/platform-core` — бэкенд-реализации (Fastify, Drizzle, PG)
- `packages/module-auth-password` — первый модуль (backend + frontend)
- `apps/api` — Fastify-сервер, использует `platform-core`
- `apps/web` — React SPA с хардкодом маршрутов

Цель:
- Объединить `platform-core` и `platform-sdk` в один пакет `packages/core/`
- Добавить `core/frontend` — фронтенд-ядро с модульной регистрацией
- Модули регистрируют маршруты, компоненты, навигацию, extension points
- `apps/web` остаётся обычным React-приложением

---

## Целевая структура пакета

```
packages/core/
  package.json                # @amplicada/platform-core
  tsconfig.json
  src/
    contracts/                # Типы (контракты)
      index.ts                # re-export backend + frontend + shared
      # Shared (без внешних зависимостей)
      event-bus.ts
      extension-point.ts
      lifecycle.ts
      pipeline.ts
      registry.ts
      service-registry.ts
      # Backend-контракты (зависят от Fastify/Drizzle)
      backend/
        index.ts              # re-export всех backend-типов + shared
        auth.ts               # AuthProvider, AuthService, AuthResult, User
        db.ts                 # DbService (Drizzle)
        module.ts             # BackendModule
        route-registry.ts     # RouteHandler, RouteDefinition (Fastify)
        setup.ts              # SetupContext
        migration.ts          # MigrationRegistry, MigrationEntry
      # Frontend-контракты (зависят от React)
      frontend/
        index.ts              # re-export всех frontend-типов + shared
        module.ts             # FrontendModule
        setup.ts              # FrontendSetupContext
        route-registry.ts     # FrontendRouteRegistry (ReactNode)
        slot-registry.ts      # FrontendSlotRegistry (ComponentType)
        extension-point.ts    # FrontendExtensionPointRegistry (ComponentType)
        navigation.ts         # FrontendNavigationRegistry (ComponentType)

    backend/                  # был platform-core (реализации)
      index.ts
      app.ts
      auth-middleware.ts
      auth-service.ts
      event-bus.ts
      extension-point.ts
      identity/
        schema.ts
      lifecycle.ts
      migration.ts
      pipeline.ts
      registry.ts
      route-registry.ts
      service-registry.ts

    frontend/                 # НОВОЕ — фронтенд-ядро
      index.ts
      app.ts                  # createFrontendApp(), bootstrapFrontend(), React Context
      registries/             # Реализации фронтенд-реестров
        route-registry.ts
        slot-registry.ts
        extension-point.ts
        navigation.ts
        service-registry.ts
        event-bus.ts
        lifecycle.ts
      components/             # Core React-компоненты
        module-routes.tsx     # <ModuleRoutes />
        slot.tsx              # <Slot name="..." />
        extension-point.tsx   # <ExtensionPoint id="..." />
        navigation.tsx        # <Navigation />
      layouts/
        app-layout.tsx        # Layout с header/sidebar
        public-layout.tsx     # Layout на весь viewport
      ui/
        primitives/           # HEADLESS-компоненты (логика + a11y)
          button-primitive.tsx
          input-primitive.tsx
          card-primitive.tsx
          modal-primitive.tsx
      styles/
        base.css              # CSS variables + Tailwind theme (tokens)
```

---

## Архитектурные решения

### 1. Headless + Tokens + Slots

Core предоставляет:
- **Headless-компоненты** — логика, a11y, behavior (без стилей)
- **Design Tokens** — CSS-переменные для теминга
- **Slot Registry** — механизм замены компонентов

Потребитель (apps/web) предоставляет:
- **Styled-компоненты** — используя headless из core + свои стили
- **Регистрирует их в слотах** — чтобы модули могли использовать

Модули используют:
- **Компоненты из слотов** — не знают о стилях, просто рендерят

### 2. Layout-система

Routes указывают layout при регистрации:
```ts
context.routes.register("/dashboard", <DashboardPage />, { layout: "app" })
context.routes.register("/login", <LoginPage />, { layout: "public" })
```

Core-компоненты группируют routes по layout и рендерят appropriate layout wrapper.

### 3. Контракты (platform-sdk → core/contracts)

Существующие типы разделяются на:
- **`contracts/backend/`** — типы, зависящие от Fastify/Drizzle (auth, db, route-registry, module, setup, migration)
- **`contracts/frontend/`** — типы, зависящие от React (module, setup, route-registry, slot-registry, extension-point, navigation)
- **`contracts/`** (root) — shared-типы без внешних зависимостей (event-bus, lifecycle, pipeline, registry, service-registry, extension-point)

Модули импортируют только нужный subset:
```ts
// Backend-модуль
import type { BackendModule, DbService } from "@amplicada/platform-core/contracts/backend"

// Frontend-модуль
import type { FrontendModule } from "@amplicada/platform-core/contracts/frontend"
```

### 4. Backend (platform-core → core/backend)

Все реализации переносятся. Внутренние импорты `@amplicada/platform-sdk` заменяются на относительные `../contracts/...`.

### 5. Module Pattern

Модули экспортируют отдельные entry points:
- `./backend` — BackendModule (register routes, services, migrations) + import types from `@amplicada/platform-core/contracts/backend`
- `./frontend` — FrontendModule (register routes, slots, navigation, extensions) + import types from `@amplicada/platform-core/contracts/frontend`
- `./contracts` — shared types

---

## Файлы для создания/изменения

### Шаг 1: Создать packages/core/ (2 файла)

| Файл | Действие |
|------|----------|
| `packages/core/package.json` | ✅ Создан |
| `packages/core/tsconfig.json` | ✅ Создан |

### Шаг 2: Перенести shared-контракты (6 файлов из platform-sdk)

| Файл | Действие |
|------|----------|
| `packages/platform-sdk/src/event-bus.ts` | ✅ Перенесён → `core/contracts/event-bus.ts` |
| `packages/platform-sdk/src/extension-point.ts` | ✅ Перенесён → `core/contracts/extension-point.ts` |
| `packages/platform-sdk/src/lifecycle.ts` | ✅ Перенесён → `core/contracts/lifecycle.ts` |
| `packages/platform-sdk/src/pipeline.ts` | ✅ Перенесён → `core/contracts/pipeline.ts` |
| `packages/platform-sdk/src/registry.ts` | ✅ Перенесён → `core/contracts/registry.ts` |
| `packages/platform-sdk/src/service-registry.ts` | ✅ Перенесён → `core/contracts/service-registry.ts` |

### Шаг 3: Создать contracts/backend/ (7 файлов)

| Файл | Действие |
|------|----------|
| `contracts/backend/index.ts` | ✅ Создан — re-export backend-типов + shared |
| `contracts/backend/auth.ts` | ✅ Перенесён из `platform-sdk/src/auth.ts` |
| `contracts/backend/db.ts` | ✅ Перенесён из `platform-sdk/src/db.ts` |
| `contracts/backend/module.ts` | ✅ Перенесён из `platform-sdk/src/module.ts` |
| `contracts/backend/route-registry.ts` | ✅ Перенесён из `platform-sdk/src/route-registry.ts` |
| `contracts/backend/setup.ts` | ✅ Перенесён из `platform-sdk/src/setup.ts` |
| `contracts/backend/migration.ts` | ✅ Перенесён из `platform-sdk/src/migration.ts` |

### Шаг 4: Создать contracts/frontend/ (7 файлов)

| Файл | Содержимое |
|------|-----------|
| `contracts/frontend/index.ts` | ✅ Re-export frontend-типов + shared |
| `contracts/frontend/module.ts` | ✅ `FrontendModule` interface |
| `contracts/frontend/setup.ts` | ✅ `FrontendSetupContext` interface |
| `contracts/frontend/route-registry.ts` | ✅ `FrontendRouteRegistry`, `FrontendRouteDefinition` |
| `contracts/frontend/slot-registry.ts` | ✅ `FrontendSlotRegistry` |
| `contracts/frontend/extension-point.ts` | ✅ `FrontendExtensionPointRegistry`, `ExtensionContribution` |
| `contracts/frontend/navigation.ts` | ✅ `FrontendNavigationRegistry`, `NavigationItem` |

### Шаг 5: Создать contracts/index.ts (1 файл)

✅ Re-export всего: `./backend`, `./frontend`, shared-типы.

### Шаг 6: Перенести backend (14 файлов) + обновить импорты

✅ Все файлы перенесены из `platform-core` в `core/backend/` с обновлением импортов.

### Шаг 7: Создать frontend/реализации реестров (7 файлов)

✅ Все 7 регистров-реализаций созданы.

### Шаг 8: Создать frontend/components (4 файла)

✅ Все 4 компонента созданы.

### Шаг 9: Создать frontend/layouts (2 файла)

✅ Оба layout созданы.

### Шаг 10: Создать frontend/ui/primitives (4 файла)

✅ Все 4 primitives созданы.

### Шаг 11: Создать frontend/styles/base.css (1 файл)

✅ Создан.

### Шаг 12: Создать frontend/app.ts и frontend/index.ts (2 файла)

✅ Оба созданы.

### Шаг 13: Добавить module-auth-password/src/frontend/setup.ts (1 файл)

✅ Создан.

### Шаг 14: Обновить module-auth-password (4 файла)

✅ Обновлены imports + package.json.

### Шаг 15: Обновить apps/api (2 файла)

✅ Обновлены imports.

### Шаг 16: Обновить apps/web (3 файла)

✅ Обновлены imports + styles.

### Шаг 17: Удалить старые пакеты

✅ `packages/platform-core/` удалён
✅ `packages/platform-sdk/` удалён

---

## Фронтенд-типы (детально)

### FrontendModule

```ts
// contracts/frontend/module.ts
import type { FrontendSetupContext } from "./setup.js"

export interface FrontendModule {
  id: string
  name: string
  version: string
  dependencies?: string[]
  setup(context: FrontendSetupContext): void | Promise<void>
  start?(): void | Promise<void>
  stop?(): void | Promise<void>
}
```

### FrontendSetupContext

```ts
// contracts/frontend/setup.ts
import type { FrontendRouteRegistry } from "./route-registry.js"
import type { FrontendSlotRegistry } from "./slot-registry.js"
import type { FrontendExtensionPointRegistry } from "./extension-point.js"
import type { FrontendNavigationRegistry } from "./navigation.js"
import type { ServiceRegistry } from "../service-registry.js"
import type { EventBus } from "../event-bus.js"
import type { Lifecycle } from "../lifecycle.js"

export interface FrontendSetupContext {
  routes: FrontendRouteRegistry
  slots: FrontendSlotRegistry
  extensions: FrontendExtensionPointRegistry
  navigation: FrontendNavigationRegistry
  services: ServiceRegistry
  eventBus: EventBus
  lifecycle: Lifecycle
}
```

### FrontendRouteRegistry

```ts
// contracts/frontend/route-registry.ts
import type { ReactNode } from "react"

export interface FrontendRouteDefinition {
  path: string
  element: ReactNode
  layout?: string
  meta?: Record<string, unknown>
}

export interface FrontendRouteRegistry {
  register(path: string, element: ReactNode, options?: { layout?: string; meta?: Record<string, unknown> }): void
  getAll(): FrontendRouteDefinition[]
}
```

### FrontendSlotRegistry

```ts
// contracts/frontend/slot-registry.ts
import type { ComponentType } from "react"

export interface FrontendSlotRegistry {
  register(name: string, component: ComponentType): void
  override(name: string, component: ComponentType): void
  get(name: string): ComponentType | null
  has(name: string): boolean
}
```

### FrontendExtensionPointRegistry

```ts
// contracts/frontend/extension-point.ts
import type { ComponentType } from "react"

export interface ExtensionContribution {
  id: string
  component: ComponentType
  order?: number
  meta?: Record<string, unknown>
}

export interface FrontendExtensionPointRegistry {
  contribute(pointId: string, contribution: Omit<ExtensionContribution, "id">): void
  getAll(pointId: string): ExtensionContribution[]
}
```

### FrontendNavigationRegistry

```ts
// contracts/frontend/navigation.ts
import type { ComponentType, ReactNode } from "react"

export interface NavigationItem {
  id: string
  label: string
  path: string
  icon?: ComponentType | ReactNode
  order?: number
  parent?: string
  permissions?: string[]
}

export interface FrontendNavigationRegistry {
  register(item: NavigationItem): void
  getAll(): NavigationItem[]
}
```

### Shared-типы (используются в backend и frontend)

```ts
// contracts/service-registry.ts
export interface ServiceRegistry {
  register<T>(token: string, service: T): void
  resolve<T>(token: string): T
  has(token: string): boolean
}

// contracts/event-bus.ts
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>

export interface EventBus {
  on<T = unknown>(event: string, handler: EventHandler<T>): void
  off(event: string, handler: EventHandler): void
  emit<T = unknown>(event: string, data?: T): void
}

// contracts/lifecycle.ts
export interface LifecycleHook {
  name: string
  phase: "before" | "after"
  handler: () => void | Promise<void>
}

export interface Lifecycle {
  register(hook: LifecycleHook): void
  execute(name: string): Promise<void>
}
```

---

## Frontend-приложение (apps/web)

### Итоговый main.tsx

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Navigate } from "react-router-dom"
import {
  createFrontendApp,
  bootstrapFrontend,
  FrontendProvider,
  ModuleRoutes,
} from "@amplicada/platform-core/frontend"
import { authPasswordFrontendModule } from "@amplicada/module-auth-password/frontend"
import "./index.css"

const { context } = createFrontendApp()
await bootstrapFrontend([authPasswordFrontendModule], context)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FrontendProvider context={context}>
      <BrowserRouter>
        <ModuleRoutes />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </BrowserRouter>
    </FrontendProvider>
  </StrictMode>
)
```

---

## Граф зависимостей (после реорганизации)

```
@amplicada/platform-core                         (единый пакет)
  ├── contracts                         (типы, без зависимостей)
  │   ├── shared                        (event-bus, lifecycle, pipeline, registry, service-registry)
  │   ├── backend                       (auth, db, module, route-registry, setup, migration)
  │   └── frontend                      (module, setup, route-registry, slot-registry, extension-point, navigation)
  ├── backend                           (fastify, pg, drizzle-orm)
  └── frontend                          (react, react-dom, react-router-dom)

@amplicada/module-auth-password
  ├── depends on: @amplicada/platform-core/contracts/backend
  ├── peerBackend: @amplicada/platform-core/backend, fastify, drizzle-orm
  └── peerFrontend: @amplicada/platform-core/contracts/frontend, @amplicada/platform-core/frontend, react, react-dom

@amplicada/api
  └── depends on: @amplicada/platform-core/backend, @amplicada/module-auth-password

@amplicada/web
  └── depends on: @amplicada/platform-core/frontend, @amplicada/module-auth-password
```

### Импорты в модулях

```ts
// Backend-модуль
import type { BackendModule, DbService } from "@amplicada/platform-core/contracts/backend"
import { identityUser } from "@amplicada/platform-core/backend"

// Frontend-модуль
import type { FrontendModule } from "@amplicada/platform-core/contracts/frontend"
import { useSlot } from "@amplicada/platform-core/frontend"

// apps/api
import { createApp, bootstrap } from "@amplicada/platform-core/backend"

// apps/web
import { createFrontendApp, bootstrapFrontend, FrontendProvider, ModuleRoutes } from "@amplicada/platform-core/frontend"
```
