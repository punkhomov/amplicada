---
title: "05. Real-time события и логи (SSE)"
type: plan
tier: 2
status: implemented
date: 2026-07-14
---

# 05. Real-time события и логи (SSE)

Родительский план: [2026-07-14-task-scheduler.md](2026-07-14-task-scheduler.md)

**Блокируется:** [02](02-lock-and-execution.md), [03](03-admin-basic-management.md)
**Блокирует:** ничего — последняя функциональная фаза перед [06](06-testing-and-validation.md)
**Пакет:** `platform-core` (события, мост, scoped logger) + `module-admin` (SSE-роут, реактивный UI). Самая тяжёлая и наиболее кросс-компонентная фаза.

## Что делаем

Изначально фаза задумывалась только под стрим логов конкретного run'а. По ходу обсуждения расширили: **вся админка должна быть реактивной** — список задач сам обновляет статус и меняет кнопку «Запустить»↔«Отменить», когда где-то на `worker` стартует/завершается run, без перезагрузки и без polling. Логи — часть того же механизма, не отдельная подсистема.

Решение: **один SSE-стрим на открытую страницу** (`GET /admin/tasks/events`), в который льются все события жизненного цикла задач — не по одному каналу/подключению на каждый `runId`. REST остаётся ровно там же, где был в [03](03-admin-basic-management.md) — для всех мутаций (run/cancel/pause/patch) и первичной загрузки данных.

Почему не WebSocket — обсуждали отдельно: направление всегда одно (сервер → браузер), мутации и так REST, `@fastify/websocket` в проекте нет и не нужен. `EventSource` даёт нужное бесплатно (автопереподключение), без протокола поверх сокета.

## Механизм

**Кросс-процессная доставка** (worker эмитит → web раздаёт браузерам):

1. `TaskRunner` (и scoped logger внутри него) вместо голого `eventBus.emit(...)` использует новый `emitTaskEvent(eventBus, redis, type, payload)` — эмитит **локально** (на месте) и **публикует в Redis-канал `task:events`** (JSON `{ type, payload }`) одновременно
2. `TaskEventBridge` — новый компонент, живёт только на **чистой** `web`-роли (`getRole() === 'web'`, не `all`!). Держит отдельное Redis-подключение (`duplicate()`), подписывается на `task:events`, и всё, что приходит, реэмитит на свой локальный `eventBus`
3. На `ROLE=all` мост **не запускается** — TaskRunner и так пишет в тот же локальный `eventBus`, который слушает SSE-роут; лишний проход через Redis дал бы дублирующее событие. Это не было очевидно из исходного текста плана — вскрылось только при проектировании моста
4. SSE-роут `GET /admin/tasks/events` подписывается на `context.eventBus` (4 типа: `started`/`succeeded`/`failed`/`log`) и форвардит каждое как `event: <type>\ndata: <json>\n\n` в открытое соединение браузера. Отписка — на `request.raw.on('close', ...)`

**Логи конкретно:**

