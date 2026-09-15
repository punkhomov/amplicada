---
title: Plan Lifecycle — от плана к постоянной документации
type: guide
tier: 4
status: draft
date: 2026-07-13
---

# Plan Lifecycle

Когда план (`ref/plans/`) реализован, его знания нужно распределить по постоянным документам, чтобы плановая папка не превращалась в свалку устаревших черновиков.

## Trigger

План переходит в `status: implemented` после того, как весь запланированный код написан и работает.

## Pipeline

```
implemented plan
    │
    ├── extract architectural decisions
    │     └── new ADR or update existing ADR
    │
    ├── extract package knowledge
    │     ├── package-local decisions/rationale → ref/notes/<package>.md
    │     └── consumer docs → packages/<package>/docs/
    │
    ├── extract workflow knowledge
    │     └── new guide or update existing guide
    │
    └── archive the plan
          └── status: implemented (keep for history, no longer read for decisions)
```

## Decision Matrix

| Что обнаружили в плане | Куда идёт |
|------------------------|-----------|
| Технологический выбор (почему Redis, а не встроенные сессии) | ADR |
| Решение уровня пакета: почему сделано так, что отвергли или отложили | `ref/notes/<package>.md` (статусы `rejected`/`deferred`/`gap`) |
| Текущее устройство пакета: что умеет, токены, роуты, схема, фронтенд | `packages/<package>/docs/` (скилл `module-docs`) |
| Архитектурный паттерн (серверные сессии, модульные миграции) | ADR |
| Изменение стека (новая зависимость, удаление пакета) | README и package.json |
| Новый функционал (теперь есть ModuleRoutes, bcrypt) | README соответствующего пакета |
| Паттерн использования (как зарегистрировать layout, как подключить модуль) | guide |
| Инфраструктурное изменение (новый порт, контейнер, переменная) | корневой README |
| Временное/однократное действие (миграция данных, rename пакета) | только план, ничего не мигрировать |

## Что делаем с планом после

План **не удаляется**. Он остаётся в `ref/plans/` со статусом `implemented`. Это история — видно, когда и что планировали, что из этого вышло.

Если план содержал идеи, которые решили не делать — `status: cancelled` с краткой причиной.

## Пример

**Plan**: `2026-07-13-server-sessions.md` от `partially-implemented` → `implemented`

1. **ADR**: в `adr/01-architecture.md` уже есть раздел про server-side sessions — проверить, что он точен
2. **README**: описать использование `@fastify/session` и Redis
3. **Guide**: новый guide не нужен — механизм уже описан в `module-system.md`
4. **Archive**: plan → `status: implemented`

## Применение

| План | Что мигрировано |
|------|----------------|
| `frontend-core-reorg.md` | FrontendSetupContext, ModuleRoutes, граф зависимостей, lifecycle → `guides/module-system.md` |
| `server-sessions.md` | Уже было в ADR 01 §4 |
| `layout-aware-routes.md` | Уже было в ADR 01 §6 |
| `poc-cookie-auth.md` | Superseded server-sessions, выжимка не нужна |

## Примечание

Этот процесс применяется в конце сессии, перед тем как подвести итог. Не нужно дробить сессию ради каждого плана.
