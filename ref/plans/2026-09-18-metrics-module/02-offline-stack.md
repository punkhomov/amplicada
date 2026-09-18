---
title: Метрики — оффлайн-стек, конвейеры и эксплуатация
type: plan
tier: 2
status: draft
date: 2026-09-18
---

# Метрики: оффлайн-стек

Часть плана `2026-09-18-metrics-module`. Контракты — в `01-contracts.md`, рамка и этапы — в
`00-overview.md`. Здесь — как всё устроено внутри платформы: пакет, схема, сбор, агрегация,
UI, алерты, выходы, приватность, масштаб и документация. Числа и практики — из
deep research (источники по ходу текста).

## 1. Пакет и композиция

По конвенциям `module-support-chat` (см. `ref/guides/module-structure.md`):

```
packages/module-metrics/
├── package.json            # amplicada: true; exports ./backend ./frontend ./contracts ./frontend/tailwind.css
├── tsconfig.json           # extends ../../tsconfig.json
├── migrations/             # 0000_init…, meta/_journal.json (вручную, drizzle-kit не подключён)
└── src/
    ├── contracts/          # типы из 01-contracts.md, HTTP-DTO, события, manifest
    ├── backend/
    │   ├── setup.ts        # регистрация миграций/сервисов/роутов/коллекторов/задач
    │   ├── schemas/        # drizzle: settings, events, series, points, rollups, outbox, alerts, saved views
    │   ├── services/       # metrics-service, pseudonym, store (postgres), rollup, sinks, alerts
    │   ├── collectors/     # http, sql, task, client-ingest, pg-stat
    │   └── routes.ts
    └── frontend/
        ├── setup.tsx       # admin app + floating-трекер + extension points
        ├── lib/            # api-client обёртки, query-options, formats
        ├── pages/          # overview, explore, dashboards, routes, sql, errors, alerts, delivery, settings
        ├── widgets/        # chart-panel, event-list, time-range, dimension-picker
        └── locales/{ru,en}.json
```

- Peer'ы: `@amplicada/platform-core`, `@amplicada/module-admin` (для admin app). Остальные модули
  **не зависят** от метрик: они импортируют только типы из `@amplicada/module-metrics/contracts`
  (стирается при сборке) и проверяют доступность сервиса через `context.services.has('metrics')`.
- Пакет добавляется в `dependencies` `apps/api` и `apps/web`, после чего `pnpm modules:generate`
  сам подключит его к обоим приложениям (`amplicada: true`).
- Задачи: `context.tasks.register('metrics.rollup', …, handler)` и `metrics.retention`,
  `metrics.alerts.evaluate`, `metrics.sinks.dispatch` — расписания настраиваются в админке
  (task-scheduler хранит cron в `core.scheduled_tasks`).

## 2. Схема Postgres

Отдельная схема `metrics` (как `support_chat`), миграции вручную.

### 2.1 Настройки (синглтон, паттерн `support_chat.settings`)

```sql
create table metrics.settings (
  id                       text primary key default 'default' check (id = 'default'),
  enabled                  boolean not null default true,
  retention_events_days    integer not null default 30,
  retention_points_days    integer not null default 30,
  retention_rollups_days   integer not null default 395,
  sample_pageview_rate     real    not null default 1.0,
  sample_click_rate        real    not null default 0.10,
  sample_http_rate         real    not null default 1.0,
  sample_sql_rate          real    not null default 1.0,
  slow_sql_threshold_ms    integer not null default 1000,
  store_raw_urls           boolean not null default false,
  max_event_bytes          integer not null default 8192,
  cardinality_limit        integer not null default 2000,
  pseudonym_errors_version text    not null default 'v1',
  updated_at               timestamptz not null default now()
);
insert into metrics.settings (id) values ('default') on conflict do nothing;
```

### 2.2 События (партиции по месяцу)

```sql
create table metrics.events (
  id            uuid        not null,
  occurred_at   timestamptz not null,
  received_at   timestamptz not null default now(),
  name          text        not null,
  kind          text        not null,           -- page|ui|error|web_vital|business|system
  module        text,
  actor_kind    text,                            -- user|anonymous|system|service
  actor_hash    text,                            -- псевдоним, никогда не id
  session_hash  text,
  route         text,                            -- шаблон, никогда сырой URL
  url           text,                            -- только при settings.store_raw_urls (выкл.)
  release       text,
  instance      text,
  attributes    jsonb       not null default '{}'::jsonb,
  measures      jsonb       not null default '{}'::jsonb,
  sampling_rate real,
  schema_version integer    not null default 1,
  primary key (occurred_at, id)
) partition by range (occurred_at);

create index events_name_time_idx on metrics.events (name, occurred_at desc);
create index events_actor_time_idx on metrics.events (actor_hash, occurred_at desc) where actor_hash is not null;
create index events_session_time_idx on metrics.events (session_hash, occurred_at) where session_hash is not null;
create index events_time_brin on metrics.events using brin (occurred_at) with (pages_per_range = 32);
```

