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
показывать ленту, каталог наблюдаемых событий и настройки в админке. Отдельно собираются
**технические метрики**: длительность HTTP-роутов (RED, p50/p95/p99), SQL-запросы
(fingerprint, медленные samples) и фоновые задачи. Модули пишут **бизнес-события** через
`metrics.emit`, объявляют определения в `metrics:definitions` и панели в `metrics:panels` —
на вкладках «Бизнес» и «Панели» появляются их метрики (пилот — support-chat). Клиентская
диагностика: **ошибки** группируются в issues по fingerprint (стек + маршрут) со стеком
примеров, **Web Vitals** считаются p75/p95 и раскладываются по рейтингам. Наружу события отдают
**выходы** (webhook с HMAC-подписью, очередь с ретраями и DLQ, журнал доставки, CSV-экспорт);
все выключены по умолчанию. **Алерты** следят за порогами событий и измерений (pending →
firing → resolved) и публикуют переходы в шину ядра.

Осознанно не входит на текущем этапе: измерения (HTTP/SQL/задачи), Web Vitals и ошибки,
воронки/retention, алерты, внешние выходы (Яндекс.Метрика, webhook, CSV), экспорт.

## Публичная поверхность

| Что | Как | Где в коде |
|---|---|---|
| Backend-сервис | `context.services.resolve<MetricsService>('metrics')` | `src/backend/services/metrics-service.ts` |
| HTTP API | `POST /api/metrics/collect`, `GET /context`, `/events`, `/catalog`, `/routes`, `/sql`, `/slow-queries`, `GET/PATCH /admin/settings` | `src/backend/routes.ts` |
| Схема БД | `metrics.events` (партиции по месяцам), `metrics.settings` (синглтон) | `src/backend/schemas/`, `migrations/0000_init.sql` |
| Задачи | `metrics.maintenance` (партиции вперёд + retention), расписание — в админке | `src/backend/setup.ts` |
| Бизнес-метрики | `metrics.emit`, extension point `metrics:definitions`, сервис `metrics:panels` | `src/backend/services/metrics-service.ts`, `src/frontend/lib/panel-registry.ts` |
| Выходы | webhook, `metrics.outbox`, журнал доставки, CSV-экспорт | `src/backend/sinks/`, `migrations/0004_outputs.sql` |
| Алерты | правила, состояния, история, evaluate-интервал | `src/backend/alerts/`, `migrations/0005_alerts.sql` |
| Frontend | приложение админки `/admin/apps/metrics`, трекер на extension point `floating` | `src/frontend/setup.tsx` |
| Технические коллекторы | `http:observer`, обёртка `pg-pool`, подписка на `TASK_EVENTS` | `src/backend/collectors/` |
| Ошибки и Web Vitals | `error.frontend` + `web_vital.*`, issues, p75 карточки | `src/frontend/lib/{error-capture,vitals}.ts`, `src/backend/services/{error-fingerprint,web-vitals}.ts` |
| Точки core | `http:observer`, `request-context`, `secrets`, `frontendErrors` | `packages/platform-core` (`notes/platform-core.md` D-006, D-007) |
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
| Технические метрики | [reference/technical-metrics.md](./reference/technical-metrics.md) |
| Документы, списки, дашборд | — нет: события не документы (см. notes) |
| Задачи и фоновые процессы | [reference/settings.md](./reference/settings.md) |
| Frontend (FSD, роуты, слоты) | [reference/http-api.md](./reference/http-api.md#клиентский-трекер) — трекер и админ-приложение |
| Конфиг: env, зависимости, порядок | [reference/settings.md](./reference/settings.md#переменные-окружения) |
| Интеграции и потребители | [reference/business-metrics.md](./reference/business-metrics.md) |
| Ошибки и Web Vitals | [reference/errors-and-vitals.md](./reference/errors-and-vitals.md) |
| Масштаб, лимиты, эксплуатация | [explanation/scaling.md](./explanation/scaling.md) |
| Выходы (webhook, очередь, экспорт) | [reference/outputs.md](./reference/outputs.md) |
| Алерты | [reference/alerts.md](./reference/alerts.md) |
| Здоровье (health, объёмы, очередь) | [explanation/scaling.md](./explanation/scaling.md#что-мониторить) |
| Ограничения для потребителя | [explanation/architecture.md](./explanation/architecture.md#ограничения) |

## Freshness

- Сверено с кодом: 2026-09-18, коммит `9e0cfb80`.
- Не проверено вживую: отображение админ-приложения в браузере (API, приём и сводки
  проверены curl'ом); opt-out/DNT-ветки трекера и клики `data-metrics` в реальном браузере
  (серверная сторона и каталог проверены curl'ом).
- Проверено вживую 2026-09-18: роуты (RED по 5 маршрутам), SQL-fingerprint'ы,
  корреляция slow-samples с `route`/`requestId`, партиции `points`/`slow_queries`,
  бизнес-события поддержки (`thread.opened`, `message.sent`, `status_changed`),
  определения/сводки/серии, группировка ошибок (2 issue из 3 событий, шаблон с `<n>`),
  samples со стеком, p75 Web Vitals (LCP/CLS) с рейтингами, webhook-доставка (sent),
  DLQ на 400, CSV-экспорт, алерты (firing после evaluate и auto-resolved по интервалу),
  health-сводка (объёмы, очередь, runtime-счётчики).
