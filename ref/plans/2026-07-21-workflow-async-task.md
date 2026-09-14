---
title: workflow — асинхронные автодействия (asyncTask)
type: plan
tier: 2
status: implemented
date: 2026-07-21
---

# workflow — асинхронные автодействия (asyncTask)

Реализация фазы C из
[2026-07-19-workflow-fields-actor-automation.md](2026-07-19-workflow-fields-actor-automation.md)
(там зафиксирована как направление без кода) — асинхронная автоматика для внешних вызовов
(ИИ-проверка, интеграции), не блокирующая транзакцию движка. Дизайн уточнён в серии обсуждений и
опирается на два соседних плана: [2026-07-20-workflow-node-code-delegate-tx.md](2026-07-20-workflow-node-code-delegate-tx.md)
(`DelegateContext.db` для синхронных делегатов) и
[2026-07-20-workflow-node-hooks.md](2026-07-20-workflow-node-hooks.md) (хуки переиспользуют ту же
джоб-инфраструктуру, что описана здесь).

## Текущая проблема

1. Единственный сегодняшний способ выполнить side-эффект в процессе — `serviceTask`, исполняется
   синхронно внутри транзакции движка под `FOR UPDATE` (`WorkflowEngine.advance()`). Для быстрой
   локальной логики это нормально, но для внешнего вызова (ИИ, HTTP-интеграция) — нет: лок держится
   на время вызова, ретраев нет, ошибка/таймаут прилетает произвольному пользователю, чьё действие
   случайно вызвало каскад транзитных нод, как ошибка его собственного действия.
2. Тот же дефект в принципе есть и у резолва исполнителя userTask (`AssigneeProvider.resolve()` в
   `settle()`), если понадобится определять его через внешнюю систему — но это решается композицией
   существующих узлов (см. «Архитектура»), отдельного механизма не требует.
3. Повторяющиеся side-effect действия (уведомления) не должны становиться отдельной transit-нодой
   (искажает видимый статус процесса) — это отдельный, уже спланированный механизм
   ([node-hooks](2026-07-20-workflow-node-hooks.md)), не asyncTask сам по себе; здесь только
   джоб-инфраструктура, которую hooks впоследствии тоже используют.
4. `task-scheduler` ядра (`packages/platform-core`) — cron-планировщик именованных повторяющихся
   задач без payload/attempts/ретраев на уровне схемы (`scheduled_tasks` не содержит этих колонок).
   Он не подходит как очередь одноразовых джоб для конкретного `process_instance` — нужна своя
   таблица в module-workflow; `task-scheduler` используется только как периодический триггер сверху.

## Решение

Третий wait-state узел `asyncTask` (наряду с `userTask`/`end`) — структурно как `serviceTask` (одно
исходящее ребро, без action/condition), но не исполняется inline в `advance()`: движок паркует на
нём `current_state` и создаёт джобу в новой таблице `workflow_automation_jobs`. Джоба стартует
немедленно (eager — в том же процессе, сразу после коммита транзакции, не блокируя HTTP-ответ) и
параллельно подбирается периодическим воркером (через `task-scheduler`, `SELECT...FOR UPDATE SKIP
LOCKED`) — воркер закрывает ретраи после сбоя и восстановление после краша процесса (единственный
рабочий путь для второго: pull, не push — нечему опубликовать событие, если процесс, который должен
был его опубликовать, сам упал). Завершение — `engine.completeAutomationJob(jobId, {
payloadPatch })`: отдельная транзакция, `FOR UPDATE`, аудит с `actorType: 'system'`, дифф payload
(переиспользует механизм фазы A), `advance()`/`settle()` продолжаются.

`serviceTask` и `asyncTask` остаются раздельными типами нод и раздельными реестрами провайдеров —
решение объединить их в один тип или сделать таски асинхронными по умолчанию отклонено (см. раздел
ниже): это сломало бы статическую детекцию wait-state в `advance()`, обнулило бы `ctx.db` для
синхронного случая и добавило бы лишний хоп для тривиальных быстрых вычислений.

## Архитектура

### Контракты

