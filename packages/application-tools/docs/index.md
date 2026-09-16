---
title: Application tools — обзор
type: index
package: application-tools
updated: 2026-09-16
verified_commit: a5c2ac9
---

# Application tools — обзор

`@amplicada/application-tools` генерирует статические подключения модулей из
production dependencies приложения. Публичная поверхность — CLI `amplicada-modules`
и функции планирования/записи (`src/cli.ts:6`, `src/application.ts:198`).
Пакет используется перед сборкой API и web; сам не запускает сервер.

## Карта документации

- [Справочник CLI и формата](./reference/composition.md).
- [Состав, граф и жизненный цикл](./explanation/composition-model.md).
- [Как подключить optional-сервис](./how-to/optional-module-integration.md).

## Документация и покрытие

| Подсистема | Документация |
|---|---|
| CLI, параметры, метаданные и порядок | [Справочник](./reference/composition.md) |
| Программный API и generated outputs | [Справочник](./reference/composition.md) |
| Интеграции и ограничения потребителя | [Инструкция](./how-to/optional-module-integration.md), [модель](./explanation/composition-model.md) |
| Токены и extension points | — нет |
| HTTP API, схемы БД и миграции | — нет |
| Документы, списки и дашборды | — нет |
| Фоновые задачи | — нет |
| Собственные frontend-роуты и слоты | — нет |

## Сверка

Сверено 2026-09-16 с рабочим деревом поверх `a5c2ac9`; изменения ещё не закоммичены.
CLI и генерация проверяются тестами без внешних сервисов. Причины решений и
ограничений — `ref/notes/application-tools.md`.
