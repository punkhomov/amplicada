# How-to: интеграция с module-workflow

Практические рецепты для авторов других модулей (`module-hr`, `module-hr-request` и будущих
consumer-модулей) и для администраторов, работающих с уже запущенным движком. Примеры ниже —
реальный код из `module-hr`/`module-hr-request`, а не гипотетические. За объяснением "почему" —
в [explanation.md](./explanation.md), за полным списком полей — в [reference.md](./reference.md).

## Как зарегистрировать делегата исполнителя (assignee provider)

`module-hr` — единственный сегодня внешний потребитель registry — резолвит `WorkflowRegistry` в своём
`setup(context)` и регистрирует один делегат (`packages/module-hr/src/backend/setup.ts`):

```typescript
import { WORKFLOW_REGISTRY_TOKEN, type WorkflowRegistry } from '@amplicada/module-workflow/contracts';
import { fixedAssigneeProvider } from './workflow-delegates.js';

setup(context) {
  // Required-зависимость (см. ref/adr/02-dependency-injection.md): resolve() громко упадёт на
  // старте, если module-workflow не подключен в apps/api раньше module-hr.
  const workflowRegistry = context.services.resolve<WorkflowRegistry>(WORKFLOW_REGISTRY_TOKEN);
  workflowRegistry.registerAssigneeProvider('fixed-assignee', 'Фиксированный исполнитель', fixedAssigneeProvider);
}
```

Сам провайдер (`packages/module-hr/src/backend/workflow-delegates.ts`):

```typescript
import type { AssigneeProvider } from '@amplicada/module-workflow/contracts';

export const fixedAssigneeProvider: AssigneeProvider = {
  async resolve({ params }) {
    const userId = (params as { userId?: string } | undefined)?.userId;
    if (!userId) throw new Error('fixed-assignee: в параметрах ноды обязателен ключ "userId"');
    return userId;
  },
};
```