```typescript
// contracts/graph.ts
export interface AsyncTaskNode extends WorkflowNodeBase {
  type: 'asyncTask';
  providerId: string;
  params?: Record<string, unknown>;
  maxAttempts: number;   // >= 1
  retryDelayMs: number;  // фиксированная задержка, не экспонента — сознательный минимализм
}

export type WorkflowNode = StartNode | UserTaskNode | GatewayNode | ServiceTaskNode | AsyncTaskNode | EndNode;
```

```typescript
// contracts/registry.ts
export interface AsyncTaskProvider {
  /**
   * В отличие от ServiceTaskProvider — не мутация ctx.payload по ссылке (транзакции уже нет к
   * моменту завершения), а явный возврат результата. ctx.db не передаётся — исполняется вне
   * транзакции движка.
   */
  execute(ctx: Omit<DelegateContext, 'db'>): Promise<{ payloadPatch?: Record<string, unknown> }>;
}

export interface WorkflowRegistry {
  // ...существующее...
  registerAsyncTaskProvider(id: string, label: string, provider: AsyncTaskProvider): void;
  getAsyncTaskProvider(id: string): AsyncTaskProvider | undefined;
}

export interface WorkflowDelegatesMeta {
  // ...существующее...
  asyncTask: DelegateMeta[];
}
```

### Таблица джоб

```sql
CREATE TABLE workflow_automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_instance_id uuid NOT NULL REFERENCES process_instances(id),
  node_id varchar(100) NOT NULL,
  provider_id varchar(200) NOT NULL,
  params jsonb,
  status varchar(20) NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_automation_jobs_claim ON workflow_automation_jobs (status, next_attempt_at);
```

`params`/`max_attempts` — снапшот из конфига ноды на момент создания джобы (не читаются из JSONB
конфига повторно при каждой попытке — конфиг версии immutable, но так дешевле и явнее при отладке).

### Жизненный цикл джобы

1. `settle()` (внутри транзакции движка, новая ветка `asyncTask`): `currentState = node.id` (+
   `currentStateCode`, если задан — см. [node-code-delegate-tx](2026-07-20-workflow-node-code-delegate-tx.md)),
   вставка строки в `workflow_automation_jobs` (`status: 'pending'`, `attempts: 0`).
2. Сразу после коммита внешней транзакции (`executeAction`/`startProcess`, уже вне
   `inTransaction`) — eager-триггер: `void this.runAutomationJob(jobId)`, не блокирует ответ
   вызывающему коду (HTTP-роуту).
3. `runAutomationJob(jobId)`: claim одной строки — `UPDATE workflow_automation_jobs SET
   status='running', attempts=attempts+1 WHERE id=$1 AND status='pending' RETURNING *` (0 строк —
   уже забрана кем-то другим, выходим без ошибки). Резолвит `AsyncTaskProvider` из реестра, вызывает
   `execute()` **вне транзакции**.
   - Успех → `engine.completeAutomationJob(jobId, result)`.
   - Ошибка → `attempts < maxAttempts` ? `status='pending', nextAttemptAt=now()+retryDelayMs,
     lastError` : `status='failed', lastError`.
4. Периодический воркер (`task-scheduler`-задача `workflow-automation-worker`, интервал
   конфигурируемый, не захардкоженный): двумя запросами —
   - забирает батч `pending` джоб с `nextAttemptAt <= now()` (`SELECT...FOR UPDATE SKIP LOCKED
     LIMIT N`) → `runAutomationJob` для каждой (закрывает ретраи после сбоя);
   - «зависшие» `running` дольше разумного порога (краш процесса между claim и завершением) →
     назад в `pending` с инкрементом `attempts` (poison-pill защита — если джоба сама роняет
     воркер, она не крутится вечно, в итоге уйдёт в `failed`).
5. `completeAutomationJob(jobId, { payloadPatch })`: своя транзакция, `FOR UPDATE` на
   `process_instances`, проверка что инстанс всё ещё стоит на ожидаемой asyncTask-ноде (защита от
   гонок), апдейт `payload`, shallow-дифф → `workflow_audit_log.payloadDiff` (переиспользует
   механизм фазы A — здесь `editableKeys`-whitelist не нужен: провайдер — доверенный код,
   настроенный админом, не пользовательский ввод), аудит-запись `actorType: 'system'`, `actorId:
   null`, `advance()`/`settle()` продолжаются дальше по графу, джоба → `status='done'`.

