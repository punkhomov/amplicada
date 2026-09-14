---
title: "02. Lease-лок, выполнение, croner-таймеры"
type: plan
tier: 2
status: implemented
date: 2026-07-14
---

# 02. Lease-лок, выполнение, croner-таймеры

Родительский план: [2026-07-14-task-scheduler.md](2026-07-14-task-scheduler.md)

**Блокируется:** [01-contracts-and-roles.md](01-contracts-and-roles.md)
**Блокирует:** [03](03-admin-basic-management.md), [04](04-reliability.md), [05](05-realtime-logs.md)
**Пакет:** только `platform-core`. Это ядро исполнения — оно эмитит события, но ничего не знает про `module-admin` и никогда не должно на него ссылаться.

## Что делаем

Реальное выполнение задач на `worker`-роли: croner-таймеры, распределённый лок с продлением (lease), запуск handler'а с `signal`/`log`, запись состояний run'ов.

## Состояния run'а (`scheduled_task_runs.status`)

```
running → success
        → failed      (исключение в handler)
        → timeout     (превышен options.timeout, перестали ждать)
        → cancelled   (см. 03 — команда извне через Pub/Sub)
        → orphaned     (см. 04 — сверка обнаружила пропавший воркер)
```

Здесь реализуются переходы в `success`/`failed`/`timeout`. `cancelled` приходит по команде извне (03), `orphaned` выставляется отдельным процессом (04) — этот подплан только создаёт для них место в схеме состояний.

## События

| Событие | Payload |
|---|---|
| `task.run.started` | `{ runId, taskId, workerId, startedAt, trigger: 'schedule' \| 'manual' }` |
| `task.run.succeeded` | `{ runId, finishedAt, durationMs }` |
| `task.run.failed` | `{ runId, finishedAt, durationMs, reason: 'error' \| 'timeout' \| 'cancelled', error: { message, stack } }` |

(`task.run.log` — отдельно в [05-realtime-logs.md](05-realtime-logs.md), логика логирования не блокирует этот подплан, `log` в контексте handler'а на этом этапе можно временно писать только в `console`/stdout.)

## Lease-лок

Проблема статичного TTL: если handler выполняется дольше TTL, лок протухнет раньше, чем задача завершится, и другой инстанс сможет её перехватить — дублирование, ради предотвращения которого лок и заводился.

Решение — lease с продлением:

1. `SET task-lock:{taskId} {workerId}:{runId} NX PX {timeout + grace}` — уникальный токен на попытку, TTL привязан к заявленному `timeout` задачи (не константа)
2. Пока handler выполняется — каждые `TTL/3` продлеваем атомарным Lua-скриптом: `if GET(key) == myToken then PEXPIRE(key, ttl)` (атомарность обязательна — без неё можно продлить чужой лок)
3. По завершении — атомарное освобождение по токену: `if GET(key) == myToken then DEL(key)`, в `finally`
4. Если процесс с локом просто упал (не успел ни продлить, ни отпустить) — heartbeat продления прекращается, TTL истекает сам, лок освобождается естественным путём без ручного вмешательства

## Flow выполнения

1. `croner`-таймер срабатывает → scheduler проверяет `paused` — если пауза, пропускает
2. Пробует взять лок (см. выше)
3. Если взят — создаёт `scheduled_task_runs` со статусом `running`, эмитит `task.run.started`, выполняет handler с `{ signal, log }`, параллельно продлевая лок
4. По завершении — освобождает лок, пишет терминальный статус, `finishedAt`/`durationMs`, эмитит `task.run.succeeded`/`task.run.failed`
5. Если лок не взят — пропускает (другой инстанс уже выполняет)

### Реконсиляция расписания

Если админ (03) меняет `schedule`/`paused` в БД, `worker`-роль должна это подхватить без рестарта: polling БД раз в N секунд достаточно для v1 (простой и предсказуемый механизм); ускорение через Pub/Sub — опционально, можно добавить позже без изменения контракта.

## Handler context

- **`signal: AbortSignal`** — прокидывается в handler. На этом этапе абортится только по внутреннему timeout (`options.timeout`); внешняя отмена по команде из UI — предмет [03](03-admin-basic-management.md), но сигнатура закладывается сразу, чтобы не делать breaking change контракта позже
- **`log`** — на этом этапе достаточно, чтобы просто писал в stdout/`console`; полноценный scoped logger с БД+Pub/Sub — [05](05-realtime-logs.md)

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/platform-core/src/backend/task-lock.ts` | Создать | Lease-лок: acquire/extend/release через Lua-скрипты по токену |
| `packages/platform-core/src/backend/task-runner.ts` | Создать | Запуск handler'а с `signal`/`log`, timeout race, запись run'ов и событий |
| `packages/platform-core/src/backend/task-scheduler.ts` | Создать | croner-таймеры, реконсиляция расписания (polling), проверка `paused`, только для `worker`/`all` |
| `packages/platform-core/src/backend/app.ts` | Изменить | Ветвление по `ROLE`: scheduler lifecycle (start/stop) только на `worker`/`all` |

## Шаги

- [x] Создать `backend/task-lock.ts` (acquire/extend/release через Lua-скрипты по токену, TTL = timeout + grace)
- [x] Создать `backend/task-runner.ts` (выполнение с `signal`, timeout race, запись `running`→терминальный статус, события через `context.eventBus`)
- [x] Создать `backend/task-scheduler.ts` (croner-таймеры, polling-реконсиляция расписания каждые 5s, проверка `paused`/`stale`)
- [x] Интегрировать lifecycle в `app.ts` (старт только при `isWorkerRole()`, стоп — в существующем shutdown-хуке)

Статус: код написан, `pnpm -w typecheck` и `pnpm exec biome check` проходят чисто по всем новым/изменённым файлам. Раздел «Проверка» ниже не прогонялся вживую (нужен поднятый Postgres/Redis) — по решению пользователя, тестирование в рантайме отложено на потом.

Уточнения, не описанные исходным текстом плана:
- События (`task.run.started/succeeded/failed`) эмитятся через уже существующий `context.eventBus` (in-process), а не через отдельный самодельный механизм — он для этого и предназначен, отдельной шины заводить не пришлось
- `TaskScheduler` (класс из этого подплана, не путать с контрактом `TaskScheduler` из [01](01-contracts-and-roles.md) — тёзки, в реализации не конфликтуют, т.к. контракт живёт в `contracts/backend/tasks.ts`, а класс — в `backend/task-scheduler.ts`) зарегистрирован в `services('task-scheduler')`, по аналогии с `task-registry` — на будущее для [03](03-admin-basic-management.md) (доработка подписки на Pub/Sub) и [04](04-reliability.md)
- `error` в `scheduled_task_runs` хранится как `JSON.stringify({ message, stack })` в одной `text`-колонке — отдельных колонок под message/stack заводить не стали, схема уже это предусматривала

## Проверка

1. Вручную поставить в БД `schedule: '* * * * *', paused: false` для тестовой задачи → убедиться, что она выполняется на `worker`-роли раз в минуту
2. Запустить `web`-роль отдельно → убедиться, что задача НЕ выполняется, даже если handler зарегистрирован в памяти этого процесса
3. Искусственно замедлить handler дольше исходного TTL → убедиться, что продление лока не даёт второму инстансу перехватить выполнение
4. Запустить 2 инстанса `worker`-роли одновременно → убедиться, что выполняется только один
5. Поставить `paused: true` вручную в БД → убедиться, что `worker` подхватывает изменение без рестарта и пропускает следующий тик