5. Scoped logger (`log.info`/`log.error`, был в контексте handler'а с [01](01-contracts-and-roles.md), раньше писал только в stdout) теперь **дополнительно**: пишет строку в `scheduled_task_run_logs` (fire-and-forget, не блокирует — `TaskHandlerLogger` не async по контракту) и публикует `task.run.log` через `emitTaskEvent`
6. История логов завершённых run'ов — `GET /tasks/:id/runs/:runId/logs`, читает из БД

**Фронтенд — реактивность:**

7. `GET /tasks` расширен: `activeRunId` — id текущего running-run'а для задачи, если есть (left join на `scheduled_task_runs` с `status='running'`, дедуп на случай гонки на уровне роута). Это даёт корректное начальное состояние кнопки при **холодной загрузке** страницы (если задача уже выполняется, когда открыли вкладку)
8. Один `useTaskEventStream()` хук на страницу (не на компонент/строку) — свой `EventSource` у каждой открытой страницы (список и деталка независимы, без глобального синглтона/контекста — осознанно не усложняли)
9. Список задач: `onStarted` → `activeRunId = runId` в кэше react-query, `onSucceeded`/`onFailed` → `activeRunId = null`. Кнопка «Запустить сейчас» ⇄ «Отменить» переключается сама
10. Детали задачи: то же самое плюс `onLog` — копится в локальном `state` по `runId`; при разворачивании строки run'а показываются live-логи, а если их ещё нет (run случился до открытия страницы) — подтягиваются через REST `.../logs`. Дедуп не нужен: REST дёргается только если live-буфер для этого run'а пуст

## Событие

| Событие | Payload | Куда |
|---|---|---|
| `task.run.log` | `{ runId, taskId, timestamp, level, message }` | БД (`scheduled_task_run_logs`) + `task:events` (Redis) → SSE |

(`started`/`succeeded`/`failed` уже существовали с [02](02-lock-and-execution.md)/[04](04-reliability.md) — здесь они просто дополнительно поехали через `emitTaskEvent` в Redis, без изменения формы payload.)

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/platform-core/src/backend/task-events.ts` | Создать | `TASK_EVENTS_CHANNEL`, `emitTaskEvent(eventBus, redis, type, payload)` |
| `packages/platform-core/src/backend/task-event-bridge.ts` | Создать | `TaskEventBridge`: Redis-подписчик → реэмит в локальный `eventBus`, только для чистой `web`-роли |
| `packages/platform-core/src/backend/task-runner.ts` | Изменить | `eventBus.emit` → `emitTaskEvent`; реальный scoped logger (БД + событие) вместо stdout-заглушки |
| `packages/platform-core/src/backend/schema.ts` | Изменить | Таблица `scheduled_task_run_logs` (`run_id`, `timestamp`, `level`, `message`) |
| `packages/platform-core/src/contracts/backend/tasks.ts` | Изменить | `TASK_EVENTS.log`, `TaskRunLogEvent` |
| `packages/platform-core/src/backend/app.ts` | Изменить | Инстанс `TaskEventBridge`, старт только при `getRole() === 'web'`, `redis` добавлен в `TaskRunnerDeps` |
| `packages/platform-core/migrations/` | Изменить | Миграция для новой таблицы |
| `packages/module-admin/src/backend/routes/tasks.ts` | Изменить | `GET /tasks` — добавлен `activeRunId` (left join); `GET /tasks/events` (SSE); `GET /tasks/:id/runs/:runId/logs` |
| `packages/module-admin/src/frontend/lib/use-task-event-stream.ts` | Создать | Хук: один `EventSource` на компонент, типизированные `onStarted`/`onSucceeded`/`onFailed`/`onLog` |
| `packages/module-admin/src/frontend/pages/admin-tasks.tsx` | Изменить | Кнопка «Запустить»⇄«Отменить» по `activeRunId`, live-обновление статуса вместо статики |
| `packages/module-admin/src/frontend/pages/admin-task-detail.tsx` | Изменить | Live-история run'ов вместо polling, разворачиваемые строки с live/historical логами |

## Шаги

- [x] Drizzle schema + миграция для `scheduled_task_run_logs`
- [x] `backend/task-events.ts` — канал + `emitTaskEvent`
- [x] `backend/task-event-bridge.ts` — мост Redis → локальный eventBus для web-роли
- [x] Подключить реальный logger в `task-runner.ts`, заменить `eventBus.emit` на `emitTaskEvent` везде
- [x] Wiring в `app.ts`: мост стартует только при `getRole() === 'web'` (не `all`)
- [x] `GET /tasks` — добавлен `activeRunId`; `GET /tasks/events` (SSE); `GET /tasks/:id/runs/:runId/logs`
- [x] Frontend: `useTaskEventStream` хук
- [x] Frontend: список задач — реактивная кнопка и статус
- [x] Frontend: детали задачи — live-история run'ов + разворачиваемые live/historical логи

Статус: код написан, `pnpm -w typecheck` и `pnpm exec biome check` проходят чисто по всем новым/изменённым файлам. Раздел «Проверка» не прогонялся вживую (по решению пользователя, тестирование в рантайме пока отложено).

## Проверка

1. Открыть `/admin/tasks`, включить задачу с `* * * * *`, дождаться срабатывания — статус и кнопка «Запустить»→«Отменить» переключаются без перезагрузки страницы
2. Открыть страницу деталей выполняющейся задачи → live-строка run'а появляется в истории без polling
3. Развернуть running-строку → логи приходят по мере вызовов `log.info(...)` в handler'е
4. Закрыть вкладку, дождаться завершения run'а, открыть заново → та же история и логи видны из БД (REST fallback)
5. Открыть `/admin/tasks` с двух вкладок одновременно, запустить задачу из одной → обе получают обновление статуса
6. Запустить в режиме `ROLE=all` (одна машина) → убедиться, что события в SSE приходят **не задвоенные** (мост не запускается, но обновления всё равно приходят напрямую из локального eventBus)
7. Запустить в раздельных `ROLE=web` + `ROLE=worker` → убедиться, что события всё равно доходят до браузера (через Redis-мост)
8. Проверить, что SSE-соединение корректно закрывается при уходе со страницы (отписка от eventBus, не растут висящие listeners)