Почему так: BRIN по времени даёт единицы МБ там, где btree на 100M строк — гигабайты
(<https://www.crunchydata.com/blog/postgres-indexing-when-does-brin-win>); btree строится только под
реальные фильтры. `jsonb` — «хвост» атрибутов, горячие измерения вынесены в колонки, GIN не
заводим по умолчанию (может достигать 66–80% размера таблицы,
<https://www.pgday.ch/common/slides/2024_gin_jsonb.pdf>). Партиции 1–20 ГБ — месячная при
1M событий/день даёт ~6–8 ГБ (<https://mydba.dev/blog/postgres-partition-maintenance-guide>).

### 2.3 Измерения (series + points)

```sql
create table metrics.series (
  id          bigint generated always as identity primary key,
  instrument  text not null,            -- http.server.request.duration
  kind        text not null,            -- counter|gauge|histogram
  unit        text not null,
  boundaries  real[],
  dims        jsonb not null default '{}'::jsonb,
  dims_hash   text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (instrument, dims_hash)
);

create table metrics.points (
  series_id bigint      not null,
  bucket    timestamptz not null,       -- начало окна пред-агрегации (10–60 с)
  count     bigint      not null default 1,
  sum       double precision,
  min       double precision,
  max       double precision,
  value     double precision,           -- gauge
  histogram jsonb,                      -- {boundaries, bucketCounts, count, sum, min, max}
  primary key (bucket, series_id)
) partition by range (bucket);
```

**Ключ к масштабу — пред-агрегация в процессе** (как в OTel SDK): коллекторы копят histogram/counter
в памяти и сбрасывают раз в 10–60 с одну строку на (серия, окно), а не сырые точки. При 5–20 rps
это тысячи строк/минуту вместо миллионов.

### 2.4 Роллапы

```sql
create table metrics.rollups (
  resolution text        not null,      -- '5m' | '1h' | '1d'
  bucket     timestamptz not null,
  metric     text        not null,      -- имя измерения или события
  source     text        not null,      -- measurement|event
  dims       jsonb       not null default '{}'::jsonb,
  dims_hash  text        not null,
  count      bigint      not null default 0,
  sum        double precision not null default 0,
  min        double precision,
  max        double precision,
  histogram  jsonb,
  primary key (resolution, bucket, metric, dims_hash)
) partition by range (bucket);

create table metrics.rollup_watermarks (
  resolution text primary key,          -- '5m'
  last_bucket timestamptz not null,
  updated_at timestamptz not null default now()
);
```

Резолюции и сроки: `5m` — 14 дней, `1h` — 90 дней, `1d` — retention (395 дней
по умолчанию ≈ 13 месяцев). Гибрид: сырые события/точки — «горячее окно» для воронок и точных
перцентилей; роллапы — история для графиков и алертов. Инкрементальный пересчёт одной SQL-транзакцией:

```sql
insert into metrics.rollups (resolution, bucket, metric, source, dims, dims_hash, count, sum, min, max, histogram)
select '5m', date_bin('5 min', occurred_at, '2000-01-01'), name, 'event', '{}'::jsonb, '', count(*), 0, null, null, null
from metrics.events
where occurred_at >= $1 and occurred_at < now() - interval '30 seconds'
group by 1, 3
on conflict (resolution, bucket, metric, dims_hash) do update
set count = metrics.rollups.count + excluded.count,
    sum   = metrics.rollups.sum   + excluded.sum;
-- watermark обновляется в той же транзакции; lookback-окно 1h пересчитывает late-arriving
```

Практика инкрементальных роллапов вместо materialized views: MV с `REFRESH` пересчитывает всё
окно целиком и держит блокировки (<https://www.citusdata.com/blog/2018/10/31/materialized-views-vs-rollup-tables/>,
<https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html>). TimescaleDB CAGGs не
берём: Community-функции под TSL, а для append-only event log хватает vanilla + партиций
(<https://github.com/timescale/docs/blob/latest/about/timescaledb-editions.md>).

### 2.5 Очередь выходов и журнал доставки

```sql
create table metrics.sink_configs (
  id         text primary key,                  -- 'yandex-metrica' | 'webhook' | 'csv'
  enabled    boolean not null default false,    -- ВСЁ внешнее выключено по умолчанию
  mapping    jsonb not null default '{}'::jsonb,-- include/exclude/goalMap/rename
  settings   jsonb not null default '{}'::jsonb,-- counterId и т.п. (без секретов)
  updated_at timestamptz not null default now()
);

create table metrics.outbox (
  id              bigint generated always as identity primary key,
  sink_id         text not null,
  item_kind       text not null,                -- event|measurement
  item_id         text not null,                -- идемпотентность
  payload         jsonb not null,
  status          text not null default 'pending', -- pending|sent|failed|dead
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  unique (sink_id, item_id)
);
create index outbox_due_idx on metrics.outbox (status, next_attempt_at) where status = 'pending';

create table metrics.sink_deliveries (
  id         bigint generated always as identity primary key,
  sink_id    text not null,
  item_id    text not null,
  status     text not null,                     -- sent|failed|dead
  attempts   integer not null,
  error      text,
  at         timestamptz not null default now()
);
```

### 2.6 Алерты и сохранённые представления

```sql
create table metrics.alert_rules (
  id         uuid primary key,
  name       text not null,
  enabled    boolean not null default true,
  severity   text not null default 'warning',
  target     jsonb not null,          -- {kind, key, filters}
  window_ms  bigint not null,
  condition  jsonb not null,
  delivery   jsonb not null default '{"eventBus": true}',
  labels     jsonb not null default '{}'::jsonb,
  annotations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table metrics.alert_instances (
  rule_id      uuid not null references metrics.alert_rules(id) on delete cascade,
  fingerprint  text not null,
  state        text not null,          -- pending|firing|resolved
  value        double precision,
  labels       jsonb not null default '{}'::jsonb,
  active_at    timestamptz not null,
  last_eval_at timestamptz not null default now(),
  resolved_at  timestamptz,
  primary key (rule_id, fingerprint)
);

create table metrics.saved_views (
  id         uuid primary key,
  owner_hash text not null,
  title      text not null,
  kind       text not null,            -- explore|dashboard|events
  query      jsonb not null,
  created_at timestamptz not null default now()
);
```

### 2.7 Примеры запросов SQL и ошибок (exemplars)

```sql
create table metrics.slow_queries (
  id          bigint generated always as identity primary key,
  at          timestamptz not null,
  fingerprint text not null,
  query_text  text not null,           -- нормализованный SQL, без литералов, ≤ 2 КБ
  route       text,
  duration_ms double precision not null,
  row_count   integer,
  error_code  text,
  request_id  text
) partition by range (at);            -- retention 7 дней
```

Сырые примеры хранятся выборочно: все медленнее порога + ошибки + 1% остального (tail-сэмплирование,
ср. Sentry: `tracesSampleRate`, ошибки 100% —
<https://docs.sentry.io/organization/dynamic-sampling/>).

## 3. Конвейеры сбора

### 3.1 Клиентский трекер

- Контрибуция в `floating` (как виджет поддержки) — компонент видит `useLocation` и живёт вне
  layout'ов.
- **Pageview** — на смену маршрута; `route` нормализуется клиентом (`/support/2f1c…` → `/support/:id`),
  сырой `url` — только при включённом `store_raw_urls`.
- **Сессия** — `sessionStorage`, ротация после 30 минут неактивности (отраслевой стандарт:
  PostHog/Matomo — <https://posthog.com/docs/data/sessions>).
- **UI-события** — точечные `data-metrics` атрибуты (не autocapture всего DOM): меньше объёма и
  никаких случайных PII. Автосбор кликов — по желанию, с сэмплированием 10%.
- **Web Vitals** — зависимость `web-vitals` (Apache-2.0, ~3 КБ): LCP/INP/CLS/FCP/TTFB, отправка
  `delta`-обновлений, `navigationType`, в SPA — `reportSoftNavs`. Библиотека закрывает
  краевые случаи, которые руками не покрыть (<https://github.com/GoogleChrome/web-vitals>).
- **Ошибки** — `window.onerror`, `unhandledrejection`, resource-errors (capture-фаза). React 19
  `onUncaughtError`/`onCaughtError` — через core-хук (§11), иначе часть ошибок рендера теряется.
- **Согласие и opt-out** — `GET /api/metrics/context` отдаёт `{enabled, sampleRates}`; трекер молчит
  при `settings.enabled=false`, `DNT: 1`/GPC и `localStorage['metrics.optout']='1'`.
- **Батчинг и доставка** — очередь в памяти, flush каждые 10 с/15 событий; при `visibilitychange →
  hidden` — `navigator.sendBeacon`; лимит beacon ≈ 64 КБ на все keepalive-запросы
  (<https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon>), поэтому батч режется
  на чанки ≤ 32 КБ. `sendBeacon === false` → фолбэк на `fetch(..., {keepalive:true})`; не
  доставленное при перезагрузке теряется (без localStorage-персистентности — решение осознанное,
  см. `01-contracts.md` §11).
- **Не собираем** содержимое форм, значения полей, тела ответов, e-mail/ФИО/телефоны; allow-list
  атрибутов на сервере (см. ниже).

### 3.2 Ingestion API

```
POST /api/metrics/collect        батч {events?, points?}; 202 {accepted, duplicates, overflow, rejected[]}
GET  /api/metrics/context        bootstrap-конфиг трекера (enabled, sampleRates, limits)
```

Лимиты: тело ≤ 256 КБ (Fastify per-route `bodyLimit`), событие ≤ `max_event_bytes` (8 КБ),
≤ 32 атрибута, значения ≤ 256 символов, батч ≤ 500 событий, rate-limit на сессию —
token bucket в Redis (100 событий/мин). Аутентификация: сессия (`auth-service`); анонимный узел
(`/api/auth/context` без `loginUrl`) допускает приём без сессии, но с rate-limit по IP-хешу.
Ответ 202 всегда, когда есть принятые элементы (partial success, как у OTLP
<https://opentelemetry.io/docs/specs/otel/protocol/exporter/>).

### 3.3 HTTP-коллектор (метрики роутов)

Требует точки в core (§11): root-хук `onResponse`, который на каждый ответ зовёт контрибуции
`http:observer`. Модуль регистрирует наблюдателя:

- `http.server.request.duration` (гистограмма, секунды, OTel-границы
  `0.005…10` — <https://opentelemetry.io/docs/specs/semconv/http/http-metrics/>);
- `http.server.request.body.size`, `http.server.response.body.size`;
- измерения: `route` (`request.routeOptions.url`), `method`, `status` (код + класс), `release`,
  `instance`, `error.type` (для 5xx/исключений).
- 404/unmatched → `route="<unmatched>"`, сырой URL не пишется.
- Дополнительно `http.server.active_requests` (gauge) — по счётчику in-flight.

### 3.4 SQL-коллектор

**Уровень приложения (всегда).** Обёртка `pg-pool`: перехват `pool.query` и `client.query`
(через `pool.connect`), длительность wall-clock, `rowCount`, `command`, код ошибки.
Даёт то, чего нет на уровне сервера: корреляцию с роутом/запросом через ALS-контекст.
Чего получить нельзя без сервера: план, буферы, wait events, `queryid` (см. pganalyze
<https://pganalyze.com/docs/collector>).

- Нормализация: схлопнуть whitespace, заменить строковые/числовые литералы на `?`, свернуть
  `IN (?, ?, …)` → `IN (?)`; `fingerprint = sha256(нормализованный SQL)` (подход OTel DB semconv —
  <https://opentelemetry.io/docs/specs/semconv/db/database-spans/>).
- Запись: **не сырые запросы**, а пред-агрегация в процессе: `db.client.operation.duration`
  (гистограмма) по `(fingerprint, route)` + счётчики; сброс раз в 10 с. Медленные/ошибочные
  экземпляры — в `metrics.slow_queries` (tail-сэмпл).
- Защита от рекурсии: запросы самого модуля (`metrics.*`, outbox) исключаются по флагу в ALS.
- `db.query.text` не хранится в измерениях; в `slow_queries` — нормализованный и обрезанный.

**Опционально `pg_stat_statements`.** Задача `metrics.pg-stat` раз в 5 минут (если расширение
доступно — проверка через `pg_extension`/`pg_settings`):
`calls`, `total_exec_time`, `rows`, `shared_blks_*`, `wal_bytes` по `queryid` с дельтами между
снимками. Это дополняет картину (план/буферы/WAL) там, где DBA разрешил
`shared_preload_libraries`; недоступность — не ошибка, в UI пометка «недоступно на этом узле».
Включение и цена (≈2.5% TPS на простом тесте — <https://fanael.github.io/measuring-pg_stat_statements-overhead.html>)
описаны в документации модуля.

### 3.5 Задачи, бизнес-события, self-метрики

- **Задачи** — подписка на `TASK_EVENTS` (шина in-process): `task.run.duration` (гистограмма) с
  `taskId`/`outcome`, счётчики `failed/timeout/orphaned`, событие `task.alert` → алерт-канал.
- **Бизнес-события** — сервис `metrics` (`context.services.resolve('metrics')`); модуль эмитит
  `support.thread.opened`, `workflow.instance.completed`, `learning.course.completed`.
  Псевдоним актора считает сервис (модуль передаёт `userId` входа либо `actor: 'system'`).
  Интеграция опциональна: модули делают `if (context.services.has('metrics')) …` и импортируют
  только типы — модуль метрик можно не включать в сборку.
- **Self-метрики** — `metrics.self.*`: размер буферов, ingest lag, overflow по кардинальности,
  размер outbox, длительность роллапа. Дашборд «Здоровье метрик» — первым в приложении.

## 4. Агрегация, перцентили, retention, кардинальность

- **Точные перцентили** — только по сырым точкам короткого окна: `percentile_cont(0.95)`
  (ordered-set, сортирует значения). **Исторические** — интерполяцией из гистограмм роллапов
  (подход `histogram_quantile`: кумулятивные бакеты + линейная интерполяция внутри бакета —
  <https://prometheus.io/docs/practices/histograms/>). Это в разы дешевле, чем t-digest-расширения
  (<https://www.citusdata.com/blog/2020/09/19/delivering-45x-faster-percentiles/>), и не требует
  расширений в закрытом контуре.
- **Воронки/retention** — по сырым событиям (нужен актор), поэтому глубина ограничена retention
  сырья (30 дней). Модель — как у PostHog: sequential/any order, окно конверсии, когорты по
  дню/неделе, actor = псевдоним или сессия (<https://posthog.com/docs/product-analytics/funnels>,
  <https://posthog.com/docs/product-analytics/retention>).
- **Retention** — ежедневная задача: `DETACH` + `DROP` партиций старше срока (никаких `DELETE`);
  `lock_timeout` + ретрай, чтобы не блокировать запись. Autovacuum на append-only: per-table
  `autovacuum_vacuum_insert_scale_factor = 0.02` и `VACUUM (FREEZE)` старых партиций —
  иначе freezing придёт «залпом» (<https://www.cybertec-postgresql.com/en/postgresql-autovacuum-insert-only-tables/>).
- **Кардинальные лимиты** — cap серий на инструмент (2000, как OTel SDK), cap групп в запросе (≤3),
  allow-list атрибутов, нормализация URL/SQL, overflow-бакет и self-метрика. OTel-опыт: превышение
  лимита не дропает данные, а сворачивает в overflow-точку
  (<https://opentelemetry.io/blog/2026/cardinality-limits-in-opentelemetry/>).
- **Сэмплирование** — head (решение на клиенте/в коллекторе): pageviews 100%, клики 10%, HTTP 100%,
  SQL 100% (но пред-агрегация), медленные и ошибки — всегда 100% (tail-принцип Sentry/Honeycomb).
  В каждом событии `sampling.rate`, чтобы агрегаты могли масштабироваться (`count / rate`).

## 5. Query API

```
GET/POST /api/metrics/query        MetricsQuery AST → QueryResult
GET      /api/metrics/events       эксплорер сырых событий (filters, search, page)
GET      /api/metrics/catalog      что уже приходило: имена, объём, first/last seen
GET      /api/metrics/dimensions   значения измерения для фильтров (с cardinality-cap)
админ:
GET/PATCH /api/metrics/admin/settings
GET/PATCH /api/metrics/admin/sinks[/:id]      + POST /admin/sinks/:id/test
GET       /api/metrics/admin/deliveries       журнал доставки
GET/POST/PATCH /api/metrics/admin/alert-rules + GET /admin/alerts (инстансы)
POST      /api/metrics/admin/rollup|prune     ручной прогон (эксплуатация)
```

Все ответы пагинированы; `dimensions` возвращает не более N значений и явно помечает overflow.
Походы в store — только через `MetricsStore` (сейчас `PostgresMetricsStore`).

## 6. Админ-приложение

Apps mode `module-admin` (как support-chat): регистрация `AdminApp` + слот шапки
(`useAdminHeader`) для диапазона времени/refresh. Страницы:

| Страница | Содержимое | Прообраз флоу |
|---|---|---|
| Обзор | карточки: пользователи/сессии/просмотры, ошибки, 5xx rate, p95 роутов; здоровье метрик | PostHog dashboards |
| Explore | конструктор запроса: метрика → фильтры → группировка → график/таблица; сохранение | Grafana Explore |
| Дашборды | панели, объявленные модулями (`metrics:panels`) + сохранённые пользователем | Grafana/PostHog |
| Роуты (RED) | rate/errors/duration по `route`, p50/p95/p99, лента медленных | Grafana RED |
| SQL | топ fingerprint'ов по времени, тренд, распределение, медленные экземпляры | pganalyze |
| Ошибки | issues: fingerprint, группировка, first/last seen, affected users, стек, релизы | Sentry Issues |
| Алерты | правила, инстансы (pending/firing), история | Grafana alerting |
| Доставка | sink'и, статусы, ретраи, DLQ | Segment Delivery Overview |
| Настройки | retention, сэмплирование, лимиты, приватность, включение sink'ов | — |

- Графики — вендоренный `ui/chart` + `recharts` (уже в зависимостях, уже в отдельном чанке
  `vendor-charts`); ничего нового не тащим.
- Обновление — React Query polling (15–30 с), без SSE. Фильтры в URL (shareable), time-range
  в шапке.
- Пустоты: `Empty` с подсказкой «события ещё не приходили / включите сбор», скелетоны при загрузке.
- Каталог событий и метрик — витрина того, что эмитят модули: имя, владелец, объём, last seen,
  пример атрибутов (сэмпл), «добавить в панель».

## 7. Алерты

- Оценка — задача `metrics.alerts.evaluate` раз в минуту: для каждого правила строит `MetricsQuery`,
  переводит инстанс `pending → firing` через `forMs`, пишет `alert_instances` (состояние переживает
  рестарт), эмитит `MetricAlertEvent` в `context.eventBus`.
- Дедуп: fingerprint = ruleId + стабильные labels; `resolved` при выходе из условия (есть
  `resolved_at`).
- Доставка: событие шины (её подхватит notification-модуль, когда появится) и/или webhook-sink.
  Silence/inhibition — в таблице/UI этапа 05 (по образцу Alertmanager:
  <https://prometheus.io/docs/alerting/latest/configuration/>).
- Полезные готовые пороги: доля 5xx (а не абсолют), p95 по роуту, отсутствие данных
  (`absence`, молчание пайплайна), SLO burn-rate (для 30-дневного окна 14.4×/6× —
  <https://sre.google/workbook/alerting-on-slos/>).
- 4xx не алертим (клиентские ошибки), health-check'и и ботов исключаем фильтром.

## 8. Выходы (sinks)

Диспетчер — задача `metrics.sinks.dispatch`: берёт `outbox` (`FOR UPDATE SKIP LOCKED`), режет по
capabilities, шлёт с backoff (максимум 6 попыток/4 часа, как у Segment), 4xx без 429 → DLQ, пишет
`sink_deliveries`. Ручной replay из DLQ — в UI «Доставка».

### 8.1 Яндекс.Метрика (единственный внешний сервис на старте)

Два независимых режима, оба выключены по умолчанию:

1. **Клиентский счётчик** (для облачного контура): сниппет с `defer: true` и ручной `ym(id,'hit')`
   на SPA-переходы; бизнес-цели через `ym(id,'reachGoal', goalId)`. Требует разрешения внешних
   скриптов у заказчика; блокируется блокировщиками.
2. **Серверная отправка**:
   - Measurement Protocol (`https://mc.yandex.ru/collect`, `t=pageview|event`) — окно 12 часов,
     нужен `ClientID` (получаем на клиенте и храним локально в маппинге);
   - Offline Conversions API — `POST /management/v1/counter/{counterId}/offline_conversions/upload`
     (CSV ≤ 1 ГБ, OAuth, `Target`=goal ID, `ClientId|UserId|Yclid|PurchaseId`), атрибуция 21 день,
     статусы `PREPARED→…→PROCESSED`, квоты 30 rps / 5000 запросов в сутки
     (<https://yandex.ru/dev/metrika/en/management/offline-conv.md>,
     <https://yandex.ru/dev/metrika/ru/intro/quotas>).
   Маппинг: внутреннее имя → goal ID; `actor_hash` → `UserId` через `setUserID`/CSV `UserId`.
   Секреты (OAuth) — через core `secrets` (§11), не в БД.

### 8.2 Прочие адаптеры

- **Webhook** — POST батча JSON на URL, HMAC-подпись, ретраи; для алертов и интеграций.
- **CSV/Parquet export** — по запросу из UI (выгрузка отфильтрованного набора), файл в S3
  (сервис `storage`) со сроком жизни.
- **Будущее за контрактом:** OTLP/HTTP (`POST /api/metrics/otlp/v1/metrics`), Prometheus remote-write
  (`POST /api/metrics/write`, snappy+protobuf), Prometheus-compatible query (`/api/v1/query_range`).
  Протоколы и форматы уже описаны в контракте sink/store (см. `01-contracts.md` §5, §7), чтобы
  Grafana/OTel-коллектор можно было подключить позже без ломки.

## 9. Приватность и 152-ФЗ

- **Псевдонимизация**: `actor_hash = HMAC-SHA256(соль назначения, identity_user.id)`; логины/id
  не хранятся. Разные назначения — разные псевдонимы (аналитика/ошибки/бизнес), сшить профиль
  между ними нельзя (принцип разделения псевдонимов, EDPB Guidelines 01/2025:
  <https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf>).
  Соль — в секретах (§11), **не в БД**; analytics-соль ротируется ежедневно (модель Plausible:
  <https://plausible.io/data-policy>), ошибки — стабильная версия `v1:` для affected users.
- **IP/UA**: сырые не хранятся; UA парсится на измерение (`device/browser/os`) и выбрасывается;
  IP используется только для гео/бота на входе и не сохраняется (усечение/хеш — как в приказе РКН
  № 140: введение идентификаторов, обобщение, раздельное хранение ключа).
- **Opt-out**: DNT/GPC, per-user переключатель, admin kill-switch (`settings.enabled`), отзыв
  согласия в облаке (для Метрики — `disableYaCounter…`).
- **k-anonymity**: срезы с < 5 уникальными акторами скрываются в UI (анти-реидентификация).
- **Согласие**: в закрытом контуре данные не покидают периметр, телеметрия — обезличенная;
  в облаке подключение Метрики требует согласия/баннера и раскрытия в политике (поручение
  обработки третьему лицу, ст. 6 152-ФЗ).
- **Retention**: сырьё 30 дней, роллапы 13 месяцев, `slow_queries` 7 дней; удаление — по расписанию
  (уничтожение по достижении цели, ст. 5 152-ФЗ).

## 10. Масштаб и путь на ClickHouse

Расчёты (целевой масштаб > 5000 пользователей):

| Профиль | Оценка |
|---|---|
| 5000 пользователей, 40 событий/день на человека | ~200K событий/день (~2.3/с среднее, ~20/с пик) |
| Месячная партиция | ~6M строк ≈ 1.5–2 ГБ (строка ~200–300 Б) |
| 100M событий (≈16 месяцев) с индексами | ~20–27 ГБ (нативные колонки + btree по времени + BRIN ~единицы МБ) |
| Точки измерений при пред-агрегации | десятки тысяч строк/сутки, а не миллионы |
| Роллапы | `buckets × дименшены` — при 5m/1h/1d это доли процента от сырья |

Порог перехода на отдельное аналитическое хранилище (ClickHouse/аналог) — не по ingest, а по
аналитике: > 100–500M сырых строк или > 50–100 ГБ горячего слоя; многонедельные `GROUP BY`;
p95 дашбордов > 1–2 с после роллапов; > 10–20 одновременных аналитических читателей; ломается
maintenance-бюджет (см. <https://clickhouse.com/resources/engineering/clickhouse-vs-postgresql-analytics>).
План перехода: реализация `ClickHouseMetricsStore` за `MetricsStore`, выгрузка сырья
(dual-write или CDC), PG остаётся system of record для настроек/алертов/реестров.

## 11. Изменения core (минимальные, обоснованные)

1. **`http:observer` (root-хук `onResponse`).** В `platform-core/src/backend/app.ts` в `createApp()`
   (до setup'ов) добавить хук, который на каждый завершённый запрос вызывает
   `context.extensions.getAll<HttpObserver>('http:observer')`. Почему в core: hook и порядок
   регистрации роутов в Fastify инкапсулированы, модульный `onRoute` покрывает не все роуты
   (зависит от порядка setup). Контракт `HttpObserver` — в `contracts/backend/`.
2. **`config`/`secrets`.** Сервис в core для чтения env с неймспейсом модуля
   (`context.services.resolve('secrets')` → `getSecret('metrics.pseudonym_salt')`): сейчас модули
   принципиально не читают env, а соль HMAC и OAuth-токены Метрики нуждаются в отдельном от БД
   хранении. Это первый шаг к полноценному конфиг-сервису; долгосрочно — секрет-стор.
3. **Хук ошибок фронтенда.** `createRoot` живёт в `apps/web/src/main.tsx`; чтобы поймать
   `onUncaughtError`/`onCaughtError` React 19, core экспортирует хелпер (или сервис `error-reporting`),
   который приложения передают в `createRoot`. Сам модуль метрик остаётся необязательным.

Все три — маленькие; альтернативы «не трогать core» проигрывают по качеству данных
(см. `01-contracts.md` §10). Если изменение core нежелательно совсем — модуль деградирует:
роуты собираются частично, React-ошибки через `window`-обработчики, соль — из env напрямую
(осознанное исключение, отметить в `ref/notes/module-metrics.md`).

## 12. План документации модуля (пишется на реализации)

Мощная потребительская дока — обязательная часть этапов, структура Diátaxis
(скилл `module-docs`), флоу подсмотрены у Umami/Plausible (быстрый старт), Grafana
(explore → panel → dashboard → alert), Sentry (issues → деталь → стек).

```
packages/module-metrics/docs/
├── index.md                                  обзор, границы, в какие контуры встаёт
├── tutorials/quick-start.md                  включить модуль → первые события → первый дашборд
├── how-to/add-business-metric.md             модулю: emit + definition + panel (с примером)
├── how-to/configure-retention-and-sampling.md
├── how-to/connect-yandex-metrica.md          цели, OAuth, ограничения, проверка доставки
├── how-to/define-alerts.md                   пороги, for, доставка, тишина
├── how-to/investigate-slow-route.md          от алерта до SQL-fingerprint
├── reference/events.md                       таксономия, атрибуты, запрещённые данные
├── reference/contracts.md                    MetricsService, extension points, sink API
├── reference/http-api.md
├── reference/settings.md
├── explanation/architecture.md               события vs измерения, стор и sinks
├── explanation/sampling-and-rollups.md       почему проценты приблизительные
├── explanation/pseudonymization.md           152-ФЗ, соли, opt-out
└── explanation/scaling.md                    оценки, лимиты, путь на ClickHouse
```

Плюс `ref/notes/module-metrics.md` (решения/отвергнутое/пробелы) — по скиллу `module-docs`
при появлении пакета.

## 13. Чек-лист живой проверки (после реализации)

1. `pnpm infra:up && pnpm dev`; миграции `metrics.*` применились, синглтон настроек создан.
2. Клиентский трекер: открыть SPA, походить по роутам → в `metrics.events` появились `page.view`
   с шаблонными `route`; перезагрузка вкладки не теряет батч (flush по hidden).
3. HTTP-коллектор: `GET /api/metrics/query` по `http.server.request.duration` даёт p95 по роутам;
   неизвестный роут (`/api/nope`) → `<unmatched>`, без сырого URL.
4. SQL-коллектор: сгенерировать медленный запрос → `slow_queries` содержит нормализованный SQL без
   литералов; измерения дают гистограмму по fingerprint; запросы метрик не рекурсируют.
5. `pg_stat_statements`: выключенное расширение — пометка в UI, без ошибок; включённое — дельты
   `calls/total_exec_time` в сериях.
6. Задачи: провалить тестовую задачу → `task.run.failed` counter и событие; поймать алертом.
7. Бизнес-события: эмит из support-chat (`support.thread.opened`) без включённого модуля метрик —
   приложение работает (guard `has('metrics')`); с включённым — событие в ленте.
8. Сэмплирование: клики при rate 0.1 дают ≈10% событий c `sampling.rate`, агрегат масштабируется.
9. Приватность: в событиях нет логинов/email/IP; псевдоним стабилен в пределах соли; opt-out
   останавливает трекер.
10. Sinks: при выключенных sink'ах исходящих запросов нет (проверка сети/логов); webhook — ретраи
    и DLQ на 4xx; Метрика (в облаке) — тест доставки, статусы и лимиты.
11. Retention: тестовое задание удаляет старую партицию `DETACH`+`DROP`, запись не блокируется.
12. Алерт: правило «доля 5xx > 1% за 5 минут» → pending → firing → resolved, событие в шине,
    инстанс в БД переживает рестарт.
