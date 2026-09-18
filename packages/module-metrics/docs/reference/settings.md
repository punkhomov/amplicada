---
title: "Хранение, настройки и окружение"
type: reference
updated: 2026-09-18
verified_commit: 9e0cfb80
order: 30
---

# Хранение, настройки и окружение

Схема `metrics` (`migrations/0000_init.sql`, drizzle-схемы в `src/backend/schemas/`).

## Таблицы

| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `metrics.events` | Append-only журнал, партиции по `occurred_at` (месяц) | PK `(occurred_at, id)`, `name`, `kind`, `actor_hash`, `session_hash`, `route`, `attributes` (jsonb), `sampling_rate` |
| `metrics.settings` | Синглтон настроек | поля — см. ниже |
| `metrics.series` | Уникальные серии измерений | `instrument` + `dims_hash`, `dims` (jsonb), `boundaries` |
| `metrics.points` | Пред-агрегированные точки, партиции по месяцу | `series_id`, `bucket`, `count`, `sum`, `min`, `max`, `histogram` |
| `metrics.sql_fingerprints` | Нормализованные тексты SQL по fingerprint | `fingerprint` (PK), `query_text`, `first_seen`, `last_seen` |
| `metrics.slow_queries` | Samples медленных/ошибочных SQL, партиции по месяцу | `at`, `fingerprint`, `query_text`, `route`, `duration_ms`, `row_count`, `error_code`, `request_id` |
| `metrics.sink_configs` | Конфиги выходов (webhook, yandex-metrica) | `id`, `enabled`, `settings`, `mapping` |
| `metrics.outbox` | Durable-очередь доставки | `sink_id`, `item_id`, `payload`, `status`, `attempts`, `next_attempt_at`, уникальность `(sink_id, item_id)` |
| `metrics.sink_deliveries` | Журнал попыток доставки | `sink_id`, `item_id`, `status`, `attempts`, `error` |

Индексы `metrics.events`: btree `(name, occurred_at desc)`, частичные по `actor_hash` и
`session_hash`, BRIN по `occurred_at`. Партиции создаются миграцией (текущий + 2 месяца) и
задачей обслуживания.

## Поля настроек

| Поле | Тип | Дефолт | Диапазон |
|---|---|---|---|
| `enabled` | boolean | `true` | — |
| `retentionEventsDays` | integer | `30` | 1–3650 |
| `samplePageviewRate` | number | `1` | 0–1 |
| `sampleClickRate` | number | `1` | 0–1 |
| `ingestEventsPerMinute` | integer | `600` | 1–100000 |
| `retentionPointsDays` | integer | `30` | 1–3650 |
| `slowSqlThresholdMs` | integer | `1000` | 1–600000 |
| `sampleSqlRate` | number | `1` | 0–1 |
| `storeRawUrls` | boolean | `false` | — |

## Задача обслуживания

`metrics.maintenance` (`src/backend/setup.ts`) — создаёт партиции на текущий и два следующих
месяца, удаляет партиции старше retention (`src/backend/services/partitions.ts`). Расписание
задаётся в админке (`/admin/tasks`); по умолчанию задача неактивна. Дополнительно партиции
гарантируются при старте модуля (`metricsModule.start`).

## Переменные окружения

| Переменная | Обязательна | Назначение |
|---|---|---|
| `AMPLICADA_METRICS_PSEUDONYM_SALT` | для прода | Соль HMAC-псевдонимизации; читается core-сервисом `secrets`. Без неё — случайная процессная соль + warning |
| `AMPLICADA_METRICS_WEBHOOK_SECRET` | нет | HMAC-секрет подписи webhook-доставки (`x-metrics-signature`); без него — без подписи |
| `AMPLICADA_METRICS_YANDEX_TOKEN` | для Метрики | OAuth-токен Яндекс.Метрики (Measurement Protocol и Offline Conversions) |

## Точки core, на которые опирается модуль

| Точка | Зачем |
|---|---|
| `http:observer` (extension point) | HTTP-метрики всех роутов (root-хуки `onRequest`/`onResponse` в core) |
| `request-context` (сервис, ALS) | `route`/`requestId` для SQL-замеров внутри запроса |
| `secrets` (сервис) | Соль псевдонимизации из env (`AMPLICADA_METRICS_PSEUDONYM_SALT`) |

Рационал решений — `ref/notes/platform-core.md` D-006.

## Потребители

- API-сервис: `context.services.resolve<MetricsService>('metrics')`.
- Frontend: приложение админки `/admin/apps/metrics` (module-admin apps mode), трекер на
  `floating`, локали-неймспейс `metrics`.
- Схема и сервис не зависят от document runtime; id события — uuid, а не из `document_index`.

## Ограничения

- Сырых событий в открытом виде нет: см. [explanation/pseudonymization.md](../explanation/pseudonymization.md).
- Измерения, ошибки, Web Vitals, алерты, sinks — этапы 02–05; таблиц под них пока нет.
