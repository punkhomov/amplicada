---
title: "Технические метрики: роуты, SQL, задачи"
type: reference
updated: 2026-09-18
verified_commit: 9e0cfb80
order: 40
---

# Технические метрики: роуты, SQL, задачи

Измерения платформы: длительность HTTP-роутов, длительность SQL-запросов и фоновых задач.
Код: `src/backend/collectors/`, хранение — `metrics.series` + `metrics.points`
(`src/backend/services/metrics-store.ts`).

## Инструменты

| Инструмент | Тип | Единица | Измерения |
|---|---|---|---|
| `http.server.request.duration` | histogram | `s` | `route`, `method`, `status`, `status_class`, `instance` |
| `db.client.operation.duration` | histogram | `s` | `fingerprint`, `route` |
| `task.run.duration` | histogram | `s` | `task`, `outcome` |

Границы гистограмм — дефолт OTel (`0.005 … 10` с). Перцентили считаются линейной
интерполяцией по слитым бакетам; значения выше верхней границы «насыщаются» на 10 с
(точные — в samples медленных SQL).

## HTTP-коллектор

Наблюдатель `http:observer` (core ставит root-хуки до регистрации модулей, поэтому покрыты
все роуты — и core, и модульные):

- `route` — шаблон Fastify (`request.routeOptions.url`), unmatched → `<unmatched>`; сырой URL
  в измерения не попадает;
- `status` — точный код, `status_class` — `2xx`…`5xx`;
- длительность — `reply.elapsedTime`.

## SQL-коллектор

Обёртка `pool.query` и клиентов из `pool.connect` (`src/backend/collectors/sql-collector.ts`):

- wall-clock длительность, `rowCount`, код ошибки;
- текст нормализуется: строковые и числовые литералы → `?`, `IN (?, ?, ?)` → `IN (?)`,
  параметры `$n` сохраняются (`src/backend/services/sql-normalize.ts`); `fingerprint` —
  sha256 нормализованного текста;
- измерение пишется с `route` из `request-context`; SQL фоновых задач (вне запроса) —
  `<unattributed>`;
- запросы самого модуля (`metrics.*`) пропускаются;
- медленные (порог `slowSqlThresholdMs`) и ошибочные запросы пишутся как samples
  (≤ 50 за окно флаша) в `metrics.slow_queries` с нормализованным текстом, `route` и
  `requestId`; остальные замеры — по доле `sampleSqlRate`.

`pg_stat_statements` пока не подключается: работает без прав DBA и расширений.

## Задачи

Подписка на `TASK_EVENTS` шины: `task.run.duration` с измерениями `task` (id) и `outcome`
(`success` | `error` | `timeout` | `cancelled`).

## Флаш и хранение

Коллекторы копят наблюдения в памяти (`MeasurementBuffer`), флашер раз в 10 с пишет одну
точку на (серию, окно): `count/sum/min/max` + гистограмма. Серии — в `metrics.series`
(upsert по `instrument` + `dims_hash`), точки — в `metrics.points` (партиции по месяцу).
При ошибке записи точки не теряются — остаются до следующего флаша. Retention измерений —
`retentionPointsDays` (30 по умолчанию); медленные samples — 7 дней.

## Сводки в админке

| Вкладка | Что показывает | Источник |
|---|---|---|
| «Роуты» | calls, errors, error rate, avg, p50/p95/p99, max по маршрутам | `GET /api/metrics/routes` |
| «SQL» | топ fingerprint'ов (calls, avg, p95, max, last seen) + медленные samples | `GET /api/metrics/sql`, `/slow-queries` |

Период — «Час», «24 часа», «7 дней»; обновление — polling каждые 30 с.

## Ограничения

- Точные перцентили недоступны: интерполяция по гистограммам (рационал — `ref/notes/module-metrics.md` D-011).
- SQL вне HTTP-запроса не имеет `route` (фоновые задачи, миграции, бутстрап).
- Нет графиков/трендов — таблицы за период; панели-дашборды — этап 03 плана.
- `instance` только у HTTP-метрик; SQL-замеры не разделяются по инстансам воркеров.
