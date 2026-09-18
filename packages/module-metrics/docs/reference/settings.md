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
| `metrics.settings` | Синглтон настроек | `id = 'default'`, `enabled`, `retention_events_days`, `sample_pageview_rate`, `sample_click_rate`, `store_raw_urls` |

Индексы `metrics.events`: btree `(name, occurred_at desc)`, частичные по `actor_hash` и
`session_hash`, BRIN по `occurred_at`. Партиции создаются миграцией (текущий + 2 месяца) и
задачей обслуживания.

## Поля настроек

| Поле | Тип | Дефолт | Диапазон |
|---|---|---|---|
| `enabled` | boolean | `true` | — |
| `retentionEventsDays` | integer | `30` | 1–3650 |
| `samplePageviewRate` | number | `1` | 0–1 |
| `sampleClickRate` | number | `0.1` | 0–1 |
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

## Потребители

- API-сервис: `context.services.resolve<MetricsService>('metrics')`.
- Frontend: приложение админки `/admin/apps/metrics` (module-admin apps mode), трекер на
  `floating`, локали-неймспейс `metrics`.
- Схема и сервис не зависят от document runtime; id события — uuid, а не из `document_index`.

## Ограничения

- Rate-limit приёма и opt-out на клиенте — этап 01/06 плана.
- Измерения, ошибки, Web Vitals, алерты, sinks — этапы 02–05; таблиц под них пока нет.
