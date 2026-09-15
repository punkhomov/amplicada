---
title: Application tools — обзор
type: index
package: application-tools
updated: 2026-09-15
verified_commit: 25eafbb
---

# Application tools — обзор

`@amplicada/application-tools` генерирует статические подключения модулей из
production dependencies приложения. Публичная поверхность — CLI `amplicada-modules`
и функции планирования/записи (`src/cli.ts:6`, `src/application.ts:110`).
Пакет используется перед сборкой API и web; сам не запускает сервер.

## Документация и покрытие

| Подсистема | Документация |
|---|---|
| CLI, параметры, метаданные и порядок | [Справочник](./reference/composition.md) |
| Программный API и generated outputs | [Справочник](./reference/composition.md) |
| Интеграции и ограничения потребителя | [Справочник](./reference/composition.md) |
| Токены и extension points | — нет |
| HTTP API, схемы БД и миграции | — нет |
| Документы, списки и дашборды | — нет |
| Фоновые задачи | — нет |
| Собственные frontend-роуты и слоты | — нет |

## Сверка

Сверено 2026-09-15 с рабочим деревом поверх `25eafbb`; изменения ещё не закоммичены.
CLI и генерация проверяются тестами без внешних сервисов. Причины решений и
ограничений — `ref/notes/application-tools.md`.
