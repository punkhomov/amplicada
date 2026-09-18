---
title: Метрики — каталог контрактов
type: plan
tier: 2
status: draft
date: 2026-09-18
---

# Метрики: каталог контрактов

Часть плана `2026-09-18-metrics-module`. Здесь — типы, семантика и правила, по которым
строятся источники, хранилище, выходы и UI. Задача раздела: **новый потребитель или выход
добавляется адаптером к этим контрактам, а не переделкой ядра**. Эскизы на TypeScript — не
финальный код, но сигнатуры и инварианты считаются обязательными.

Ссылки на индустрию: OTel Metrics Data Model <https://opentelemetry.io/docs/specs/otel/metrics/data-model/>,
OTel DB semconv <https://opentelemetry.io/docs/specs/semconv/db/database-metrics/>,
PostHog Events <https://posthog.com/docs/data/events>,
Segment Common fields <https://www.twilio.com/docs/segment/connections/spec/common>,
Plausible Events API <https://plausible.io/docs/events-api>.

## 0. Принципы

1. **Конверт один, смысл — в имени и атрибутах.** Никаких «своих форматов» у модулей.
2. **Никаких персональных данных в открытом виде.** Актор — только псевдоним (HMAC).
   Сырые IP/UA не покидают точку сбора; логин/e-mail/имя не попадают в атрибуты вообще.
3. **Низкая кардинальность по умолчанию.** Динамические значения (URL, id, значения фильтров)
   нормализуются до шаблонов (`/users/:id`) или не попадают в измерения.
4. **Деградация вместо отказа.** Переполнение кардинальности, невалидный батч, недоступный sink —
   всё даёт частичный успех/overflow-бакет, а не 500 и не тихую потерю.
5. **Идемпотентность.** У события и точки — стабильный id; повторная доставка не задваивает данные.
6. **Версионирование.** `schemaVersion` в конверте + реестр имён; имена не переиспользуются.

## 1. Таксономия имён

| Пространство | Примеры | Кто эмитит | Хранение |
|---|---|---|---|
| `page.*` | `page.view`, `page.leave` | клиентский трекер | events |
| `ui.*` | `ui.click`, `ui.form.submit` | клиентский трекер | events |
| `error.*` | `error.frontend`, `error.backend` | клиент/сервер | events |
| `web_vital.*` | `web_vital.lcp`, `web_vital.inp` | клиент (PerformanceObserver) | events |
| `<module>.*` | `support.thread.opened`, `workflow.instance.completed`, `learning.course.completed` | модули через `metrics.emit` | events |
| `system.*` | `system.startup`, `system.migration` | core/модули | events |
| `http.server.*`, `http.client.*` | `http.server.request.duration` | HTTP-коллектор | measurements |
| `db.client.*` | `db.client.operation.duration` | SQL-коллектор | measurements |
| `task.*` | `task.run.duration` | task-коллектор | measurements |
| `metrics.*` | self-метрики самого модуля (ingest lag, overflow) | модуль | measurements |

Правила:

- `snake_case` в имени конверта, `dot`-разделители; для измерений — OTel-имена
  (`http.server.request.duration`) и OTel-unit'ы (`s`, `By`, `{request}`, `1`).
- Никаких значений в имени: не `error.frontend.TypeError`, а `error.frontend` + атрибут
  `error.type = TypeError`. Исключение — стабильные перечисления в дизайне (`web_vital.lcp`).
- Бизнес-пространство — по id модуля без `module-` (`support.`, `hr.`, `workflow.`, `learning.`).
- Депрекация: имя живёт, пока есть читатели; новое — новое имя; реестр хранит
  `deprecatedAt`/`replacedBy`.

## 2. Конверт события

