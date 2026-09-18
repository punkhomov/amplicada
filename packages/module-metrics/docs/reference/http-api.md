---
title: "HTTP API и клиентский трекер"
type: reference
updated: 2026-09-18
verified_commit: 9e0cfb80
order: 20
---

# HTTP API и клиентский трекер

Роуты регистрируются с префиксом `/api/metrics` (`src/backend/routes.ts`, `src/backend/setup.ts`).

## Эндпоинты

| Метод | Путь | Авторизация | Назначение |
|---|---|---|---|
| `POST` | `/api/metrics/collect` | опционально (сессия) | Приём батча клиентских событий |
| `GET` | `/api/metrics/context` | нет | Bootstrap-конфиг трекера |
| `GET` | `/api/metrics/events` | требуется | Лента событий (админка) |
| `GET` | `/api/metrics/catalog` | требуется | Каталог наблюдаемых имён событий с объёмом и first/last seen |
| `GET` | `/api/metrics/routes` | требуется | Сводка RED по маршрутам за период (`from`, `to`) |
| `GET` | `/api/metrics/sql` | требуется | Топ SQL-fingerprint'ов (`from`, `to`, `limit`) |
| `GET` | `/api/metrics/slow-queries` | требуется | Samples медленных/ошибочных SQL (`from`, `to`, `limit`) |
| `GET` | `/api/metrics/definitions` | требуется | Определения бизнес-метрик от модулей |
| `GET` | `/api/metrics/definitions/summary` | требуется | Totals и тренды определений (`from`, `to`, `step`) |
| `GET` | `/api/metrics/series` | требуется | Серия событий (`name` или `eventPrefix`, `groupBy`, `measure`) |
| `GET` | `/api/metrics/errors` | требуется | Issues сгруппированных ошибок (`from`, `to`, `limit`) |
| `GET` | `/api/metrics/errors/:fingerprint/samples` | требуется | Примеры ошибки (стек, контекст) |
| `GET` | `/api/metrics/vitals` | требуется | p75/p95 и рейтинги Web Vitals |
| `GET/POST` | `/api/metrics/admin/alert-rules` | требуется | Правила алертов |
| `PATCH/DELETE` | `/api/metrics/admin/alert-rules/:id` | требуется | Изменение и удаление правила |
| `GET` | `/api/metrics/admin/alerts` | требуется | Активные состояния алертов |
| `GET` | `/api/metrics/admin/alert-events` | требуется | История срабатываний |
| `POST` | `/api/metrics/admin/alerts/evaluate` | требуется | Немедленная проверка правил |
| `GET/PATCH` | `/api/metrics/admin/sinks[/:id]` | требуется | Конфиги выходов и их изменение |
| `POST` | `/api/metrics/admin/sinks/:id/test` | требуется | Тестовое сообщение через выход |
| `GET` | `/api/metrics/admin/deliveries` | требуется | Журнал доставки |
| `POST` | `/api/metrics/admin/outbox/dispatch` | требуется | Немедленный прогон очереди |
| `GET` | `/api/metrics/export/events.csv` | требуется | CSV-экспорт событий |
| `GET` | `/api/metrics/admin/settings` | требуется | Настройки метрик |
| `PATCH` | `/api/metrics/admin/settings` | требуется | Изменение настроек |

### `POST /collect`

Тело: `{ "events": ClientEventInput[] }` (см. [events.md](./events.md)). Ответ — **202**:

```json
{ "accepted": 1, "duplicates": 0, "overflow": 0, "rejected": [{ "index": 1, "reason": "invalid_id" }] }
```

- `accepted` — записано новых; `duplicates` — уже были (идемпотентность);
- `overflow` — сколько атрибутов отброшено/обрезано по лимитам;
- `rejected[].reason` — `invalid_id`, `invalid_name`, `invalid_kind`, `invalid_occurred_at`,
  `too_old`, `too_large`, `batch_too_large`, `invalid_body`;
- `disabled: true` — сбор выключен настройками, батч не записан (всё равно 202).

