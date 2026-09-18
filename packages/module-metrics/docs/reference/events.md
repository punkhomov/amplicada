---
title: "События"
type: reference
updated: 2026-09-18
verified_commit: 9e0cfb80
order: 10
---

# События

Конверт события и правила приёма. Код: `src/contracts/types.ts`, `src/backend/services/validation.ts`.

## Конверт `ClientEventInput`

| Поле | Тип | Обязательно | Правила |
|---|---|---|---|
| `id` | uuid | да | Ключ идемпотентности; повтор с тем же `id` не создаёт вторую строку |
| `name` | string | да | `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, ≤ 100 символов |
| `kind` | enum | да | `page`, `ui`, `error`, `web_vital`, `business`, `system` |
| `occurredAt` | ISO 8601 | да | Не старше 7 суток; будущее обрезается до «сейчас + 5 минут» |
| `sessionId` | string | нет | ≤ 64 символов; на сервере превращается в `session_hash` (HMAC) |
| `context.route` | string | нет | Шаблон маршрута, ≤ 256 символов |
| `context.url` | string | нет | Сохраняется только при `store_raw_urls = true` |
| `context.referrer` | string | нет | ≤ 512 символов |
| `attributes` | object | нет | ≤ 32 пар; ключи `^[a-z][a-z0-9_]{0,63}$`; строки ≤ 256 символов |
| `measures` | object | нет | ≤ 16 числовых значений |
| `sampling` | `{rate, reason?}` | нет | `rate` ∈ [0, 1] |

Серийное событие (с атрибутами и measures) не должно превышать 8 КБ.

## Таксономия имён

- `page.*` — просмотры (`page.view`), эмитит клиентский трекер.
- `ui.*` — интерфейсные события; зарезервировано на этапы 01–02.
- `error.*`, `web_vital.*` — этап 04.
- `<module>.*` — бизнес-события модулей (`support.thread.opened`), этап 03.
- Значения не кодируются в имя: `error.frontend` + `attributes['error.type']`, а не
  `error.frontend.TypeError`.

Правила и отвергнутые альтернативы — `ref/notes/module-metrics.md`.

## Дедупликация

`metrics.events` имеет PK `(occurred_at, id)`; вставка идёт `ON CONFLICT DO NOTHING`
(`src/backend/services/metrics-store.ts`). Ответ приёма содержит `duplicates` — сколько
элементов батча уже было.

## Псевдонимизация

- `actorHash` — HMAC(соль, `analytics:<userId>`) для авторизованных, `null` для анонимов;
  `actorKind` = `user` | `anonymous`.
- `sessionHash` — HMAC(соль, `session:<sessionId>`).
- Сырые `identity_user.id`, логины и IP не сохраняются.

Подробности — [explanation/pseudonymization.md](../explanation/pseudonymization.md).

## Для модулей-потребителей

Эмита бизнес-событий через сервис `metrics` пока **нет** (этап 03 плана): сервис умеет
`collect` (клиентский путь), `listEvents`, `getSettings/updateSettings`, `getContext`,
`ensurePartitions`, `prune` (`src/backend/services/metrics-service.ts`). Импортировать типы
безопасно в любой момент: `import type { ... } from '@amplicada/module-metrics/contracts'`.