```ts
export type Iso = string; // ISO 8601 UTC, миллисекунды
export type AttrValue = string | number | boolean;

export type MetricEventKind =
  | 'page'      // page.view/page.leave
  | 'ui'        // клики, submit, раскрытия
  | 'error'     // клиентские и серверные ошибки
  | 'web_vital' // LCP/INP/CLS/FCP/TTFB
  | 'business'  // предметные события модулей
  | 'system';   // старт, миграции, включение/выключение

export type ActorKind = 'user' | 'anonymous' | 'system' | 'service';

export interface ActorRef {
  kind: ActorKind;
  /** HMAC(соль назначения, userId). Прямых id/логинов нет by design. */
  pseudonym?: string;
}

export interface EventContext {
  route?: string;           // шаблон: /support/:id (никогда не сырой URL в измерениях)
  url?: string;             // сырой URL — только в отдельной колонке raw, с TTL
  referrer?: string;
  utm?: { source?: string; medium?: string; campaign?: string; term?: string; content?: string };
  release?: string;         // версия приложения/сборки
  instance?: string;        // hostname/worker id
  device?: { type?: 'desktop' | 'mobile' | 'tablet' | 'bot'; browser?: string; os?: string; language?: string; screen?: string };
  requestId?: string;
  traceId?: string;
  spanId?: string;
}

export interface MetricEvent {
  id: string;                // uuid v7; дедуп при повторной доставке
  name: string;              // таксономия из §1
  kind: MetricEventKind;
  occurredAt: Iso;           // когда произошло (у клиента)
  sentAt?: Iso;              // когда отправлено точкой
  receivedAt: Iso;           // когда принято сервером (clock-skew правится: occurred = received − (sent − occurred))
  source: {
    collector: 'client' | 'http' | 'sql' | 'task' | 'module' | 'system';
    module?: string;         // для business: support-chat
    version?: string;        // версия SDK/сборщика
  };
  actor?: ActorRef;
  sessionId?: string;        // 30 минут неактивности → новая сессия (как PostHog/Matomo)
  context: EventContext;
  attributes: Record<string, AttrValue>; // ≤ 32 ключей, значения ≤ 256 символов
  measures?: Record<string, number>;     // числовые значения события (duration_ms, score)
  sampling?: { rate: number; reason?: 'always' | 'slow' | 'error' | 'probability' };
  schemaVersion: number;     // версия этого контракта/набора атрибутов
}
```

Инварианты:

- `id` генерирует **точка сбора** (клиент — crypto.randomUUID; сервер — uuid v7); повторный
  приём того же `id` — no-op (PK + `ON CONFLICT DO NOTHING`).
- Батч валидируется целиком; валидные события принимаются даже при невалидных соседях
  (`allow_partial_failures`, ответ 202 + отчёт по rejected).
- `attributes` не хранят ничего, что позволяет восстановить личность: логин, email, ФИО,
  телефон, сырой IP, `Authorization`, тела запросов. Это проверяется allow-list'ом в ingest.

## 3. Измерения (OTel-подобная модель)

```ts
export type InstrumentKind = 'counter' | 'gauge' | 'histogram';
export type Temporality = 'delta' | 'cumulative';

export interface Instrument {
  name: string;              // http.server.request.duration
  kind: InstrumentKind;
  unit: '1' | 's' | 'ms' | 'By' | '{request}' | '{row}' | '{task}';
  description?: string;
  temporality?: Temporality; // counter: delta по умолчанию, cumulative — opt-in
  /** Явные границы гистограммы. Дефолт для latency — OTel: 0.005…10 s. */
  boundaries?: readonly number[];
  cardinalityLimit?: number; // default 2000, как в OTel SDK
}

export interface HistogramValue {
  count: number;
  sum: number;
  min?: number;
  max?: number;
  boundaries: readonly number[];
  bucketCounts: readonly number[];
}

export interface Measurement {
  instrument: Instrument;
  time: Iso;
  dimensions: Record<string, AttrValue>; // route, http.method, status.class, release, instance
  value: number;                          // observation (counter delta / gauge / latency sample)
  histogram?: HistogramValue;             // если точка уже агрегирована внутри процесса
  sampling?: { rate: number; reason?: 'always' | 'slow' | 'error' | 'probability' };
  exemplar?: { traceId?: string; spanId?: string; value: number };
}
```