`params` здесь — это `assigneeProviderParams`, который администратор задаёт прямо в properties-panel
редактора при выборе этого делегата на `userTask`-ноде (JSON-поле, см. `JsonParamsField` в
[reference.md](./reference.md#registry-api-редактора-graph-mappingts)).

**Важно — порядок загрузки модулей.** DI не имеет декларативных зависимостей между модулями: `resolve()`
упадёт с ошибкой на старте, если `module-workflow` не зарегистрирован раньше вашего модуля. Порядок
задаётся вручную в массиве модулей у `bootstrap()`:

```typescript
// apps/api/src/index.ts
await bootstrap(app, [authPasswordModule, workflowModule, hrModule, hrRequestsModule, adminModule], context);
```

`workflowModule` должен стоять раньше любого модуля, который резолвит `WORKFLOW_REGISTRY_TOKEN` или
`WORKFLOW_ENGINE_TOKEN`. `peerDependencies`/`devDependencies` на `@amplicada/module-workflow` в
`package.json` вашего модуля гарантируют только типы/сборку — порядок рантайма они не проверяют.

Регистрация остальных четырёх видов делегатов (`registerValidatorProvider`,
`registerServiceTaskProvider`, `registerAsyncTaskProvider`, `registerHookProvider`) — тем же паттерном,
через тот же `workflowRegistry`. На момент написания ни один пакет в репозитории их не вызывает — если
вы первый, кому нужен `asyncTask`/`postEnterHooks`, ориентируйтесь на `registerAssigneeProvider` выше и
на интерфейсы в [reference.md](./reference.md#интерфейсы-делегатов).

## Как запустить процесс из своего модуля (в общей транзакции)

`module-hr-request` резолвит `WorkflowEngine` один раз в `setup()` и передаёт его в роуты как
зависимость (не резолвит заново на каждый запрос):

```typescript
// packages/module-hr-request/src/backend/setup.ts
import { WORKFLOW_ENGINE_TOKEN } from '@amplicada/module-workflow/contracts';

setup(context, app) {
  const engine = context.services.resolve<WorkflowEngine>(WORKFLOW_ENGINE_TOKEN);
  createHrRequestRoutes(fastify, context, { engine, configCache: new WorkflowConfigCache(engine) });
}
```

Старт процесса — внутри той же транзакции, что и запись своей сущности, через `opts.db`:

```typescript
// packages/module-hr-request/src/backend/routes.ts, POST /:id/submit
const { instance, updated } = await db.transaction(async tx => {
  // Поля заявки становятся payload процесса — источник истины для условий на gateway (напр. cost)
  const startedInstance = await engine.startProcess(row.type, row.fields, user.id, { db: tx });
  const [updatedRow] = await tx
    .update(hrRequests)
    .set({ status: 'submitted', processInstanceId: startedInstance.id, submittedAt: new Date() })
    .where(eq(hrRequests.id, id))
    .returning();
  return { instance: startedInstance, updated: updatedRow };
});
```

Почему одной транзакцией: если `startProcess` откатится (например делегат `serviceTask` бросит
ошибку внутри `advanceToken`), откатится и обновление вашей строки — не останется ни осиротевшего
`process_instances`, ни вашей записи, ссылающейся на несуществующий процесс. Движок savepoint'ов не
создаёт — `tx` обязан уже быть транзакцией Drizzle (`db.transaction(async tx => ...)`), не голым `db`.

## Как выполнить действие пользователя (executeAction) из своего модуля

Тот же принцип — своя денормализация (например копия `fields` у заявки) обновляется в той же
транзакции, что и переход графа:

```typescript
// packages/module-hr-request/src/backend/routes.ts, POST /:id/actions/:action
const pendingTasks = await engine.loadPendingTasks(row.processInstanceId);
const myTask = pendingTasks.find(t => t.assigneeId === user.id);
if (!myTask) return reply.code(403).send({ error: 'Действие доступно только назначенному исполнителю' });

const instance = await db.transaction(async tx => {
  const result = await engine.executeAction(myTask.id, action, user.id, {
    payloadPatch: body.fields,
    comment: body.comment,
    db: tx,
  });
  if (body.fields && Object.keys(body.fields).length) {
    await tx.update(hrRequests).set({ fields: { ...row.fields, ...body.fields } }).where(eq(hrRequests.id, id));
  }
  return result;
});
```

Обратите внимание: `executeAction` принимает **`taskId`**, не `processInstanceId` — с
parallel/inclusive-шлюзом на процесс может быть несколько одновременных pending-задач, поэтому нужно
явно найти задачу текущего пользователя через `loadPendingTasks()` перед вызовом (как в примере выше),
а не пытаться угадать единственную задачу процесса.

Читающие методы (`loadInstance`, `loadPendingTasks`, `loadFrozenConfig`) вызываются вне транзакции —
им не нужна атомарность с вашими записями, только консистентное на момент чтения состояние.
`loadFrozenConfig(versionId)` стоит кэшировать в процессе (как `WorkflowConfigCache` в
`module-hr-request/src/backend/status.ts`) — конфиг версии неизменяем после публикации, повторные
чтения по одному и тому же `versionId` всегда вернут один и тот же результат.

## Как отдать пользователю доступные действия и статус (без похода в module-workflow с фронтенда)

Портал `module-hr-request` **не** обращается к `/api/workflows/...` из браузера — вся интеграция
серверная, in-process. Фронтенд ходит на свои роуты (`/api/hr-requests/...`), а те роуты уже сами
вызывают `WorkflowEngine`:

```
браузер → fetch('/api/hr-requests/:id') → Fastify-роут module-hr-request
        → engine.loadInstance() / engine.loadPendingTasks() / engine.loadFrozenConfig() (in-process)
        → Postgres
```

Это рекомендуемый паттерн для нового consumer-модуля: не проксируйте вызовы на `/api/workflows/...`
с фронтенда, оборачивайте движок своими доменными роутами, которые говорят на языке вашей сущности
(`hr-requests`, а не `process-instances`) и решают, что можно показать конкретному пользователю
(`availableActions`, `isAssignee` и т.п. — см. пример вычисления в `routes/processes.ts`,
разобранный в [reference.md](./reference.md#процессы-routesprocessests)).

## Как спроектировать ветвление (exclusive gateway)

1. В визуальном редакторе (`/admin/workflows/:id/editor`) перетащите ноду "Шлюз (условие)" из
   палитры между двумя шагами.
2. Проведите от шлюза несколько исходящих рёбер к разным нодам.
3. На каждом ребре, кроме одного, задайте условие через `ConditionBuilder` (поле `payload.amount`,
   оператор, значение) — билдер собирает плоский AND-список, для сложных условий (OR, вложенные
   группы) редактируйте JSON конфига напрямую (билдер покажет его read-only, если не может разобрать).
4. Ровно одно ребро пометьте "Ветка по умолчанию (default)" — обязательно, иначе публикация отклонит
   граф с ошибкой "должно быть ровно одно default-ребро".
5. Опубликуйте версию — движок на рантайме идёт по первому совпавшему условию, иначе по default
   (`pickGatewayEdge` в `engine.ts`).

## Как добавить параллельное согласование (AND/OR-ветвление)

1. Поставьте gateway-ноду, в properties-panel выберите режим **Parallel (AND)** — все согласующие
   должны одобрить, или **Inclusive (OR)** — активируются ветки, чьё условие совпало.
2. Проведите >1 исходящих рёбер к отдельным `userTask`-нодам (каждая — свой согласующий/делегат).
3. **Обязательно** сведите все ветки обратно к одной gateway-ноде того же режима с >1 входящих рёбер
   (join) — без неё публикация отклонит граф ("не найден парный join"). Ветки не могут расходиться в
   разные join-узлы и не могут заканчиваться на `end` до синхронизации.
4. Для `parallel` — не ставьте условия на исходящих рёбрах (запрещено валидацией, все ветки активны
   всегда). Для `inclusive` — как у exclusive-шлюза, condition + одно default-ребро на случай, когда
   ничего не совпало.
5. После join — процесс продолжается один раз, когда **все** активированные ветки дошли до join
   (`expectedCount` — число исходящих у parallel, число реально совпавших у inclusive).

Прежде чем полагаться на это в реальном процессе — см. предупреждение в
[explanation.md](./explanation.md#известные-ограничения-v1-сознательные-не-забытые): parallel/inclusive
не прогонялся вживую на реальной БД на момент реализации, только рассуждением и typecheck/build.

## Как добавить side-effect после входа в статус (postEnterHooks)

На `userTask`/`end`-ноде в properties-panel — секция "Хуки после входа": выберите зарегистрированный
`HookProvider`, задайте `maxAttempts`/`retryDelayMs` и JSON-параметры. Хуки исполняются асинхронно,
вне транзакции движка, при **каждом** входе в ноду (включая повторные — циклы в графе), и не влияют на
маршрутизацию: успех/неудача меняют только статус самой джобы (`done`/`failed`), `advance()` не
вызывается. Годится для уведомлений, но не для side-эффектов, от которых зависит дальнейший путь
процесса — для тех нужна `asyncTask`-нода.

**Не забудьте активировать воркер** (см. следующий пункт) — иначе неудачные попытки хука не
подхватятся ретраем автоматически.

## Как включить обработку зависших/повторных попыток асинхронной автоматики

`WorkflowAutomationWorker` зарегистрирован в task-scheduler под именем
`workflow-automation-worker`, но **по умолчанию неактивен** (`active: false` — дефолт таблицы
`scheduled_tasks` в `platform-core`). Без него работает только eager-путь (диспатч сразу после
коммита) — ретраи после ошибки и восстановление джоб, зависших в `running` дольше 5 минут (крах
процесса между claim'ом и завершением), не происходят.

Включите задачу в админке task-scheduler'а (`module-admin`) вручную, если ваш процесс использует
`asyncTask`-ноды или `postEnterHooks` и вам важна автоматическая доставка после сбоя — не полагайтесь
только на eager-диспатч в проде.

## Как вручную разрулить зависшую джобу автоматики (административный override)

`POST /api/workflows/admin/workflow-jobs/:id/override` с телом `{ payloadPatch }` продвигает граф
так, как будто провайдер вернул этот результат сам — на случай, когда внешняя система недоступна
долго и ждать очередной ретрай нет смысла. Работает и на `pending`, и на `running` джобе — не требует
предварительного `retry`.

**Осторожность**: если джоба в статусе `running` (воркер прямо сейчас выполняет `provider.execute()`),
и вы делаете override раньше, чем воркер успеет завершиться — результат настоящего вызова провайдера
будет тихо отброшен движком (защита от повторного продвижения графа не даёт двойного перехода, но и
не восстанавливает "потерянный" результат). Override — сознательная замена результата провайдера
админом, используйте, когда уверены, что ждать реальный результат больше не нужно. Подробности
гонки — в [explanation.md](./explanation.md#конкурентность-и-блокировки).

## Как посмотреть, что не так с зависшим процессом

- `GET /api/workflows/admin/workflow-jobs?status=failed` — список зафейленных джоб автоматики со
  `lastError`.
- Страница таймлайна процесса (`/admin/workflows/processes/:id`) показывает баннер "Автоматика не
  выполнилась" с последней ошибкой, если текущая нода — `asyncTask` и есть `failed`-джоба на ней.
- `WorkflowEngine.loadActiveTokens(instanceId)` — полная картина активных токенов при
  parallel/inclusive-ветвлении (какие ветки уже пришли, какие ещё нет) — авторитетнее, чем
  `process_instances.currentState`, если активных токенов больше одного.
