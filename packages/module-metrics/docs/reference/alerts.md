---
title: "Алерты"
type: reference
updated: 2026-09-18
verified_commit: 9e0cfb80
order: 80
---

# Алерты

Правила мониторинга поверх событий и измерений. Код: `src/backend/alerts/`,
`src/backend/services/metrics-service.ts` (`evaluateAlerts`), схема — `metrics.alert_rules`,
`metrics.alert_instances`, `metrics.alert_events` (миграция `0005_alerts.sql`).

## Модель правила

| Поле | Значение |
|---|---|
| `target` | `{ kind: 'event' \| 'measurement', key, metric?, filters? }` |
| `windowMs` | окно расчёта: от 1 минуты до 24 часов |
| `condition` | `{ kind: 'threshold', op: gt/gte/lt/lte, value, forMs? }` или `{ kind: 'absence', forMs? }` |
| `severity` | `info` / `warning` / `critical` |
| `filters` | `route`, `module`, `actor_kind`, `status_class` (измерения) или `attributes.<key>` |

- Для события значение — число событий за окно (по имени и фильтрам).
- Для измерения: `metric: 'count' | 'avg' | 'p95'`; значения длительностей в мс
  (инструменты в секундах конвертируются), p95 — из гистограмм.
- `absence` срабатывает, когда за окно нет ни одного события/замера.
- `forMs` — выдержка: состояние держится `pending`, пока условие не продержится `forMs`,
  и только потом становится `firing`.

## Состояния и переходы

`pending → firing → resolved`; движок — чистая функция `decideAlertState`
(`src/backend/alerts/alert-evaluator.ts`), состояние хранится в `metrics.alert_instances`:

- pending, если условие перестало выполняться — состояние удаляется без события;
- firing → resolved при выходе из условия (событие `resolved` и запись в историю);
- правила проверяются раз в 60 секунд и вручную (`POST /api/metrics/admin/alerts/evaluate`).

## Доставка

Переходы публикуются в шину ядра (`metrics.alert`, payload: ruleId, name, state, severity,
value) — её подхватит notification-модуль, когда появится. Все переходы пишутся в
`metrics.alert_events` (история в UI, retention 30 дней через `metrics.maintenance`).

## HTTP

| Метод | Путь | Назначение |
|---|---|---|
| `GET/POST` | `/api/metrics/admin/alert-rules` | Список и создание правил |
| `PATCH/DELETE` | `/api/metrics/admin/alert-rules/:id` | Изменение и удаление |
| `GET` | `/api/metrics/admin/alerts` | Активные состояния (pending/firing) |
| `GET` | `/api/metrics/admin/alert-events` | История срабатываний |
| `POST` | `/api/metrics/admin/alerts/evaluate` | Немедленная проверка всех правил |

## UI

Вкладка «Алерты»: форма создания (цель, условие, окно, выдержка, важность), список правил
с выключателем и удалением, активные состояния и история срабатываний.

## Ограничения

- Правило следит за одной серией (`fingerprint = default`); группировка по измерению
  (например, «любой роут с p95 > X») — не реализована.
- Доставка — только шина + история: тишина/silences, inhibition и повторы уведомлений
  появятся с notification-модулем.
- Нет аномалий и burn-rate выражений — только пороги и отсутствие данных.