Инварианты:

- **Никаких `user.id`, `session.id`, `request.id`, `trace.id` в `dimensions`** — это
  cardinality explosion (см. §11). Актор живёт в событиях, не в измерениях.
- `route` — всегда шаблон (`request.routeOptions.url` в Fastify 5), unmatched → `"<unmatched>"`.
- Overflow: при превышении `cardinalityLimit` новые серии уходят в бакет
  `dimensions.__overflow = true`; счётчик overflow виден как `metrics.self.cardinality_overflow.total`.
- Гистограмма — основной способ получать p50/p95/p99 по истории; точные перцентили считаются
  только по сырым точкам короткого окна (`percentile_cont`, см. `02-offline-stack.md`).

## 4. Источники и сборщики

```ts
export interface MetricCollector {
  id: string;                 // 'client-ingest' | 'http' | 'sql' | 'task' | 'client-rum' | ...
  start?(context: CollectorContext): Promise<void>;
  stop?(): Promise<void>;
  /** Сброс буферов: вызывается при shutdown до закрытия стора. */
  flush?(): Promise<void>;
}

export interface CollectorContext {
  emit(events: MetricEvent[]): void;
  measure(points: Measurement[]): void;
  config: MetricsRuntimeConfig; // sampling, caps, retention и т.п.
}
```

- **`client-ingest`** — HTTP-приём клиентских батчей (см. `02-offline-stack.md` §3.1).
- **`http`** — root-хук `onResponse` из core-точки `http:observer` (см. §10).
- **`sql`** — обёртка `pg-pool` + опциональный снимок `pg_stat_statements`.
- **`task`** — подписка на `TASK_EVENTS` (started/succeeded/failed).
- **`module`** — сервис `metrics` для бизнес-событий (`emit`/`measure`).
- **`client-rum`** — Web Vitals и ошибки браузера (собираются трекером, приезжают через `client-ingest`).

### Публичный сервис `metrics` (для модулей)

```ts
export interface MetricsService {
  /** Бизнес-событие: id/occurredAt/receivedAt/source.actor проставит модуль. */
  emit(input: MetricEventInput): void;
  emitBatch(inputs: MetricEventInput[]): void;
  /** Числовое измерение (например, «размер очереди»). */
  measure(input: MeasurementInput): void;
  /** Дождаться сброса буферов (тесты, shutdown). */
  flush(): Promise<void>;
}

export type MetricEventInput = Omit<MetricEvent, 'id' | 'receivedAt' | 'source' | 'actor' | 'schemaVersion'> & {
  id?: string; actor?: ActorRef; source?: Partial<MetricEvent['source']>;
};
```

Правило для модулей: **бизнес-метрики эмитятся через сервис, а не пишутся в таблицы**
(`context.services.resolve<MetricsService>('metrics')`). Сервис не бросает при переполнении —
он деградирует (drop + self-метрика).

## 5. Реестр определений (бизнес-смысл и UI модулей)

Определения отделяют «что случилось» (данные) от «как это называется и показывается».

