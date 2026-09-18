---
title: "Бизнес-метрики: emit, определения, панели"
type: reference
updated: 2026-09-18
verified_commit: 9e0cfb80
order: 50
---

# Бизнес-метрики: emit, определения, панели

Как модули отдают свои события и получают их на дашборде, не завися от UI и хранилища метрик.
Код: `src/backend/services/metrics-service.ts` (`emit`), `src/contracts/types.ts`
(`MetricDefinition`, `MetricPanel`), `src/frontend/lib/panel-registry.ts`.

## Emit: событие модуля

```ts
const metrics = context.services.has('metrics')
  ? context.services.resolve<{ emit(event: unknown): void }>('metrics')
  : undefined;

metrics?.emit({
  name: 'support.thread.opened',   // таксономия <module>.*
  kind: 'business',                // по умолчанию business
  module: 'support-chat',
  actor: { kind: 'user', userId }, // userId сразу превращается в псевдоним
  attributes: { kind: 'question' },
});
```

- `MetricEventInput`: `name`, опциональные `kind`, `occurredAt`, `module`, `actor`, `sessionId`,
  `context`, `attributes`, `measures`.
- Идемпотентность и время проставляет сервис; событие валидируется теми же лимитами, что и
  клиентские (имя, 32 атрибута, 8 КБ), затем попадает в буфер и уезжает в журнал при флаше
  (≈10 секунд).
- `actor.userId` псевдонимизируется HMAC; сам id и логин не сохраняются.
- Интеграция опциональна: модуль проверяет `context.services.has('metrics')` и импортирует
  только типы (era runtime-зависимость не обязательна).

## Определения: что метрика значит

Модуль контрибует определения в extension point `metrics:definitions` из своего setup:

```ts
context.extensions.contribute('metrics:definitions', {
  key: 'support.threads_opened',
  module: 'support-chat',
  titleKey: 'support-chat:metrics_threads_opened', // i18n-ключ модуля
  category: 'business',
  source: { events: ['support.thread.opened'] },   // или eventPrefix: 'ui.'
});
```

`GET /api/metrics/definitions` отдаёт все определения, `GET /api/metrics/definitions/summary`
— по каждому: `total` за период и точки тренда (шаг подбирается по длине окна).
Встроенные определения модуля метрик: `metrics.page_views`, `metrics.ui_events`.

## Панели: графики на дашборде метрик

Модуль регистрирует панели во frontend-сервисе `metrics:panels` (токен — литерал, чтобы не
тянуть runtime-импорт модуля метрик):

```ts
const panels = context.services.resolve<MetricsPanelsService>('metrics:panels');
panels.register({
  id: 'support-chat.threads-opened',
  titleKey: 'support-chat:panel_threads_opened',
  kind: 'timeseries',
  event: 'support.thread.opened',
});
```

Вкладка «Панели» строит графики через `/api/metrics/series?name=<event>` на вендоренном
`ui/chart` + `recharts`. Панель — только имя события и заголовок: данные и лимиты остаются
на стороне сервиса метрик.

## HTTP

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/metrics/definitions` | Все определения |
| `GET` | `/api/metrics/definitions/summary?from&to&step` | Totals + тренды определений |
| `GET` | `/api/metrics/series?name\|eventPrefix&from&to&step&groupBy&measure` | Серия событий (count или sum measures) |

`step` — секунды (по умолчанию 5 мин для окна ≤ 2 ч, 1 ч для ≤ 48 ч, 6 ч дальше).
Ошибки: 400 `name_or_eventPrefix_required`, `invalid_range`.

## Пример: поддержка

`module-support-chat` эмитит `support.thread.opened`, `support.message.sent`,
`support.thread.status_changed`, объявляет три определения и две панели — это эталон
опциональной интеграции (см. `ref/notes/module-support-chat.md` D-013).

## Ограничения

- Воронки и retention-когорты не реализованы (отложено, `ref/notes/module-metrics.md`).
- Панели — только `timeseries`; фильтры/сегменты и сохранение дашбордов — позже.
- `emit` не бросает ошибок и не блокирует caller: буфер кольцевой, при переполнении
  вытесняются старые события.
