---
title: Architecture Evolution
type: adr
tier: 1
status: implemented
date: 2026-07-13
source: main → main5 (clean/00-evolution)
---

# Architecture Evolution — What We Kept, Transformed, Dropped

> Traces the logical thread across main → main2 → main3 → main4 → main5.
> Each file represents a snapshot of thinking at a point in time.

---

## main.md — Starting Point

**Core idea:** Modular platform with compile-time modules, Registry over if/switch, Extension Points for UI, Lifecycle/Pipeline for behavior.

**Key decisions kept:**
- Platform knows nothing about business domain ✅
- Modules are npm packages (compile-time) ✅
- Registry as main extension mechanism ✅
- Extension Points for UI ✅
- Lifecycle hooks (beforeSave, afterSave, etc.) ✅
- Pipeline for data transformation ✅
- REST belongs to Application, not Feature Modules ✅

**Key decisions dropped/transformed:**
- ❌ "Testing platform" focus → generalized to any business domain (by main3)
- ❌ "Feature Modules never depend on each other" → RELAXED (by main5: dependencies ARE allowed through public SDK)
- ❌ Strict "Application SDK" concept → simplified to core/contracts (by implementation)

---

## main2.md — Module Structure

**Core idea:** DDD vertical slices. Each module is a self-contained package with frontend/backend/contracts/shared.

**Key decisions kept:**
- One package per module (not split frontend/backend) ✅
- Subpath exports pattern ✅
- Backend-only contracts (auth, db, module) ✅
- Frontend-only contracts (module, setup, slots) ✅
- Shared contracts (event-bus, lifecycle) ✅
- Per-module migrations ✅
- Module.json manifest ❌ → moved package.json

**Key decisions dropped/transformed:**
- ❌ "Contracts are the module → just publish a package with types" → contracts live INSIDE core/contracts, not standalone
- ❌ "Module.json with metadata" → unnecessary, package.json is enough

---

## main3.md — Platform Runtime v2

**Core idea:** Dependency Inversion. Core provides interfaces, modules implement them. Core orchestrates, modules provide logic.

**Key decisions kept:**
- Inversion of Control: setup(context) → context.routes.register(...) ✅
- ServiceRegistry as DI container ✅
- EventBus for module communication ✅
- Lifecycle hooks (init, ready, shutdown) ✅
- Separation of Module (code composition) vs Runtime (execution) ✅

**Key decisions dropped/transformed:**
- ❌ "Core should be Runtime" → merged SDK + Core into one package (simpler)
- ❌ "Plugin is loaded at runtime" → compile-time composition (pnpm workspace)
- ❌ "Plugin is runtime-isolated" → no isolation, all packages share Node.js process

---

## main4.md — Entity Extension Levels

**Core idea:** Four levels of entity extension: L1 Composition (module-owned), L2 Smart JOIN (cross-module FK), L3 Entity Extension (extra columns via dynamic schema), L4 Custom Entities (module creates its own).

**Key decisions kept:**
- Per-module database schema (each module extends its own tables) ✅
- Soft references via string IDs (main4 § L1) → not implemented yet
- L1 Composition pattern for future HR module ✅
- Drizzle JOIN for cross-module queries ✅

**Key decisions dropped/transformed:**
- ❌ "Dynamic schema (L3) is the default" → deferred, not needed yet
- ❌ "Module intrusion detection" → not needed for compile-time composition
- ❌ "Repository pattern per module" → too much abstraction, direct Drizzle queries are fine
- ❌ L4 Custom Entities → not needed, DDL is part of module migrations

---

## main5.md — Module Dependencies & Governance

**Core idea:** Modules CAN depend on other modules through public SDK exports. Governance through public/private exports, not by banning dependencies.

**Key decisions kept:**
- Modules can declare dependencies on other modules ✅
- Public API is explicit: only what's exported from /contracts and /index ✅
- No circular dependencies (enforced by package.json) ✅

**Key decisions dropped/transformed:**
- ❌ Strict "independence" rule → relaxed to "controlled dependencies"
- ❌ Governance module → common patterns and conventions instead

---

## Trace Map

```
main ──▶ main2 ──▶ main3 ──▶ main4 ──▶ main5 ──▶ implementation
  │         │         │         │         │
  ▼         ▼         ▼         ▼         ▼
platform  module    runtime   entity    dependency
philosophy structure  (IoC)   extension  governance
```
