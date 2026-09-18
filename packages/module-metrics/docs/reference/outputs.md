---
title: "Выходы: webhook, очередь доставки и экспорт"
type: reference
updated: 2026-09-18
verified_commit: 9e0cfb80
order: 70
---

# Выходы: webhook, очередь доставки и экспорт

Как события уходят наружу. Код: `src/backend/sinks/`, схема — `metrics.sink_configs`,
`metrics.outbox`, `metrics.sink_deliveries` (миграция `0004_outputs.sql`).

Все выходы **выключены по умолчанию**: в закрытом контуре ничего не отправляется, события
ждут в очереди, пока выход не включат.

## Контракт выхода

Адаптер (`MetricSink`) объявляет: `id`, `titleKey`, `accepts` (`event` / `measurement`),
`maxEvents`, фильтр `matches(payload, config)` по `settings.events` и `send(items, config, signal)`.
Настройки проходят whitelist (`sanitizeSettings`) — лишние ключи отбрасываются до записи в БД.
Реестр выходов наполняется кодом в setup модуля.

## Webhook

```json
PATCH /api/metrics/admin/sinks/webhook
{ "enabled": true, "settings": { "url": "https://example.com/hooks/metrics", "events": ["support.*"] } }
```

- `POST` батча (`{ items: [...] }`), таймаут 10 с;
- если задан секрет `AMPLICADA_METRICS_WEBHOOK_SECRET`, тело подписывается HMAC-SHA256
  в заголовке `x-metrics-signature: sha256=<hex>`;
- `2xx` — успех; `429`/`5xx`/сеть — повтор; остальные `4xx` — сразу в DLQ;
- фильтр `events`: точные имена или префиксы с `*` (`support.*`); пусто — все события.

## Очередь и доставка

Запись события и постановка в `metrics.outbox` происходят вместе (только для включённых
выходов). Диспетчер раз в 15 секунд забирает due-строки и шлёт батчами; ретраи —
30 с → 1 мин → … → 1 ч, максимум 6 попыток, дальше DLQ. Каждая попытка пишется в
`metrics.sink_deliveries`. Выключенный выход события не теряет — они ждут в очереди.

Проверка выхода и ручной прогон:

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/metrics/admin/sinks` | Конфиги + `pending`/`dead` по каждому |
| `PATCH` | `/api/metrics/admin/sinks/:id` | Включение и настройки |
| `POST` | `/api/metrics/admin/sinks/:id/test` | Тестовое сообщение через адаптер |
| `GET` | `/api/metrics/admin/deliveries` | Журнал доставки (`sinkId`, `limit`) |
| `POST` | `/api/metrics/admin/outbox/dispatch` | Немедленный прогон очереди |

## Экспорт CSV

`GET /api/metrics/export/events.csv?from&to&kind&name&limit` (до 20 000 строк) — нормализованные
события с атрибутами и псевдонимами, без `url` (кроме `store_raw_urls`). Кнопка «Экспорт CSV»
на вкладке «События» использует текущие фильтры.

## UI

Вкладка «Доставка»: карточки выходов (выключатель, URL, фильтр событий, «Проверить»,
счётчики очереди/DLQ) и журнал доставки со статусами `sent` / `failed` / `dead`.

## Ограничения

- Реализован только webhook; адаптер Яндекс.Метрики — следующий шаг (в списке есть
  заготовка конфига `yandex-metrica`).
- Измерения (гистограммы) наружу не отправляются — `accepts` у webhook только `event`.
- Алертов пока нет; `dispatch` ручной или по внутреннему интервалу 15 с.
