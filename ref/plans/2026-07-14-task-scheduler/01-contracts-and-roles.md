---
title: "01. Контракты, роли, реестр задач"
type: plan
tier: 2
status: implemented
date: 2026-07-14
---

# 01. Контракты, роли, реестр задач

Родительский план: [2026-07-14-task-scheduler.md](2026-07-14-task-scheduler.md)

**Блокируется:** ничем — самая нижняя, ни от чего не зависящая фаза, можно начинать сразу.
**Блокирует:** все остальные подпланы.
**Пакет:** только `platform-core`. Ничего из `module-admin` здесь не появляется и не должно.

## Что делаем

Закладываем фундамент, от которого зависит всё остальное: типы контракта, разделение роли процесса (`ROLE`), таблицы БД и реестр задач с upsert/stale-логикой. Никакого выполнения, локов, HTTP-роутов — это чистое описание "что за задачи существуют", без побочных эффектов запуска.

## Контракт

```typescript
// contracts/backend/tasks.ts

type TaskRunStatus = 'running' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'orphaned';

interface ScheduledTaskOptions {
  timeout: number;
  description: string;
  alertOnFailure?: boolean; // default false
}

interface TaskHandlerContext {
  signal: AbortSignal;
  log: { info: (msg: string) => void; error: (msg: string) => void };
}

interface TaskScheduler {
  register(
    id: string,
    options: ScheduledTaskOptions,
    handler: (ctx: TaskHandlerContext) => Promise<void>,
  ): void;
}
```

Расписание (`schedule`) и пауза (`paused`) сознательно **не входят** в `ScheduledTaskOptions` — это runtime-состояние, которым владеет админка через БД, а не код (см. принцип направления зависимости в родительском плане).

### API для модулей (как это выглядит для потребителя)

```typescript
context.tasks.register('sync-integrations', {
  timeout: 5 * 60 * 1000,
  description: 'Синхронизация данных с внешним API',
  alertOnFailure: true,
}, async ({ signal, log }) => {
  log.info('fetching...');
  const res = await fetch('https://external-api.com/data', { signal });
  const data = await res.json();
  await saveToDb(context.db, data);
  log.info(`saved ${data.length} records`);
});
```

## Реестр задач (upsert/stale)

`register()` — **синхронный**, только кладёт `{ id, options, handler }` в `Map` в памяти. Это принципиально: `scheduled_tasks` физически не существует в момент вызова `register()`, потому что модульный `setup()` в `bootstrap()` выполняется **до** прогона core-миграций (см. `app.ts`) — упереться в это можно было только прочитав реальный порядок бутстрапа, поэтому и отклонились от изначальной формулировки плана ("upsert при каждом register()").

Реальная запись в БД происходит один раз, централизованно — методом `reconcile(db)`, который `bootstrap()` вызывает сразу после core-миграций (тот же паттерн, что уже применяется к `context.migrations`: регистрация — синхронная и просто копит список, применение — пакетное, потом). `reconcile()`:
1. Делает **upsert** по каждой зарегистрированной задаче в `scheduled_tasks`, затрагивая только `description`, `timeout`, `alertOnFailure`, снимает `stale`
2. Поля `schedule` и `paused` при апдейте существующей строки **не трогаются** — они принадлежат админке
3. При первой вставке новой задачи (INSERT-ветка `onConflictDoUpdate`): `schedule = null`, `paused = true` (защита от случайного запуска — задача неактивна, пока её не включат явно)
4. Задачи, не пришедшие в текущем проходе (убраны из кода), помечаются `stale = true` через `notInArray`, но не удаляются — история должна остаться

`TaskRegistryImpl` регистрируется и в `context.tasks` (публичный контракт для модулей), и в `context.services` под токеном `'task-registry'` (для внутреннего вызова `reconcile()` из `bootstrap()`) — по аналогии с тем, как `db`/`pg-pool`/`redis` резолвятся в `bootstrap()` через `services`, а не заводятся отдельными полями контракта.

