---
title: "platform-core — обзор"
type: index
package: platform-core
updated: 2026-09-17
verified_commit: ce72875d
---

# platform-core

> Потребительская документация. Рационал решений, отвергнутые альтернативы и известные
> пробелы — в `ref/notes/platform-core.md`.

`platform-core` — инфраструктурный пакет платформы: backend-каркас (роутинг, миграции,
документный рантайм, хранилище, задачи, сервисы) и frontend-каркас (FSD-слои, реестры,
роуты, слоты, UI-кит).

Документация пакета начата с UI-кита; остальные подсистемы пока не описаны (см. карту
покрытия). Осознанно не входит: бизнес-логика модулей — она живёт в `module-*`.

## Публичная поверхность (описанная часть)

| Что | Как | Где в коде |
|---|---|---|
| Компоненты UI | deep import `@amplicada/platform-core/frontend/ui/<name>` | `src/frontend/ui/*.tsx` |
| Токен `cn` | `export { cn }` из `cn` | `src/frontend/lib/utils.ts`, `src/frontend/index.ts:65` |
| Синхронизация кита | `pnpm --filter @amplicada/platform-core ui:sync \| ui:check` | `scripts/shadcn-sync.mjs` |

## Карта документации

| Раздел | Файл |
|---|---|
| Первый контакт | — нет |
| Задачи | [how-to/](./how-to/index.md) |
| Справочник | [reference/](./reference/index.md) |
| Концепции | [explanation/](./explanation/index.md) |

## Карта покрытия

| Подсистема | Где описана |
|---|---|
| Точки расширения (сервисы, токены) | — нет |
| HTTP API | — нет |
| Схема БД и миграции | — нет |
| Документы, списки, дашборд | — нет |
| Задачи и фоновые процессы | — нет |
| Frontend: UI-кит | [reference/ui-kit.md](./reference/ui-kit.md) |
| Frontend: реестры, роуты, слоты, layouts | — нет |
| Конфиг: env, порядок загрузки | — нет |
| Интеграции и потребители | — нет |
| Ограничения для потребителя | [reference/ui-kit.md](./reference/ui-kit.md) (кит); остальное — нет |

## Freshness

- Сверено с кодом: `2026-09-17`, коммит `ce72875d`, рабочее дерево грязное (ветка `feat/shadcn-ui-automation`).
- Не проверено вживую: браузерный смоук `message-scroller`, `questionnaire`, `toast`;
  визуальная регрессия остальных компонентов после синка.
