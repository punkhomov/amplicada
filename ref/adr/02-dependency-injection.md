---
title: Dependency Injection Strategy
type: adr
tier: 1
status: Accepted
date: 2026-07-16
---

# Dependency Injection Strategy — ADR

> Обновление: [ADR-05](05-application-composition.md) заменяет договорённость о
> декларативном-only dependencies на проверку и сортировку в bootstrap. Решения о
> service locator и extension points остаются в силе. Ниже сохранён исходный текст решения.

> Дополнение: [ADR-06](06-module-conventions.md) разрешает прямые вызовы сервисов
> optional peers с проверкой присутствия и гарантированным порядком setup.
> Extension points остаются доступными. Исходный текст ниже сохранён.

## Status

Accepted

## Context

Modules receive a `BackendSetupContext` in `setup(context)` and manually pull what they need
(`context.services.resolve<T>('token')`), then wire it by hand into whatever they construct
(providers, route handlers, tasks). There is no DI container, no constructor injection, no
decorators.

This raised two open questions:

1. Does hand-wiring scale as the number of modules and cross-module consumers grows? Is it worth
   introducing a real DI container?
2. Some future module-to-module relationships are meant to be **optional** — e.g. a hypothetical
   `module-doctor` that other modules can register health/consistency checks into, but which
   nothing breaks if `module-doctor` isn't installed at all. `context.services.resolve()` is the
   wrong tool for this: it throws if the token isn't registered, which is correct for a *required*
   dependency but wrong for an optional contribution.

Investigation found that `ExtensionPointRegistryImpl` (`context.extensions`, `contribute()` /
`getAll()`) already exists in `platform-core/src/backend/extension-point.ts` for exactly this
shape of problem, but has zero real backend consumers today — only documented as an example in
`ref/guides/module-system.md` and used once on the frontend for UI slot composition
(`frontend/components/extension-point.tsx`). `RegisteredBackendModule.dependencies` (declarative
list of module IDs) also already exists but is only recorded for visibility — `bootstrap()` in
`app.ts` calls `mod.setup(context, app)` in the order modules are passed in by the app entrypoint,
not sorted by `dependencies`.

## Decision

No DI container. Two mechanisms cover the two dependency shapes, both already present in the
codebase:

1. **Required dependency → service locator.** `context.services.resolve<T>('token')` throws if
   the token isn't registered. Used when a module cannot function without the thing it's asking
   for (e.g. `db`, `auth-service`). Failure is loud and immediate.
2. **Optional dependency / soft coupling between modules → extension points.**
   `context.extensions.contribute(pointId, contribution)` / `getAll(pointId)`. A producer module
   contributes unconditionally, without knowing or caring whether a consumer module is installed.
   A consumer module reads with `getAll()`, which returns `[]` if nothing was contributed — never
   throws. This is the mechanism for cases like `module-doctor`: other modules contribute checks
   to a `doctor:checks` extension point regardless of whether `module-doctor` is part of the app;
   `module-doctor`, if present, just consumes whatever accumulated.

`RegisteredBackendModule.dependencies` stays declarative-only for now — it documents intent but
does not drive `setup()` ordering. This is a known gap, not an oversight to silently accept
forever: if an actual bug shows up in practice (module A's `setup()` resolves something module B
was supposed to register first), the fix is to make `bootstrap()` topologically sort modules by
`dependencies` before calling `setup()` — not to introduce a DI container.

## Rationale

- A DI container (e.g. decorator + `reflect-metadata` based, à la InversifyJS/tsyringe) was
  considered and rejected. It fights with plain ESM and the project's "explicit code, no magic"
  style (`AGENTS.md`), adds a build-time dependency (metadata reflection, often needs
  experimental decorators), and buys mainly automatic constructor wiring — which manual
  `resolve()` calls in `setup()` already do at negligible verbosity for the current module count.
- Threading `context`/app instance through every function that might want to log or read a
  service was rejected — not every consumer has a natural path to receive it (e.g.
  `AuthLogServiceImpl` deep in core), and it degenerates into manual DI without the benefits of
  either approach.
- This mirrors the decision already made for the platform logger
  (`ref/plans/2026-07-15-platform-logger.md`): prefer an explicit, directly-importable singleton
  or registry over a general-purpose injection framework, project-wide — not a one-off choice
  scoped to logging.
- `contribute()`/`getAll()` over `resolve()` for optional coupling is the cheapest correct
  primitive available: it already exists (~16 LOC), never throws, and makes "may or may not be
  present" an explicit part of the contract instead of something every consumer has to
  defensively check for with `services.has()`.

## Consequences

Good:
- No new framework/dependency, no decorators, no reflection — stays consistent with the rest of
  the codebase's explicit style.
- `resolve()` failures are loud (throw with the token name) and easy to grep for.
- Optional module-to-module contribution becomes a first-class, cheap pattern instead of ad-hoc
  `services.has()` checks scattered per consumer.

Bad / accepted risk:
- `resolve()` failures are only caught at the moment the call executes, not at app startup — a
  module resolving a token that another, later-registered module was supposed to provide fails at
  runtime, not at boot. `dependencies` metadata exists but isn't enforced, so this is possible
  today.
- No static check that a module's declared `dependencies` match what it actually resolves — this
  can silently drift.
- As the module count grows, each `setup()` accumulates more manual `resolve()`/wiring calls. Not
  a problem yet at the current scale (~5 modules); revisit if it becomes genuinely repetitive.

## Implementation Notes

- Required deps: `packages/platform-core/src/backend/service-registry.ts` (`resolve`, `has`).
- Optional/soft deps: `packages/platform-core/src/backend/extension-point.ts` (`contribute`,
  `getAll`).
- Declarative-only module dependency metadata:
  `packages/platform-core/src/contracts/backend/module-registry.ts`
  (`RegisteredBackendModule.dependencies`) — not currently enforced in `bootstrap()`
  (`packages/platform-core/src/backend/app.ts`).

## Related

- [ref/plans/2026-07-15-platform-logger.md](../plans/2026-07-15-platform-logger.md) — same
  "explicit singleton/import over DI framework" philosophy, applied to the platform logger.
- [ref/guides/module-system.md](../guides/module-system.md) — documents `contribute()` usage as
  an example; no real backend module uses it yet.
