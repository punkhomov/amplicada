---
title: "02. Интерпретатор графа, JSONLogic, версионирование"
type: plan
tier: 2
status: implemented
date: 2026-07-16
---

# 02. Интерпретатор графа, JSONLogic, версионирование

Родительский план: [2026-07-16-workflow.md](2026-07-16-workflow.md)

**Блокируется:** [01](01-contracts-and-schema.md)
**Блокирует:** [03](03-runtime-api.md), [04](04-admin-api-and-documents.md)
**Пакет:** `module-workflow`

## Что делаем

Сердце модуля: валидация графа перед публикацией, эвалуатор условий Gateway, интерпретатор
(`start`/`executeAction`), версионирование. Ещё без HTTP — чистые сервисы, которые фазы 03/04
обернут в роуты.

## Валидация графа (перед публикацией)

Структурные проверки — `zod` для формы + ручные семантические проверки поверх:

1. Ровно один `start`-узел, хотя бы один `end`-узел
2. Каждое ребро (`source`/`target`) ссылается на существующий id ноды
3. Каждый узел (кроме `end`) достижим из `start` и имеет хотя бы одно исходящее ребро
4. `userTask`: все исходящие рёбра имеют `action`, имена `action` среди исходящих рёбер одной ноды
   уникальны
5. `gateway`: все исходящие рёбра, кроме одного, имеют `condition`; ровно одно ребро —
   `isDefault: true` (fallback, без него граф может завести заявку в тупик)
6. `serviceTask`: ровно одно исходящее ребро, без `action`/`condition`
7. **Делегаты существуют**: `assigneeProviderId`/`validatorIds`/`serviceTaskProviderId`,
   упомянутые в конфиге, реально зарегистрированы в `WorkflowRegistry.listMeta()` на момент
   публикации — иначе 4xx с списком отсутствующих id. Это прямая реализация риска и митигации из
   исходного ТЗ (раздел 8: «Ошибки в конфигурации JSON... Строгая валидация JSON-схемы конфига на
   бэкенде перед сохранением версии»)

Валидатор — чистая функция `validateWorkflowConfig(config, registry): ValidationResult`, без
побочных эффектов, используется и при публикации (фаза 04), и потенциально в редакторе на фронте
для live-подсказок (не обязательно в v1).

## Условия Gateway — JSONLogic

```typescript
import jsonLogic from 'json-logic-js';

function evaluateCondition(rule: JsonLogicRule, ctx: DelegateContext): boolean {
  return Boolean(jsonLogic.apply(rule, { payload: ctx.payload, context: ctx.context }));
}
```

`json-logic-js` — маленькая (~5KB), широко используемая для ровно этой задачи библиотека (её
формат условий — де-факто стандарт в low-code/workflow тулах вроде n8n, Directus). JSON-дерево,
не язык выражений — не тянет парсер/eval, ложится на ADR-02. UI редактора в v1 (фаза 05) не даёт
редактировать дерево целиком — только плоский список сравнений `field/operator/value`,
объединённых через `and`; формат хранения при этом сразу полноценный JSONLogic-совместимый, чтобы
усложнить UI позже без миграции схемы.

## Интерпретатор

Общая процедура `advance()` — проходит транзитные узлы (`start`, `gateway`, `serviceTask`)
автоматически, синхронно, в рамках одного вызова, пока не упрётся в `userTask` или `end`:

```typescript
interface AdvanceResult {
  finalNode: UserTaskNode | EndNode;
  hops: Array<{ from: string; to: string; action: string | null }>; // для audit_log
}

async function advance(
  config: WorkflowVersionConfig,
  fromNodeId: string,
  ctx: DelegateContext,
  registry: WorkflowRegistry,
): Promise<AdvanceResult> {
  let current = findNode(config, fromNodeId);
  const hops: AdvanceResult['hops'] = [];
  let guard = 0;

  while (current.type !== 'userTask' && current.type !== 'end') {
    if (++guard > 100) throw new Error('workflow graph cycle guard triggered'); // защита от некорректно спроектированного графа

    if (current.type === 'serviceTask') {
      const provider = registry.getServiceTaskProvider(current.serviceTaskProviderId);
      await provider.execute({ ...ctx, params: current.serviceTaskProviderParams });
    }

    const next = current.type === 'gateway'
      ? pickGatewayEdge(config, current.id, ctx)   // первое совпавшее condition, иначе isDefault
      : singleOutgoingEdge(config, current.id);     // start / serviceTask — ровно одно ребро

    hops.push({ from: current.id, to: next.target, action: null }); // action=null — это движок, не человек
    current = findNode(config, next.target);
  }

  return { finalNode: current, hops };
}
```

`start`/`executeAction` вызывают `advance()`, дописывают в `workflow_audit_log` по одной строке на
каждый `hop` **плюс** одну строку за само действие пользователя (если был action) — все с
`actor_id` инициатора (см. «Раунд 4/6» в
критике): автоматические хопы через
Gateway/ServiceTask атрибутируются тому же пользователю, чьё действие их вызвало, не NULL.

```typescript
async function startProcess(workflowCode: string, payload: unknown, startedBy: string): Promise<ProcessInstance> {
  const { workflow, version, config } = await loadCurrentVersion(workflowCode); // 404 если workflow неактивен
  const startNode = findStartNode(config);
  const instance = await insertProcessInstance({ workflowVersionId: version.id, workflowCode, currentState: startNode.id, payload, createdBy: startedBy });

  const ctx = { payload, context: { startedBy } };
  const { finalNode, hops } = await advance(config, startNode.id, ctx, registry);
  await writeAuditHops(instance.id, startedBy, hops);
  await settle(instance, finalNode, ctx, startedBy); // создать workflow_task ИЛИ проставить completed_at
  return instance;
}

async function executeAction(processInstanceId: string, action: string, patch: unknown, actingUser: string, comment?: string): Promise<ProcessInstance> {
  const instance = await loadInstance(processInstanceId); // 404 если нет / уже completed
  const { config } = await loadFrozenVersion(instance.workflowVersionId); // версия НИКОГДА не переразрешается на текущую
  const node = findNode(config, instance.currentState) as UserTaskNode; // иначе 400 — не userTask, действия невозможны

  const payload = { ...instance.payload, ...patch };
  await runValidators(node.validatorIds, { payload, context: instance.context }, registry); // 4xx при первом провалившемся, без побочных эффектов

  const edge = findEdgeByAction(config, node.id, action); // 400, если такого action нет из текущего состояния — критерий приёмки 3 исходного ТЗ
  await closeCurrentTask(instance.id);
  await writeAudit(instance.id, actingUser, node.id, edge.target, action, comment);

  const ctx = { payload, context: instance.context };
  const { finalNode, hops } = await advance(config, edge.target, ctx, registry);
  await writeAuditHops(instance.id, actingUser, hops);
  await updateInstancePayload(instance.id, payload);
  await settle(instance, finalNode, ctx, actingUser);
  return reload(instance.id);
}
```

`settle()` — общий хвост для `start`/`executeAction`: если `finalNode.type === 'userTask'`,
резолвит `AssigneeProvider`, создаёт `workflow_tasks`, `current_state = finalNode.id`; если
`'end'` — `completed_at = now()`, `current_state = finalNode.id`, без задачи.

## Версионирование

```typescript
async function publishVersion(workflowId: string, config: WorkflowVersionConfig, publishedBy: string): Promise<WorkflowVersion> {
  const result = validateWorkflowConfig(config, registry);
  if (!result.valid) throw new ValidationError(result.errors); // 4xx с деталями, не 500

  const nextVersionNumber = await getNextVersionNumber(workflowId); // max(version_number)+1, 1 при первой публикации
  const version = await insertWorkflowVersion({ workflowId, versionNumber: nextVersionNumber, config, createdBy: publishedBy });
  await updateWorkflow(workflowId, { currentVersionId: version.id });
  return version;
}
```