```ts
export interface DimensionDefinition {
  key: string;                 // severity, kind, module
  titleKey: string;            // i18n: metrics:support.severity.title
  type: 'string' | 'number' | 'boolean' | 'datetime';
  highCardinality?: boolean;   // UI не предлагает как группировку по умолчанию
}

export interface MetricDefinition {
  key: string;                 // support.first_response   (глобально уникален)
  module: string;              // support-chat
  titleKey: string;
  descriptionKey?: string;
  category: 'product' | 'business' | 'technical' | 'quality';
  source: { events?: string[]; instrument?: string }; // events: ['support.thread.opened']
  unit?: Instrument['unit'];
  aggregation?: Aggregate;
  dimensions?: DimensionDefinition[];
  docsUrl?: string;
}

export interface MetricPanel {
  id: string;
  titleKey: string;
  kind: 'timeseries' | 'bar' | 'table' | 'stat' | 'funnel' | 'retention' | 'events';
  query: MetricsQuery;
  options?: Record<string, unknown>; // стек, легенда, пороги
  layout?: { w: 1 | 2 | 3 | 4 | 6 | 12; h?: number };
}

export interface MetricDashboard {
  id: string;                  // support.overview
  module: string;
  titleKey: string;
  order?: number;
  panels: MetricPanel[];
}
```

Точки расширения (конвенция id, как `floating`/`header`):

| Точка | Контрибуция | Кто читает |
|---|---|---|
| `metrics:definitions` | `MetricDefinition` | UI каталога, панели, query-валидатор |
| `metrics:panels` | `MetricPanel` / `MetricDashboard` | админ-приложение метрик |
| `metrics:sinks` | фабрика `MetricSink` | outbox-диспетчер |
| `metrics:alert-presets` | `MetricAlertRule` (шаблоны правил) | UI алертов |

## 6. Контракт хранилища

Разделение read/write — чтобы реализация могла быть Postgres сегодня и ClickHouse завтра без
изменения сбора и UI.

```ts
export interface WriteResult { accepted: number; duplicates: number; overflow: number; rejected: number; }

export interface MetricsWriter {
  writeEvents(events: MetricEvent[]): Promise<WriteResult>;
  writeMeasurements(points: Measurement[]): Promise<WriteResult>;
  /** Инкрементальный пересчёт роллапов начиная с watermark (late-arriving через lookback). */
  rollup(resolution: RollupResolution): Promise<{ buckets: number; until: Iso }>;
  prune(what: 'events' | 'points' | 'rollups', before: Iso): Promise<number>;
}

export interface MetricsReader {
  query(query: MetricsQuery): Promise<QueryResult>;
  events(filter: EventFilter, page: Page): Promise<MetricEvent[]>;
  dimensions(metric: string, from: Iso, to: Iso, limit: number): Promise<DimensionValue[]>;
  catalog(): Promise<MetricCatalogEntry[]>; // что уже приходило: имена, объём, last seen
}

export interface MetricsStore extends MetricsWriter, MetricsReader {
  readonly kind: 'postgres' | 'clickhouse';
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
```

### Запрос (`MetricsQuery`) — AST-подмножество

Никакого PromQL-парсера в первой версии: фиксированный набор операций, который потом можно
компилировать из PromQL/Prometheus HTTP API (см. §11).

```ts
export type Aggregate = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'p50' | 'p90' | 'p95' | 'p99';

export interface Filter {
  key: string;                 // route | http.status_code | attributes.severity
  op: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists';
  value: AttrValue | AttrValue[];
}

export type MetricsQuery =
  | { kind: 'series'; metric: string; source: 'measurement' | 'event'; from: Iso; to: Iso;
      step: number | 'auto'; aggregate: Aggregate; groupBy?: string[]; filters?: Filter[];
      orderBy?: 'time'; limit?: number }
  | { kind: 'top'; metric: string; source: 'measurement' | 'event'; from: Iso; to: Iso;
      by: string[]; measure: Aggregate; filters?: Filter[]; limit?: number }
  | { kind: 'events'; filters?: Filter[]; from: Iso; to: Iso; search?: string; page: Page }
  | { kind: 'funnel'; steps: { name: string; labelKey: string; filters: Filter[] }[]; windowMs: number;
      actor: 'pseudonym' | 'session'; countMode: 'first' | 'any'; from: Iso; to: Iso }
  | { kind: 'retention'; start: Filter[]; repeat: Filter[]; from: Iso; to: Iso;
      bucket: 'day' | 'week'; periods: number; actor: 'pseudonym' | 'session' };

export interface QueryResult {
  series: { name: string; labels: Record<string, AttrValue>; points: { t: Iso; v: number }[] }[];
  /** Для funnel/retention — табличная форма. */
  table?: { columns: { key: string; titleKey: string }[]; rows: AttrValue[][] };
  meta: { from: Iso; to: Iso; step: number; sampled: boolean; approximate: boolean };
}
```