### Почему eager + poll вместе, а не что-то одно

- Только eager — если процесс упадёт между claim и завершением, джоба зависает в `running`
  навсегда: нечему её подхватить, событие некому опубликовать (сам публикатор умер).
- Только poll — каждая, даже мгновенная джоба ждёт до следующего тика прежде чем начать.
- Отдельная брокер-очередь (BullMQ и т.п.) рассмотрена и отклонена: нагрузка (разовые внешние
  вызовы, не поток событий) не оправдывает новую инфраструктуру и библиотеку с неиспользуемой
  поверхностью. Изоляция исполнения от веб-процесса (если/когда понадобится — например провайдер
  начнёт делать что-то CPU-bound, а не просто ждать сеть) достигается переносом poll-луп'а в
  отдельный процесс той же кодовой базы (тот же образ, роль `worker` — как уже устроено для
  task-scheduler'а), без новых зависимостей — сознательно отложено до реальной необходимости.

### Асинхронный резолв исполнителя userTask (гипотетический кейс — композиция, не новый механизм)

Если понадобится определять исполнителя userTask через внешнюю систему — отдельного «асинхронного
userTask» делать не нужно: `asyncTask` (пишет, например, `payload.managerId`) → единственное ребро
→ `userTask` с синхронным `AssigneeProvider`, который читает уже готовое значение из payload.
`settle()`/`AssigneeProvider` не меняются вообще — asyncTask и так пишет в payload, а не жёстко
привязан к маршрутизации через Gateway.

### Отказ от объединения serviceTask/asyncTask

Рассмотрены и отклонены:

- **Таски асинхронны по умолчанию** — теряем `ctx.db` (транзакционную запись) для быстрого
  синхронного случая; лишний хоп и аудит-запись для тривиальных вычислений, которые раньше были
  невидимы внутри `advance()`.
- **Один тип ноды, синхронность определяется тем, какой провайдер подключён** — ломает
  статическую (по `node.type`) детекцию wait-state в `advance()`: пришлось бы резолвить провайдер
  из реестра посреди цикла, чтобы понять, останавливаться ли на ноде. Одна и та же нода могла бы
  тихо менять роль (транзит ↔ wait-state) между версиями графа при смене `providerId`; контракт
  делегата (`ctx.db` есть/нет) переставал бы быть гарантией типа, а становился бы runtime-проверкой.

## Видимость сбоя (терминальное состояние `failed`)

Процесс, зависший на asyncTask с исчерпанными ретраями, не должен быть тихим:

- Таймлайн (`process-timeline-page.tsx`, `request-card-page.tsx`) — при наличии `failed`-джобы на
  текущей ноде показывать заметную пометку («автоматика не выполнилась»), а не только в админке.
- Админка — список джоб (минимум фильтр по `status='failed'`), ручной retry (сброс в `pending`,
  `attempts=0`), ручной override (`completeAutomationJob` с payload'ом, который вводит админ вручную
  — escape hatch на случай, когда внешняя система недоступна долго).

## Зависимости

Новых npm-пакетов нет (без BullMQ/новых брокеров — см. «Почему eager + poll вместе»). Новая таблица
в module-workflow. Использует существующий `task-scheduler` ядра только как периодический триггер
(регистрация одной cron-задачи), не как хранилище джоб.

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `module-workflow/src/contracts/graph.ts` | `AsyncTaskNode`, добавление в `WorkflowNode` union |
| `module-workflow/src/contracts/registry.ts` | `AsyncTaskProvider`, `registerAsyncTaskProvider`/`getAsyncTaskProvider`, `WorkflowDelegatesMeta.asyncTask` |
| `module-workflow/migrations/000N_create_workflow_automation_jobs.sql` | Таблица `workflow_automation_jobs` + индекс (номер — по факту очерёдности с соседними планами) |
| `module-workflow/src/backend/schema.ts` | Таблица + типы |
| `module-workflow/src/backend/engine.ts` | `advance()`: третье стоп-условие (`asyncTask`); `AdvanceResult.finalNode` расширяется; `settle()`: ветка создания джобы; новые методы `runAutomationJob`/`completeAutomationJob`; eager-триггер после коммита в `executeAction`/`startProcess` |
| `module-workflow/src/backend/registry.ts` | Реализация реестра `asyncTask`-провайдеров |
| `module-workflow/src/backend/validation.ts` | Правила для `asyncTask`: ровно одно исходящее ребро без action/condition (как у `serviceTask`), обязателен зарегистрированный `providerId`, `maxAttempts >= 1` |
| `module-workflow/src/backend/services/workflow-automation-worker.ts` (новый) | Claim-батч (`SKIP LOCKED`), сентинел зависших `running`, регистрация в `task-registry` |
| `module-workflow/src/backend/setup.ts` | Регистрация `workflow-automation-worker` в task-scheduler при бутстрапе модуля |
| `module-workflow/src/backend/routes/admin.ts` | Список джоб, ручной retry, ручной override (эндпоинты) |
| `module-workflow/src/frontend/lib/graph-mapping.ts` | `EditorNodeData` — поля `asyncTask`; `configToFlow`/`flowToConfig` |
| `module-workflow/src/frontend/components/properties-panel.tsx` | Форма `asyncTask`: провайдер (из `meta.asyncTask`), JSON-параметры, `maxAttempts`/`retryDelayMs` |
| `module-workflow/src/frontend/components/workflow-node-types.tsx` | Визуал ноды `asyncTask` на канвасе |
| `module-workflow/src/frontend/components/node-palette.tsx` | Добавить `asyncTask` в палитру |
| `module-workflow/src/frontend/pages/process-timeline-page.tsx` | Пометка зафейленной автоматики на текущей ноде |
| `module-hr-request/src/frontend/pages/request-card-page.tsx` | То же для портала заявок |

## Порядок реализации

- [ ] Контракты: `AsyncTaskNode`, `AsyncTaskProvider`, реестр, `WorkflowDelegatesMeta.asyncTask`
- [ ] Миграция `workflow_automation_jobs` + `schema.ts`
- [ ] `engine.ts`: `advance()` стоп-условие, `settle()` ветка джобы, `runAutomationJob`,
      `completeAutomationJob`, eager-триггер
- [ ] `validation.ts`: структурные правила `asyncTask`
- [ ] Воркер (`workflow-automation-worker.ts`) — claim-батч + сентинел зависших джоб, регистрация
      в task-scheduler
- [ ] Редактор: палитра, `workflow-node-types.tsx`, `properties-panel.tsx`, `graph-mapping.ts`
- [ ] Админка: список джоб, ручной retry/override
- [ ] Видимость сбоя на таймлайнах (`process-timeline-page.tsx`, `request-card-page.tsx`)
- [ ] `turbo build typecheck` + biome

## Проверка

1. Граф с `asyncTask` (тестовый провайдер, искусственная задержка 2-3 сек, без ошибок) между двумя
   userTask → после действия процесс на мгновение виден на asyncTask-ноде (`current_state`), затем
   сам переходит дальше без дополнительных действий пользователя; в аудите — запись перехода с
   `actorType='system'`.
2. Тестовый провайдер, который падает N раз подряд, затем успешно отрабатывает (N < maxAttempts) —
   джоба проходит `pending → running → pending (retry) → running → done`, финальный `payloadPatch`
   применён, аудит содержит корректный дифф.
3. Провайдер, который падает всегда — после исчерпания `maxAttempts` джоба `failed`, процесс
   остаётся на asyncTask-ноде, таймлайн показывает пометку о сбое.
4. Искусственный краш между claim и завершением (откатить строку в `running` вручную) — воркер на
   следующем тике переводит джобу назад в `pending`, ретрай происходит.
5. Ручной retry/override из админки выводит зависший процесс из `failed`-состояния.
6. Композиция «asyncTask → userTask с чтением payload в assigneeProvider» — резолв исполнителя
   работает без изменений в `settle()`.
