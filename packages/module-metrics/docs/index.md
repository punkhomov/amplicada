---
title: "module-metrics — обзор"
type: index
package: module-metrics
updated: 2026-09-18
verified_commit: 9e0cfb80
---

# module-metrics

> Потребительская документация. Рационал решений, отвергнутые альтернативы и известные
> пробелы — в `ref/notes/module-metrics.md`. Направление развития — `ref/plans/2026-09-18-metrics-module/`.

Журнал событий платформы и админ-приложение к нему. Сейчас модуль умеет: принимать батчи
клиентских событий (`page.view` на смену маршрута и `ui.*` по кликам на `data-metrics`),
дедуплицировать их, псевдонимизировать актора и сессию, ограничивать приём (429 с `Retry-After`),
уважать opt-out/DNT/GPC, партиционировать журнал по месяцам, удалять старое по retention и
показывать ленту, каталог наблюдаемых событий и настройки в админке. Потребители (модули) смогут
писать бизнес-события через сервис `metrics`, когда появится `emit` (этап 03 плана).

Осознанно не входит на текущем этапе: измерения (HTTP/SQL/задачи), Web Vitals и ошибки,
воронки/retention, алерты, внешние выходы (Яндекс.Метрика, webhook, CSV), экспорт.

## Публичная поверхность

| Что | Как | Где в коде |
|---|---|---|
| Backend-сервис | `context.services.resolve<MetricsService>('metrics')` | `src/backend/services/metrics-service.ts` |
| HTTP API | `POST /api/metrics/collect`, `GET /api/metrics/context`, `/events`, `/catalog`, `GET/PATCH /api/metrics/admin/settings` | `src/backend/routes.ts` |
| Схема БД | `metrics.events` (партиции по месяцам), `metrics.settings` (синглтон) | `src/backend/schemas/`, `migrations/0000_init.sql` |
| Задачи | `metrics.maintenance` (партиции вперёд + retention), расписание — в админке | `src/backend/setup.ts` |
| Frontend | приложение админки `/admin/apps/metrics`, трекер на extension point `floating` | `src/frontend/setup.tsx` |
| Псевдонимизация | `Pseudonymizer` (HMAC-SHA256), соль — `AMPLICADA_METRICS_PSEUDONYM_SALT` | `src/backend/services/pseudonym.ts` |

## Зависимости и порядок загрузки

- Требует: `@amplicada/platform-core`; для приложения админки — `@amplicada/module-admin`.
- Соль читается через core-сервис `secrets` (модуль сам `process.env` не читает).
- Другие модули могут писать события через `context.services.has('metrics')` + типы из
  `@amplicada/module-metrics/contracts` (runtime-зависимость не обязательна).

## Карта документации

| Раздел | Файл |
|---|---|
| Первый контакт | [tutorial.md](./tutorial.md) |
| Задачи | [how-to/](./how-to/index.md) |
| Справочник | [reference/](./reference/index.md) |
| Концепции | [explanation/](./explanation/index.md) |

## Карта покрытия

| Подсистема | Где описана |
|---|---|
| Точки расширения (сервисы/токены) | [reference/settings.md](./reference/settings.md) — сервис `metrics`, задача `metrics.maintenance` |
| HTTP API | [reference/http-api.md](./reference/http-api.md) |
| Схема БД и миграции | [reference/settings.md](./reference/settings.md) |
| Документы, списки, дашборд | — нет: события не документы (см. notes) |
| Задачи и фоновые процессы | [reference/settings.md](./reference/settings.md) |
| Frontend (FSD, роуты, слоты) | [reference/http-api.md](./reference/http-api.md#клиентский-трекер) — трекер и админ-приложение |
| Конфиг: env, зависимости, порядок | [reference/settings.md](./reference/settings.md#переменные-окружения) |
| Интеграции и потребители | [reference/events.md](./reference/events.md#для-модулей-потребителей) — эмита бизнес-событий пока нет |
| Ограничения для потребителя | [explanation/architecture.md](./explanation/architecture.md#ограничения) |

## Freshness

- Сверено с кодом: 2026-09-18, коммит `9e0cfb80`.
- Не проверено вживую: отображение админ-приложения в браузере (API и приём проверены
  curl'ом); opt-out/DNT-ветки трекера и клики `data-metrics` в реальном браузере
  (серверная сторона и каталог проверены curl'ом).