Ограничения контракта: `step` не меньше 10 секунд; `groupBy` ≤ 3 измерений; глубина истории
для funnel/retention ограничена retention сырых событий (по умолчанию 30 дней, см. `02`).

## 7. Контракт выхода (sink)

```ts
export interface SinkCapabilities {
  maxBatchBytes?: number;        // Segment: 500 КБ; PostHog /batch: 20 МБ
  maxEvents?: number;            // Segment bulk: сотни тысяч; безопасный дефолт 1000
  rateLimitPerSecond?: number;   // Метрика: 30 rps
  supportsBackfill?: boolean;
  maxBackfillAge?: number;       // Метрика MP: 12 ч; offline conversions: 21 день атрибуции
  accepts: ('event' | 'measurement' | 'histogram')[];
  requires?: ('pseudonym' | 'session' | 'occurredAt' | 'userId' | 'clientId')[];
  /** Поля, которые sink умеет получить. Всё остальное отфильтровывается до очереди. */
  allowedPaths?: string[];
}

export interface SinkResult {
  ok: boolean;
  retryable?: boolean;     // 4xx (кроме 429) → не ретраим, в DLQ
  rejected?: string[];     // id отклонённых элементов
  message?: string;
}

export interface MetricSink {
  id: string;                 // 'yandex-metrica' | 'webhook' | 'csv'
  titleKey: string;
  capabilities: SinkCapabilities;
  enabled: boolean;
  /** Вызывается после записи в локальный стор (outbox). */
  send(batch: { items: SinkItem[]; attempt: number }, signal?: AbortSignal): Promise<SinkResult>;
  health?(): Promise<{ ok: boolean; lastError?: string; lastSuccessAt?: Iso }>;
}

export type SinkItem = { id: string; kind: 'event' | 'measurement'; payload: MetricEvent | Measurement };
```

Семантика доставки (по образцу Segment Delivery Overview):

- Событие сначала пишется в **локальный стор**, затем — в `metrics.outbox` для каждого
  включённого sink'а (at-least-once).
- Ретраи: экспоненциальный backoff с jitter, максимум 6 попыток за 4 часа; 4xx без 429 → DLQ.
- Идемпотентность на приёмнике — `item.id` (у Метрики аналога нет: дедуп по `(sink, itemId)`
  в outbox, повторная отправка исключена).
- Журнал `metrics.sink_deliveries` — статусы, ошибки, счётчики (для UI «Доставка»).
- PII-фильтр по `allowedPaths` применяется **до** очереди: в закрытом контуре наружу физически
  нечему уходить.

## 8. Контракт алертов

```ts
export type AlertCondition =
  | { kind: 'threshold'; aggregate: Aggregate; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number; forMs?: number }
  | { kind: 'ratio'; numerator: Filter[]; denominator: Filter[]; op: 'gt' | 'gte' | 'lt' | 'lte';
      value: number; forMs?: number }  // доля 5xx, доля отказов
  | { kind: 'absence'; forMs: number };  // молчание метрики

export interface MetricAlertRule {
  id: string;
  name: string;
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
  target: { kind: 'measurement' | 'event' | 'definition'; key: string; filters?: Filter[] };
  windowMs: number;
  condition: AlertCondition;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  /** Куда доставлять: шина событий (→ будущий notification) и/или sink. */
  delivery: { eventBus?: boolean; sinkIds?: string[] };
}

export interface MetricAlertEvent {
  ruleId: string;
  state: 'pending' | 'firing' | 'resolved';
  severity: MetricAlertRule['severity'];
  value: number;
  labels: Record<string, string>;
  activeAt: Iso;
  resolvedAt?: Iso;
}
```

