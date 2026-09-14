# Справочник: API, контракты, схема

Факты для поиска по конкретному вопросу. За рациональным устройством — в [explanation.md](./explanation.md),
за пошаговыми рецептами — в [how-to.md](./how-to.md). Все сведения сверены с исходным кодом пакета
(`packages/module-workflow/src`), не с планами в `ref/`.

## Service tokens

| Токен | Значение | Резолвится как |
|---|---|---|
| `WORKFLOW_REGISTRY_TOKEN` | `'workflow-registry'` | `WorkflowRegistry` — регистрация делегатов |
| `WORKFLOW_ENGINE_TOKEN` | `'workflow-engine'` | `WorkflowEngine` — программный запуск/продвижение процессов |

Оба экспортируются из `@amplicada/module-workflow/contracts` (`contracts/registry.ts`).

## HTTP API (`/api/workflows`, требует аутентифицированного пользователя)

Каждый роут обёрнут `preHandler`, возвращающим 401 без пользователя. Ошибки движка мапятся
`setErrorHandler` в `setup.ts` (см. таблицу «Ошибки» ниже).

### Процессы (`routes/processes.ts`)

| Метод | Путь | Что делает |
|---|---|---|
| `POST` | `/:code/start` | `engine.startProcess(code, body.payload, user.id)`. `201` + `ProcessInstanceRow`. |
| `GET` | `/processes/:id` | Детали процесса + `taskId`/`availableActions`/`isAssignee` для **текущего пользователя** (не общий список действий) + `nodeLabels` + `failedAutomation` (последняя `failed`-джоба на текущей ноде, если нода — `asyncTask`). |
| `POST` | `/processes/:id/actions/:action` | Резолвит pending-задачу текущего пользователя по `processInstanceId`, иначе `403 ForbiddenActionError`; вызывает `engine.executeAction(myTask.id, action, user.id, { payloadPatch: body.payload, comment })`. |
| `GET` | `/processes/:id/timeline` | `workflow_audit_log` по экземпляру, join на `identityUser` за `actorLogin`, по возрастанию `createdAt`. |

### Задачи (`routes/tasks.ts`)

| Метод | Путь | Что делает |
|---|---|---|
| `GET` | `/tasks/my` | Pending-задачи текущего пользователя (`assigneeId = user.id AND status = 'pending'`), с `workflowCode` из join на `process_instances`. Устойчиво к parallel/inclusive — не полагается на "одна задача на процесс". |

### Админка (`routes/admin.ts`)

