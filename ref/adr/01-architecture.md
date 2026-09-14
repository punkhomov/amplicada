---
title: Architecture
type: adr
tier: 1
status: implemented
date: 2026-07-13
source: main → main5 (merged, deduplicated, updated)
---

# Architecture — ADR

> Source: main → main5 (merged, deduplicated, updated)

---

## Platform Philosophy

Platform is NOT a business application. It provides infrastructure for building business applications.

- Platform knows nothing about business entities (no "question", "employee", "assessment")
- Applications define their domain
- Feature Modules extend the domain through stable SDK contracts
- Compile-time composition — modules are npm packages, no runtime loading

---

## Module Architecture

### Package Structure

```text
@amplicada/platform-core          — Core infrastructure, contracts, registries
@amplicada/module-{name}           — Feature module (npm package)
@amplicada/app-{name}              — Application (composes modules)
```

### Dependency Flow

```text
platform-core                  (no module dependencies)
  ↑
module-auth-password           (depends on: platform-core/contracts/backend)
  ↑
module-hr                      (depends on: platform-core, module-auth-password for identity)
  ↑
app-api, app-web               (composes modules)
```

### Module Contracts

Each module exports:
```text
./contracts     — Types shared between frontend + backend (DTO, events, constants)
./backend       — BackendModule implementation
./frontend      — FrontendModule implementation
```

### Runtime Architecture

```text
createApp()
  ↓
register services, eventBus, lifecycle, pipeline, migrations
  ↓
bootstrap(module1, module2, ...)
  ↓
  for each module: module.setup(context)
    → module registers routes, migrations, services, extensions
  ↓
  run migrations (ordered by dependencies)
  ↓
  register routes
  ↓
  start server
  ↓
  emit "ready"
```

---

## Core Decisions

### 1. Identity in Core

Core owns `identity_user` table (id, login, created_at). No email field. Modules extend identity via foreign keys.

### 2. Modules Own Their Data

Each module creates its own tables. Cross-module references via foreign keys to core tables or soft references.

### 3. Per-Module Migrations

Each module directory has its own `migrations/` folder with independent `_journal.json`. Module registration declares its migration path. Bootstrap runs: core migrations → module migrations → routes → start.

### 4. Server Sessions (Redis + @fastify/session)

Server-side sessions with Redis. `@fastify/session` provides HMAC-signed cookies. `AuthServiceImpl` uses `request.session.set/get/destroy`. Provider can use any mechanism (password, OAuth, LDAP). Auth logging (`AuthLogServiceImpl`) persists login/logout events to DB.

### 5. Headless + Tokens + Slots

Core provides headless components (logic + a11y, no styles), design tokens (CSS variables), and Slot Registry for component replacement. Apps provide styled components and register them in slots. Modules consume from slots — don't know about styles.

### 6. Layout System

Routes declare layout at registration time:
```ts
context.routes.register("/dashboard", <DashboardPage />, { layout: "app" })
context.routes.register("/login", <LoginPage />, { layout: "public" })
```

Core groups routes by layout and renders appropriate wrapper.

---

## Entity Extension Levels

| Level | Name | How | When |
|-------|------|-----|------|
| L1 | Composition | Module creates its own tables with FK to core entities | Default, always |
| L2 | Smart JOIN | Cross-module Drizzle JOIN queries | When 2+ modules share data |
| L3 | Entity Extension | Dynamic schema additions (deferred) | When 3+ modules extend same entity |
| L4 | Custom Entities | Module DDL | Rare, for standalone modules |

---

## Superseded / Replaced Decisions

- ❌ **Base64 cookie tokens** → replaced by `@fastify/session` + Redis (server-side sessions)
- ❌ **Runtime plugins** → compile-time npm packages (simpler, type-safe)
- ❌ **Strict module independence** → controlled dependencies through SDK
- ❌ **Repository pattern** → direct Drizzle queries (less abstraction)
- ❌ **Standalone contract packages** → contracts live in core package
- ❌ **Dynamic schema as default** → deferred until needed
