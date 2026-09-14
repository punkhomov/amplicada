---
title: PoC — Cookie Auth + Minimal App
type: plan
tier: 4
status: implemented
date: 2026-07-13
note: Auth since upgraded from base64 tokens to Redis + @fastify/session. See session-plan.md for details.
---

# PoC: Cookie Auth + Minimal App

## Цель

Запустить рабочее приложение с cookie-авторизацией. Auth модуль подключается через PluginManager из Core. Проверяем что архитектура модулей работает.

## Архитектура

```
@amplicada/platform-core = Platform Runtime
  - PluginManager
  - Registry
  - EventBus
  - Lifecycle
  - Pipeline
  - Auth Infrastructure (service, middleware, types)

@amplicada/auth-password = Auth Provider Module
  - frontend: login page
  - backend: routes, schema, plugin
  - contracts: types
```

Core (Runtime) предоставляет auth инфраструктуру. Auth Provider Module реализует конкретный flow.

## Структура

```
docker/
  docker-compose.yml
  init.sql

packages/platform-sdk/                 # Platform SDK (контракты)
    src/
      index.ts
      types.ts

packages/platform-core/                # Platform Runtime
    src/
      index.ts
      plugin-manager.ts
      registry.ts
      event-bus.ts
      lifecycle.ts
      pipeline.ts
      auth/
        types.ts
        service.ts
        middleware.ts

packages/module-auth-password/         # первый модуль
    src/
      frontend/
        index.ts
        login-page.tsx
      backend/
        index.ts
        plugin.ts
        routes.ts
        schema.ts
      contracts/
        index.ts

apps/
  api/
    src/
      index.ts
      server.ts
  web/
    src/
      main.tsx
      routes/
        __root.tsx
        login.tsx
        dashboard.tsx
      lib/
        api.ts
```

---

## Задачи

### Фаза 1: Docker + БД

- [x] 1.1 Создать `docker/docker-compose.yml` (PostgreSQL 16)
- [x] 1.2 Создать `docker/init.sql` (таблица users + seed admin/123456)
- [x] 1.3 Запустить docker-compose, проверить что БД работает

### Фаза 2: Auth в Core (Runtime infrastructure)

- [x] 2.1 Создать `packages/platform-core/src/auth/types.ts` (User, AuthResult, AuthProvider interface)
- [x] 2.2 Создать `packages/platform-core/src/auth/service.ts` (authenticate, login, logout, getCurrentUser)
- [x] 2.3 Создать `packages/platform-core/src/auth/middleware.ts` (Fastify preHandler: проверка куки)
- [x] 2.4 Обновить `packages/platform-core/src/index.ts` (добавить экспорт auth)
- [x] 2.5 Обновить `packages/platform-core/package.json` (добавить зависимости: jsonwebtoken)
- [x] 2.6 Проверить что core компилируется

### Фаза 3: Auth Password Module (backend)

- [x] 3.1 Создать `packages/module-auth-password/package.json` (exports: ./frontend, ./backend, ./contracts)
- [x] 3.2 Создать `packages/module-auth-password/tsconfig.json`
- [x] 3.3 Создать `packages/module-auth-password/src/contracts/types.ts` (LoginRequest, LoginResponse)
- [x] 3.4 Создать `packages/module-auth-password/src/backend/schema.ts` (Drizzle: users table)
- [x] 3.5 Создать `packages/module-auth-password/src/backend/plugin.ts` (implements AuthProvider)
- [x] 3.6 Создать `packages/module-auth-password/src/backend/routes.ts` (POST /api/auth/login)
- [x] 3.7 Создать `packages/module-auth-password/src/backend/index.ts`
- [x] 3.8 Проверить что backend модуля компилируется

### Фаза 4: Auth Password Module (frontend)

- [x] 4.1 Создать `packages/module-auth-password/src/frontend/login-page.tsx` (форма логина)
- [x] 4.2 Создать `packages/module-auth-password/src/frontend/index.ts`
- [x] 4.3 Проверить что frontend модуля компилируется

### Фаза 5: Backend App (apps/api)

- [x] 5.1 Создать `apps/api/package.json`
- [x] 5.2 Создать `apps/api/tsconfig.json`
- [x] 5.3 Создать `apps/api/src/server.ts` (Fastify + CORS + cookie parser)
- [x] 5.4 Создать `apps/api/src/index.ts` (Core + register auth module + start)
- [x] 5.5 Проверить что API стартует

### Фаза 6: Frontend App (apps/web)

- [x] 6.1 Создать `apps/web/package.json`
- [x] 6.2 Создать `apps/web/tsconfig.json`
- [x] 6.3 Создать `apps/web/vite.config.ts`
- [x] 6.4 Создать `apps/web/tailwind.config.ts`
- [x] 6.5 Создать `apps/web/src/main.tsx`
- [x] 6.6 Создать `apps/web/src/routes/__root.tsx`
- [x] 6.7 Создать `apps/web/src/routes/login.tsx` (импортирует LoginPage из auth-password)
- [x] 6.8 Создать `apps/web/src/routes/dashboard.tsx` (protected)
- [x] 6.9 Создать `apps/web/src/lib/api.ts` (fetch credentials: include)
- [x] 6.10 Проверить что фронтенд стартует

### Фаза 7: Интеграция

- [x] 7.1 Запустить всё вместе
- [x] 7.2 Проверить: /login → форма
- [x] 7.3 Проверить: admin/123456 → /dashboard
- [x] 7.4 Проверить: "Вы вошли как admin"
- [x] 7.5 Проверить: logout → /login
- [x] 7.6 Проверить: прямой доступ /dashboard без куки → /login