При превышении минутного лимита (`ingestEventsPerMinute`, по умолчанию 600) — **429**:

```json
{ "error": "rate_limited", "retryAfter": 44 }
```

с заголовком `retry-after`. Ключ лимита — хеш пользователя, сессии или IP (Redis, секундное
окно с TTL 2 минуты).

### `GET /context`

```json
{
  "enabled": true,
  "sampleRates": { "pageview": 1, "ui": 0.1 },
  "limits": { "maxBatchEvents": 500, "maxEventBytes": 8192, "maxAttributes": 32, "maxStringLength": 256 }
}
```

### `GET /routes`, `/sql`, `/slow-queries`

Параметры `from`/`to` — ISO 8601; по умолчанию последние 24 часа; невалидный диапазон — 400
`{ "error": "invalid_range" }`. Формат ответов — `RouteSummaryDto[]`, `SqlSummaryDto[]`,
`SlowQueryDto[]` (`src/contracts/types.ts`). Тексты SQL нормализованы (литералы → `?`).

### `GET /errors`, `/errors/:fingerprint/samples`, `/vitals`

- `/errors` → `{ issues: ErrorIssueDto[] }` (fingerprint, тип, шаблон, счётчики, релизы);
- samples → `{ samples: MetricEventDto[] }`;
- `/vitals` → `{ vitals: VitalSummaryDto[] }` (p75/p95 + good/needs-improvement/poor).
Подробности — [errors-and-vitals.md](./errors-and-vitals.md).

### `GET /definitions`, `/definitions/summary`, `/series`

- `/definitions` → `{ definitions: MetricDefinition[] }`;
- `/definitions/summary` → `{ definitions: MetricDefinitionSummaryDto[], stepSeconds }`;
- `/series` → `{ series: MetricSeriesDto[], stepSeconds }`; нужен `name` или `eventPrefix`,
  иначе 400 `name_or_eventPrefix_required`. Подробности — [business-metrics.md](./business-metrics.md).

### `GET /catalog`

Ответ: `{ "entries": [{ "name", "kind", "eventCount", "firstSeen", "lastSeen" }] }` — агрегат
по всей таблице, отсортирован по объёму (до 500 имён). Используется вкладкой «Каталог».

### `GET /events`

Параметры: `kind` (одно из значений kind), `name` (подстрока), `limit` (1–200, по умолчанию 100).
Ответ: `{ "events": MetricEventDto[] }` — последние сверху.

### `PATCH /admin/settings`

Тело: `MetricsSettingsPatch` ([settings.md](./settings.md)). Ошибка валидации — **400**
`{ "error": "sampleClickRate must be between 0 and 1" }`.

## Ошибки

| Код | Когда |
|---|---|
| 400 | Невалидный `PATCH /admin/settings` |
| 401 | Нет сессии на `GET /events` и `/admin/settings` |
| 500 | Внутренняя ошибка; наружу — `Internal Server Error` без деталей запроса |

## Клиентский трекер

`MetricsTracker` (`src/frontend/features/metrics-tracker/ui/metrics-tracker.tsx`) подписан на
extension point `floating`:

- `page.view` на смену маршрута; `route` нормализуется (`/support/<uuid>` → `/support/:id`) —
  `src/frontend/lib/route.ts`;
- `ui.*` — клики по `data-metrics`-элементам с сэмплированием `sampleClickRate`
  (`src/frontend/lib/clicks.ts`);
- opt-out: флаг `localStorage['metrics.optout']`, DNT и GPC (`src/frontend/lib/optout.ts`) —
  трекер не поднимается вовсе;
- сессия — `sessionStorage`, ротация после 30 минут неактивности — `src/frontend/lib/session.ts`;
- очередь — до 200 событий, батчи по 10 секунд / при `visibilitychange` через
  `navigator.sendBeacon` с фолбэком на `fetch keepalive` — `src/frontend/lib/queue.ts`;
- при `GET /context` с `enabled:false` трекер молчит.