| Метод | Путь | Что делает |
|---|---|---|
| `GET` | `/admin/workflows/:id/versions` | Все версии шаблона, по возрастанию `versionNumber`. |
| `POST` | `/admin/workflows/:id/publish` | `engine.publishVersion(id, body.config, user.id)`. `201` + новая версия либо `400` со списком ошибок валидации. |
| `GET` | `/admin/builder/meta` | `registry.listMeta()` — списки зарегистрированных делегатов для пикеров редактора. |
| `GET` | `/admin/workflow-jobs?status=` | Список джоб автоматики, опционально по статусу. |
| `POST` | `/admin/workflow-jobs/:id/retry` | Сбрасывает джобу в `pending`, `attempts = 0`, `nextAttemptAt = now()`. Административное действие — не проверяет, что джоба действительно `failed`. |
| `POST` | `/admin/workflow-jobs/:id/override` | `engine.completeAutomationJob(id, { payloadPatch: body.payloadPatch })` напрямую — escape hatch на случай, когда внешняя система недоступна и ждать ретрай не имеет смысла. См. предостережение в [explanation.md](./explanation.md#конкурентность-и-блокировки). |

### Ошибки → HTTP статусы

| Класс (`errors.ts`) | Статус |
|---|---|
| `WorkflowValidationError` | 400, тело `{ error, errors: string[] }` |
| `InvalidActionError`, `ValidatorFailedError` | 400, тело `{ error }` |
| `ForbiddenActionError` | 403 |
| `WorkflowNotFoundError` | 404 |
| прочее | `error.statusCode ?? 500` |

## Registry

`WorkflowRegistry` (`contracts/registry.ts`) — единственная точка расширения движка доменными
модулями. Сам `module-workflow` регистрирует только один встроенный делегат — `process-initiator`
(assignee-провайдер, возвращающий `context.startedBy`, см. `backend/delegates.ts`).

```typescript
interface WorkflowRegistry {
  registerAssigneeProvider(id: string, label: string, provider: AssigneeProvider): void;
  registerValidatorProvider(id: string, label: string, provider: ValidatorProvider): void;
  registerServiceTaskProvider(id: string, label: string, provider: ServiceTaskProvider): void;
  registerAsyncTaskProvider(id: string, label: string, provider: AsyncTaskProvider): void;
  registerHookProvider(id: string, label: string, provider: HookProvider): void;

  getAssigneeProvider(id): AssigneeProvider | undefined;
  // ...аналогично get* для остальных четырёх видов

  listMeta(): WorkflowDelegatesMeta; // { assignee, validator, serviceTask, asyncTask, hook: DelegateMeta[] }
}
```

### Интерфейсы делегатов

| Интерфейс | Метод | Возврат | Когда вызывается | `ctx.db` доступен? |
|---|---|---|---|---|
| `AssigneeProvider` | `resolve(ctx)` | `Promise<string>` (id пользователя) | Токен дошёл до `userTask` | Да (внутри транзакции) |
| `ValidatorProvider` | `validate(ctx)` | `Promise<{ valid, message? }>` | Перед **любым** action на `userTask` | Да |
| `ServiceTaskProvider` | `execute(ctx)` | `Promise<void>`, мутирует `ctx.payload` по ссылке | Транзитная нода `serviceTask` | Да |
| `AsyncTaskProvider` | `execute(ctx)` | `Promise<{ payloadPatch? }>` | Джоба `kind='route'`, вне транзакции | **Нет** |
| `HookProvider` | `execute(ctx)` | `Promise<void>`, ничего не маршрутизирует | Джоба `kind='hook'` (`postEnterHooks`), вне транзакции | **Нет** |

`DelegateContext`: `{ payload, context, params?, db? }`. `params` — снапшот `*ProviderParams`/`params`
конкретной ноды из конфига версии (не читается заново из JSONB на каждой попытке).

## Контракты графа (`contracts/graph.ts`)

### Типы нод

| `type` | Обязательные поля | Опциональные поля |
|---|---|---|
| `start` | — | `code`, `postEnterHooks` не поддерживаются (только userTask/end в редакторе) |
| `userTask` | `assigneeProviderId` | `assigneeProviderParams`, `validatorIds[]`, `editableKeys[]` (без них `payloadPatch` в `executeAction` целиком запрещён), `code`, `postEnterHooks[]` |
| `gateway` | — | `mode?: 'exclusive' \| 'parallel' \| 'inclusive'` (роль split/join выводится структурой графа, не полем) |
| `serviceTask` | `serviceTaskProviderId` | `serviceTaskProviderParams` |
| `asyncTask` | `providerId`, `maxAttempts` (int ≥1), `retryDelayMs` (int ≥0, фиксированный, не экспонента) | `params` |
| `end` | — | `outcome?: 'success' \| 'failure'` (только для UI-бейджа, движок не интерпретирует), `code`, `postEnterHooks[]` |

Общие для всех: `id`, `label`, `position: { x, y }`, `code?` (стабильный домен-код для внешних
потребителей — в отличие от `id`, который может пересоздаваться при редактировании).

### Рёбра (`WorkflowEdge`)

`{ id, source, target, label?, action?, condition?, isDefault? }`. `action` обязателен на рёбрах из
`userTask` (имя действия — `approve`/`reject`/...). `condition` (JsonLogic) обязателен на рёбрах из
`gateway`, кроме `isDefault`-ребра (ровно одно на узел, кроме `parallel`-режима, где condition/isDefault
запрещены вовсе — активируются все ветки).

### Условия — поддерживаемые JSONLogic-операторы (`backend/conditions.ts`)

`var`, `==`, `!=`, `===`, `!==`, `>`, `>=`, `<`, `<=`, `in`, `and`, `or`, `!`, `!!`. Самописный
эвалуатор (~114 строк), не библиотека `json-logic-js` — формат хранения совместим с JSONLogic. `var`
резолвится по точечному пути от `{ payload, context }` (напр. `payload.amount`, `context.startedBy`).
`==`/`!=` — нестрогое сравнение (`==` в JS, объекты сравниваются по ссылке). Числовые операторы
кастуют аргументы `as number` без runtime-проверки — `NaN` сравнения молча дают `false` (стандартное
поведение JSONLogic, не баг).

## Registry API редактора: `graph-mapping.ts`

`configToFlow(config)` / `flowToConfig(nodes, edges)` — двунаправленный маппинг между
`WorkflowVersionConfig` (формат хранения) и React Flow `Node`/`Edge` (формат канваса). Константы по
умолчанию для новых нод: `DEFAULT_ASYNC_TASK_MAX_ATTEMPTS = 3`, `DEFAULT_ASYNC_TASK_RETRY_DELAY_MS =
30_000`, `DEFAULT_HOOK_MAX_ATTEMPTS = 3`, `DEFAULT_HOOK_RETRY_DELAY_MS = 30_000`.

## Схема БД (`backend/schemas/`)

| Таблица | Ключевые колонки | FK / примечания |
|---|---|---|
| `workflows` | `code` (unique), `currentVersionId`, `isActive` | `currentVersionId` без FK (циклическая ссылка на `workflow_versions`, консистентность держит `publishVersion()`) |
| `workflow_versions` | `workflowId`, `versionNumber`, `config` (jsonb) | unique(`workflowId`, `versionNumber`) |
| `process_instances` | `workflowVersionId`, `currentState`, `currentStateCode`, `payload`, `context`, `completedAt` | `currentState`/`currentStateCode` — денормализация, не авторитетны при >1 активном токене |
| `process_instance_tokens` | `nodeId`, `branchGroupId`, `status` (`active`\|`consumed`) | `processInstanceId` → cascade; `branchGroupId` → `process_instance_forks` без `onDelete` (блокирует удаление форка, пока есть токены) |
| `process_instance_forks` | `splitNodeId`, `joinNodeId`, `expectedCount`, `parentBranchGroupId` | `parentBranchGroupId` без FK на себя же (инвариант держит только код) |
| `workflow_tasks` | `tokenId`, `assigneeId`, `state`, `status` | `processInstanceId`/`tokenId` → cascade; `tokenId` nullable (исторические строки до модели токенов) |
| `workflow_automation_jobs` | `tokenId`, `kind` (`route`\|`hook`), `providerId`, `status`, `attempts`, `maxAttempts`, `nextAttemptAt` | `tokenId` → cascade |
| `workflow_audit_log` | `actorId`, `actorType` (`user`\|`system`), `action`, `fromState`, `toState`, `payloadDiff` | `actorId` nullable (system-действия пишут `null`) |

Нет композитных индексов `(process_instance_id, status)` на `process_instance_tokens` и
`(status, next_attempt_at)` на `workflow_automation_jobs` — оба запроса (`loadActiveTokens`,
`dispatchDueJobs`) сегодня идут по ним без явного composite-индекса.

## Document System интеграция (`contracts/documents.ts`, `backend/documents/`)

| Токен | Документ/страница |
|---|---|
| `WorkflowDocuments.WORKFLOW` (`'workflow'`) | Шаблоны процессов — `creatable: true`, `deletable: false` |
| `WorkflowDocuments.WORKFLOW_PROCESS` (`'workflow-process'`) | Запущенные экземпляры — `creatable: false`, кастомный `load()` (нет GET-by-id роута, документ подтягивает строку напрямую) |
| `WorkflowPages.WORKFLOW_EDITOR` | `/admin/workflows/{id}/editor` — визуальный редактор графа |
| `WorkflowPages.PROCESS_TIMELINE` | `/admin/workflows/processes/{id}` — таймлайн + доступные действия |

## Миграции (`migrations/`)

`0000` (базовые таблицы) → `0001` (audit payload diff + actorType) → `0002` (automation jobs) →
`0003` (currentStateCode) → `0004` (job kind) → `0005` (токены/форки + бэкфилл незавершённых
экземпляров под старый `currentState`). Каждая — per-package, свой journal, применяется через
Drizzle kit.