## Роли процесса

`ROLE=web|worker|all` (env var, default `all`). Один и тот же монолитный кодбейз:
- `web` — обслуживает HTTP, не тикает планировщиком
- `worker` — не слушает HTTP (кроме health-check), только выполняет задачи
- `all` — оба сразу (локалка/маленькие деплои)

`register()` вызывается на любой роли одинаково (это просто описание). Реальные таймеры и выполнение — предмет [02-lock-and-execution.md](02-lock-and-execution.md), активны только на `worker`/`all`.

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/platform-core/package.json` | Изменить | Добавить `croner` в dependencies |
| `packages/platform-core/src/contracts/backend/tasks.ts` | Создать | `TaskScheduler`, `ScheduledTaskOptions`, `ScheduledTask`, `TaskRunStatus`, `TaskHandlerContext` |
| `packages/platform-core/src/backend/role.ts` | Создать | Чтение `ROLE` env var, хелперы `isWebRole()` / `isWorkerRole()` |
| `packages/platform-core/src/backend/task-registry.ts` | Создать | `TaskRegistryImpl`: синхронный `register()` в Map + асинхронный `reconcile(db)` (upsert/stale-реестр в БД) |
| `packages/platform-core/src/contracts/backend/setup.ts` | Изменить | Добавить `tasks: TaskScheduler` в `BackendSetupContext` |
| `packages/platform-core/src/backend/schema.ts` | Изменить | Таблицы `scheduled_tasks` (`schedule: varchar \| null`, `paused: boolean default true`, `stale`, `description`, `timeout`, `alertOnFailure`, `updated_at`), `scheduled_task_runs` (`status`, `trigger`, `started_at`, `finished_at`, `duration_ms`, `reason`, `error`, `instance_id`) |
| `packages/platform-core/migrations/` | Изменить | `0005_create_task_scheduler.sql` + запись в `meta/_journal.json` |
| `packages/platform-core/src/backend/app.ts` | Изменить | Инстанцирование `TaskRegistryImpl`, регистрация в `context.tasks` и `services('task-registry')`, вызов `reconcile(db)` в `bootstrap()` сразу после core-миграций |

## Шаги

- [x] Добавить `croner` в `package.json`, запустить `pnpm install`
- [x] Создать контракт `contracts/backend/tasks.ts`
- [x] Создать `backend/role.ts`
- [x] Создать `backend/task-registry.ts` (`register()` синхронный в Map, `reconcile(db)` — upsert/stale, дефолт новой задачи — `paused: true, schedule: null`)
- [x] Добавить `tasks` в `BackendSetupContext`
- [x] Добавить Drizzle schema для `scheduled_tasks`, `scheduled_task_runs`
- [x] Создать миграцию (`0005_create_task_scheduler.sql` + `_journal.json`)
- [x] Wiring в `app.ts`: инстанс `TaskRegistryImpl`, `context.tasks`, `services('task-registry')`, вызов `reconcile(db)` после core-миграций

Статус: код написан, `pnpm -w typecheck` и `pnpm exec biome check` по всем новым/изменённым файлам проходят чисто. Раздел «Проверка» ниже **не прогнан вживую** — нужен поднятый Postgres/Redis (Docker Desktop не был запущен в момент реализации).

## Проверка

1. Зарегистрировать тестовую задачу → убедиться, что в БД появилась запись с `paused: true, schedule: null`
2. Перезапустить процесс с изменённым `description` в коде → убедиться, что `schedule`/`paused` (если их вручную поменять в БД) не откатываются апдейтом
3. Убрать задачу из кода, перезапустить → убедиться, что она помечена `stale = true`, а не удалена
4. Запустить с `ROLE=web` и `ROLE=worker` — оба должны одинаково успешно выполнить `register()`, без ошибок, независимо от роли