`workflow_versions` immutable — `publishVersion` только вставляет, никогда не обновляет
существующую строку. Активные `process_instances` держат `workflow_version_id`, разрешённый на
старте и никогда не переразрешаемый — критерий приёмки 1 исходного ТЗ соблюдается по построению,
без отдельного механизма.

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/module-workflow/package.json` | Изменить | Добавить `json-logic-js`, `zod` (если ещё нет как dependency, а не только через workspace) |
| `packages/module-workflow/src/backend/validation.ts` | Создать | `validateWorkflowConfig()` — zod-схема формы + семантические проверки 1–7 выше |
| `packages/module-workflow/src/backend/conditions.ts` | Создать | `evaluateCondition()` — обёртка над `json-logic-js` |
| `packages/module-workflow/src/backend/engine.ts` | Создать | `advance()`, `startProcess()`, `executeAction()`, `settle()` |
| `packages/module-workflow/src/backend/versioning.ts` | Создать | `publishVersion()`, `getNextVersionNumber()` |
| `packages/module-workflow/src/backend/errors.ts` | Создать | `ValidationError`, `InvalidActionError`, `ValidatorFailedError` — типизированные ошибки, роуты фазы 03/04 маппят их в правильные HTTP-статусы |

## Порядок реализации

- [x] ~~`json-logic-js` в зависимости~~ → самописный эвалуатор в `conditions.ts` (~80 строк, план
      допускал оба варианта): формат хранения полностью JSONLogic-совместим, поддерживаемое
      подмножество — `var, ==, !=, ===, !==, >, >=, <, <=, in, and, or, !, !!`; без новой зависимости
- [x] `validation.ts` — ~~форма (zod)~~ + 7 семантических проверок. **Отличие:** zod фактически
      нигде в `packages/` не используется (ссылка плана на `shared/validators.ts` — конвенция из
      гайда, не реальный код) — форма проверяется вручную, TODO-комментарий в файле на случай
      появления zod в проекте
- [x] `errors.ts` — типизированные ошибки движка (включая `ForbiddenActionError`/`WorkflowNotFoundError`
      из фазы 03 — сразу, чтобы не переоткрывать файл)
- [x] `engine.ts` — `advance()`, `startProcess()`, `executeAction()`, `settle()`
- [x] ~~`versioning.ts`~~ — `publishVersion()` живёт в `engine.ts`: отдельный файл был бы одной
      функцией, делящей все зависимости движка
- [ ] Юнит-тесты интерпретатора — **не написаны**. Причина «в репозитории нет тестовой инфраструктуры» устарела: с августа 2026 есть `node --test` по `dist` (65 тестов в core и hr), так что препятствий больше нет
      , её настройка — отдельная задача вне скоупа

Статус: реализовано 2026-07-16, typecheck/biome чисто, вживую не прогнано. Ещё отличие: в
`workflow_audit_log` авто-хопы пишутся с `action='auto'` (не `null`, как в псевдокоде плана) —
колонка `action` в схеме NOT NULL, литерал `'auto'` отличим от пользовательских действий.

## Проверка

1. Опубликовать граф без `start`-ноды → 4xx с понятной ошибкой, не 500
2. Опубликовать граф, где `userTask.assigneeProviderId` не зарегистрирован → 4xx со списком
   отсутствующих делегатов
3. Запустить процесс на графе с Gateway → убедиться, что `current_state` останавливается на
   `userTask`/`end`, никогда на `gateway`/`serviceTask`/`start`
4. Выполнить action, не описанный для текущей ноды → 400, `process_instances`/`workflow_tasks` не
   изменились
5. Провалить валидатор → 4xx, транзиция не применена
6. Опубликовать v2 существующего workflow → активный instance на v1 продолжает резолвить старый
   `config`, новый instance стартует на v2
7. Проверить `workflow_audit_log`: и явное действие, и автоматические хопы через Gateway
   атрибутированы одному и тому же `actor_id`
