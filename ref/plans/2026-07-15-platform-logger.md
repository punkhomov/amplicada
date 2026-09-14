---
title: Единая система логирования платформы
type: plan
tier: 2
status: implemented
date: 2026-07-15
---

# Единая система логирования платформы

## Статус реализации

Фаза 1 реализована кодом (не прогонялась вживую — не проверено, что дублирование в лог run'а реально доходит до карточки "Логи" в `admin-task-detail`). Фаза 2 (донастройка со стороны `apps/api`) не начата — не требуется, дефолтная конфигурация рабочая.

## Текущая проблема

1. Нет единого логгера уровня платформы. Есть только встроенный pino Fastify (`Fastify({ logger: true })`, `packages/platform-core/src/backend/app.ts:52`) — используется исключительно для инфраструктурных сообщений bootstrap/shutdown (`app.log.info/error(...)` только в `app.ts`) и для автоматического access-лога HTTP-запросов. Больше нигде в проекте `app.log`/`request.log` не используется.
2. У модулей нет общего способа логировать — нет `logger.ts`, нет `services.resolve('logger')`, `BackendSetupContext` не содержит поля `log`.
3. Единственная существующая абстракция логирования — task-scoped `TaskHandlerLogger` (`packages/platform-core/src/contracts/backend/tasks.ts`), который создаётся в `TaskRunner.createLogger()` (`task-runner.ts`) и передаётся хендлеру задачи **явным аргументом** (`ctx.log`). Если хендлер вызывает какую-то core/module-функцию, которая логирует сама по себе (не через переданный `ctx.log`), эта запись никогда не попадёт в лог конкретного run'а — только то, что явно вызвано через `ctx.log.info/error(...)`.

## Решение

Единый платформенный логгер в `platform-core`, поверх pino:

1. **Ambient-перехват для фоновых задач через `AsyncLocalStorage`** — пока выполняется хендлер задачи, любой вызов платформенного логгера из любого места кода автоматически **дублируется** в лог конкретного run'а (та же таблица `scheduled_task_run_logs` + тот же SSE-канал, что уже есть сегодня), одновременно продолжая писать в свой обычный pino-таргет. Не редирект, а тег — обычная работа подсистемы не меняется, просто дополнительно прилипает к конкретному запуску для отладки.
2. **Логгер — модульный singleton, экспортируемый из core**, без DI и без прокидывания через контекст/аргументы:
   ```ts
   import { logger } from '@amplicada/platform-core/backend';
   logger.info('...');
   ```
   Никакого сервис-локатора (`services.resolve('logger')`) не нужен — везде используется один и тот же импортируемый объект, включая `AuthLogServiceImpl` и любой другой код в core.
3. **Создание инстанса — ленивое, через `configureLogger()`**, а не `export const logger = pino()` при импорте модуля. Причина: у pino `destination`/`transport` задаются только аргументом конструктора (подтверждено в доках — `pino([options], [destination])`) и не могут быть подменены у уже созданного инстанса; мутировать после создания можно только `logger.level`. Если создавать pino eagerly прямо в core-модуле, `apps/api` физически не сможет позже добавить свой transport (например, для Kibana) — момент создания уже упущен. Поэтому:
   - `apps/api/src/index.ts` может (не обязан) вызвать `configureLogger(opts, destination?)` самой первой строкой в `main()`, до `createApp()` — тогда синглтон создаётся с этой конфигурацией.
   - Если никто не вызвал `configureLogger()`, при первом обращении к `logger.*` синглтон **лениво создаётся с дефолтной конфигурацией** (`pino()`, вывод в stdout) — сам факт использования логгера до конфигурации не приводит к падению приложения, просто не будет кастомного transport.
   - `configureLogger()`, вызванный после того как синглтон уже был лениво создан (кто-то успел залогировать раньше), бросает ошибку — это ловится сразу в дев-окружении и чинится перестановкой вызова в начало `main()`, а не тихо игнорируется.
4. **Явного `ctx.log` в `TaskHandlerContext` не будет.** Хендлер задачи логирует так же, как любой другой код — через `import { logger }`; ambient-перехват (п. 1) сам подхватывает эти вызовы, пока выполняется `registration.handler(...)`, никакого специального аргумента для этого протаскивать не нужно.
5. **Фасад — настоящий `Proxy`, типизированный как `pino.Logger`, а не собственный урезанный интерфейс.** Перехватываются только `info`/`error` (дублирование в ALS) и `child` (чтобы обёртка не терялась на дочерних логгерах); всё остальное (`level`, `flush`, `bindings`, `isLevelEnabled`, символьные свойства вроде `serializersSym`) уходит напрямую в реальный pino через `Reflect.get(target, prop, target)`. Это принципиально: `Fastify({ loggerInstance })` сам создаёт дочерний логгер через `prevLogger.child({}, opts)`, где `opts` содержит дефолтные req/res/err сериализаторы (`fastify/lib/logger-pino.js`) — если бы `child()` не форвардил второй аргумент дальше в реальный pino, request-логи Fastify теряли бы компактную сериализацию и печатали сырые объекты.

## Архитектура

```
  apps/api/src/index.ts, main():
    configureLogger(opts, dest?)   ◄── опционально, первая строка, до createApp()
    createApp()
                                        │
  import { logger } from platform-core │  ◄── тот же объект везде: core, модули,
        │                              │       app.ts, хендлеры задач
        ▼                              │
  ┌─────────────────────────────┐     │
  │   packages/platform-core     │◄────┘
  │   backend/logger.ts (new)    │
  │                               │
  │  ensureInstance() — лениво     │
  │    создаёт pino() при первом    │
  │    обращении, если configureLogger()
  │    не вызывали                  │
  │                               │
  │  ALS.getStore()?              │
  │    ├─ нет  → пишем в pino     │
  │    └─ есть → пишем в pino     │
  │              + дублируем      │
  │                в taskLogger    │
  │                (из store)      │
  └───────────┬───────────────────┘
              │ singleton pino instance
              ▼
   app.ts: Fastify({ loggerInstance: logger })  ── HTTP access-лог и
                                                     платформенный логгер
                                                     — один и тот же поток

  TaskRunner.execute():
    als.run({ taskLogger, taskId, runId }, () => registration.handler({ signal }))
```

- `.child(bindings, options)` фасада возвращает **новый Proxy-фасад** (не голый `pino.child()`), чтобы ALS-перехват сохранялся на любой глубине вложенных child-логгеров, и форвардит `options` вторым аргументом в реальный `target.child(bindings, options)` — иначе Fastify теряет свои дефолтные сериализаторы (см. п. 5 в «Решении»).
- ALS-контекст живёт только на время `registration.handler(...)` внутри `TaskRunner.execute()` — вне контекста задачи (HTTP-запрос, bootstrap) `als.getStore()` пуст, фасад работает как обычный pino-логгер без побочных эффектов.
- `apps/api` создаётся не раньше `platform-core`, циклической зависимости нет — `apps/api` просто импортирует `logger`/`configureLogger` из `platform-core`.
- `app.ts` передаёт `loggerInstance: logger as FastifyBaseLogger` — без явного каста TS специализирует generic `FastifyInstance<..., Logger, ...>` под полный `pino.Logger` вместо дефолтного `FastifyBaseLogger`, из-за чего `App.app: FastifyInstance` (с дефолтным генериком) в `app.ts` перестаёт быть совместимым. Каст безопасен: `logger` реально реализует весь `pino.Logger` (честный Proxy), просто сужаем видимый тип до того, что использует Fastify.

## Зависимости

| Пакет | Зачем | Новый? |
|-------|-------|--------|
| `node:async_hooks` (`AsyncLocalStorage`) | Ambient-контекст текущего run'а задачи | Нет, встроенный |
| `pino` | Был только транзитивной зависимостью через `fastify`; теперь `platform-core` импортирует его напрямую (`import pino from 'pino'`), поэтому объявлен явно в `package.json` (иначе строгая изоляция `node_modules` у pnpm его не даст резолвить) | Формально да в `package.json`, по факту уже был в lockfile |

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `packages/platform-core/src/backend/logger.ts` | Новый. `AsyncLocalStorage`, ленивый `ensureInstance()`, `configureLogger(opts, dest?)`, `createFacade()` — настоящий `Proxy` (типизирован как `pino.Logger`, не собственный контракт), экспорт синглтона `logger`, `runWithTaskLogger(ctx, fn)` хелпер |
| `packages/platform-core/src/backend/app.ts` | `Fastify({ loggerInstance: logger as FastifyBaseLogger })` вместо `Fastify({ logger: true })`; `app.log.*` в bootstrap/shutdown → `logger.*` |
| `packages/platform-core/src/contracts/backend/tasks.ts` | `TaskHandlerContext` — убрать поле `log`, оставить только `signal`; `TaskHandlerLogger` больше не нужен как публичный контракт |
| `packages/platform-core/src/backend/task-runner.ts` | `TaskRunner.execute()` — обернуть вызов `registration.handler({ signal })` в `runWithTaskLogger({ taskId, runId, taskLogger }, ...)`; `createLogger()` → `createTaskLogger()`, строит sink для ALS-стора (пишет в `scheduled_task_run_logs` + SSE), но больше не отдаётся хендлеру напрямую |
| `packages/module-auth-password/src/backend/setup.ts` | Демо-задача — убрать деструктуризацию `{ log }` из хендлера, использовать `import { logger }` напрямую |
| `apps/api/src/index.ts` | Опционально — вызов `configureLogger(...)` первой строкой в `main()`, до `createApp()`, если понадобится кастомный transport |

## Порядок реализации

### Фаза 1 — синглтон, ленивая инициализация, фасад и ALS

- [x] `logger.ts`: `AsyncLocalStorage`, ленивый `ensureInstance()`, `configureLogger(opts, dest?)` (бросает, если инстанс уже создан), `createFacade()` — `Proxy`, перехватывающий только `info`/`error`/`child`, остальное форвардит в реальный pino через `Reflect`; типизирован как `pino.Logger`, отдельный контракт не заводили (не нужен — Proxy честно реализует полный интерфейс)
- [x] `runWithTaskLogger()` — хелпер, оборачивающий вызов в `taskContext.run(...)`
- [x] `app.ts` — `Fastify({ loggerInstance: logger as FastifyBaseLogger })`, замена `app.log.*` на `logger.*` в bootstrap/shutdown
- [x] `TaskHandlerContext` — убрать `log`; `TaskHandler` теперь получает только `{ signal }`
- [x] `TaskRunner.execute()` — обернуть `registration.handler({ signal })` в `runWithTaskLogger({ taskId, runId, taskLogger }, ...)`; `createTaskLogger()` (был `createLogger()`) строит sink для стора, а не аргумент хендлера
- [x] Демо-задача в `module-auth-password` — обновлена сигнатура хендлера, логирует через `import { logger }`

### Фаза 2 — донастройка со стороны приложения (по мере необходимости)

- [ ] `configureLogger(...)` в `apps/api/src/index.ts`, если понадобится кастомный transport (например Kibana) — не блокирует фазу 1, дефолтная конфигурация (`pino()`, stdout) рабочая без какой-либо настройки снаружи

## Проверка

- Вызвать демо-задачу (`auth-password-demo`), внутри хендлера дёрнуть функцию, которая логирует через `import { logger }` напрямую — убедиться, что сообщение появилось и в обычном pino-выводе, и в логе конкретного run'а (карточка "Логи" на странице `admin-task-detail`, SSE + `scheduled_task_run_logs`).
- Тот же вызов логгера вне контекста задачи (обычный HTTP-хендлер) — должен писать только в обычный лог, без исключений (ALS store пуст → fallback).
- Вызов `logger.info(...)` до любого `configureLogger()` — не должен падать, синглтон лениво создаётся с дефолтной конфигурацией.
- `configureLogger(...)`, вызванный после того как синглтон уже лениво создан — должен бросить ошибку (проверить, что это ловится сразу, а не тихо игнорируется).
- HTTP-запрос к любому роуту — access-лог должен остаться компактным (req/res сериализуются в несколько полей, а не печатается сырой объект целиком) — регрессия сюда уже была поймана и исправлена форвардингом `options` в `child()`.