Реализация: правило — **данные**, evaluator — задача task-scheduler (раз в минуту), состояние
`pending/firing` переживает рестарт (таблица инстансов). События `MetricAlertEvent` летят в
`context.eventBus`, откуда их заберёт notification-модуль, когда появится; до тех пор —
опциональный webhook-sink. Пороговые формулы и SLO burn-rate (14.4×/6× для 30 дней) — в `02`.

## 9. Версионирование и совместимость

- `schemaVersion` — целое, общее для контракта события; изменение без обратной совместимости
  поднимает версию, читатели обязаны поддерживать предыдущую (≥ 1 мажор).
- Имена метрик/событий не переиспользуются: переименование = новое имя + запись в реестре
  `replacedBy` (аналог OTel schema rename).
- Адаптеры sinks сами транслируют внутренние имена во внешние (goal ID Метрики, webhook-поля) —
  внутренняя таксономия не зависит от внешних сервисов.
- Контракты лежат в `src/contracts/` пакета и экспортируются через `./contracts` — модули не
  импортируют внутренности `module-metrics`.

## 10. Минимальные изменения core (обоснование)

Без них модуль соберёт не всё; всё остальное делается в модуле.

| Изменение | Зачем | Альтернатива и почему хуже |
|---|---|---|
| Root-хук `onResponse`, читающий контрибуции `http:observer` из `context.extensions` | HTTP-метрики **всех** роутов, включая зарегистрированные другими модулями | `app.addHook('onRoute')` в модуле: зависит от порядка setup, ранние модули не покрываются; `fastify-plugin` всё равно не отменяет порядок |
| Сервис `config`/`secrets` (чтение env, неймспейс) | Соль HMAC, будущие ключи провайдеров; модулям запрещено читать env напрямую | Соль в БД (ключ рядом с данными — против 152-ФЗ); env напрямую (ломает конвенцию) |
| Хук ошибок фронтенда (`createFrontendApp`/`FrontendProvider`) | `onUncaughtError`/`onCaughtError` React 19 живут в `createRoot` приложения | Модуль видит только `window.onerror`/`unhandledrejection` — часть ошибок рендера теряется |

## 11. Отвергнутое (не предлагать повторно)

1. **Одна таблица на события и измерения.** Разные паттерны записи/чтения; измерения требуют
   гистограмм и OTel-семантики, события — атрибутов и акторов. Смешение даёт «никакой» дизайн.
2. **Документы (`core.document_index`) под события.** Высокая частота записи, нет жизненного цикла
   и правки — документный рантайм лишний (тот же вывод, что у support-chat, `notes/module-support-chat.md`).
3. **PromQL/OTLP как внутренний формат с первого дня.** Дорого и не нужно: внутренний AST-подмножество
   + OTLP/PRW как адаптеры на выходе/входе позже.
4. **Клиентский скрипт внешнего сервиса как основной механизм.** В закрытом контуре не работает,
   зависит от блокировщиков; внешние сервисы — только sink'и.
5. **Публичный write-key для ингестии (модель Sentry DSN).** Для внутриплатформенного SPA достаточно
   сессионной аутентификации и same-origin; публичный ключ расширяет поверхность атаки.
6. **Хранение сырых URL/SQL с литералами.** Кардинальность + PII. Только нормализованные формы,
   сырое — в отладочную колонку с коротким TTL и выключенным по умолчанию режимом.
7. **Отдельный аналитический сервис (ClickHouse/Grafana) сразу.** Владелец просил не покидать
   платформу; Postgres на целевом масштабе держит (расчёты в `02`), путь к ClickHouse — за
   контрактом `MetricsStore`.
