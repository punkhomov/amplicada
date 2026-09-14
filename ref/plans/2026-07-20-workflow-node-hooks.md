---
title: workflow — хуки ноды (post-enter side effects)
type: plan
tier: 2
status: implemented
date: 2026-07-20
---

# workflow — хуки ноды (post-enter side effects)

Продолжение обсуждения фазы C из
[2026-07-19-workflow-fields-actor-automation.md](2026-07-19-workflow-fields-actor-automation.md) —
конкретизирует механизм «однотипных повторяющихся side-effect действий» (уведомления и т.п.),
который в исходном плане был только упомянут. Уровень детализации — как в
[2026-07-20-workflow-node-code-delegate-tx.md](2026-07-20-workflow-node-code-delegate-tx.md):
концепция зафиксирована, часть деталей (см. «Открытые вопросы») дообсуждается отдельно.

## Текущая проблема

Повторяющиеся side-effect действия при входе в статус (типичный пример — уведомление на email
«вам назначена задача») сегодня некуда деть:

- Смоделировать отдельной `serviceTask`-нодой — статус процесса исказится: текущая нода станет
  «Отправка письма» вместо «На согласовании у руководителя» (`node.label`/`node.code`, см.
  соседний план, — это то, что видит пользователь и на что фильтруется отчётность).
- Выполнить синхронно внутри `serviceTask` на самой userTask-ноде — невозможно: userTask не
  исполняет делегатов, только резолвит assignee один раз при входе, и синхронный вызов внешнего
  SMTP/API держал бы `FOR UPDATE`-лок транзакции движка (та же проблема, что у ИИ-шага в фазе C
  исходного плана).

## Решение

Четвёртый вид делегата — **хук**, концептуально то же, что `assignee`/`validator`/`serviceTask`
(та же форма `execute(ctx)`), но в отдельном реестре, чтобы его нельзя было по ошибке назначить
основным делегатом ноды (`assigneeProviderId`/`serviceTaskProviderId`). На userTask/end-ноде —
список хуков (0..N), каждый — `providerId` + свои JSON-параметры (тот же паттерн, что уже есть у
`serviceTaskProviderParams`). Момент срабатывания — только **post-enter**: после того как переход
закоммичен и нода стала `current_state`. Pre-hook (до входа/до коммита) сознательно не делаем —
не видно сценария, где он был бы нужен вместо обычного `serviceTask`.

Выполнение — асинхронное, вне транзакции движка, fire-and-forget: хук не влияет на маршрутизацию
и не должен блокировать процесс. Технически это тот же джоб-механизм, что проектируется для
`asyncTask` в фазе C (`workflow_automation_jobs` + воркер task-scheduler'а), но с другим финалом —
завершение хук-джобы просто помечает её `done`/`failed` и не вызывает `advance()` (в отличие от
`asyncTask`, чей результат маршрутизирует Gateway). Реализация хуков технически зависит от того,
что джоб-инфраструктура фазы C уже существует — по времени идёт после неё или вместе с первым её
реальным потребителем.

## Архитектура

```typescript
// contracts/registry.ts
export interface HookProvider {
  execute(ctx: DelegateContext): Promise<void>;
}

export interface WorkflowRegistry {
  // ...существующее...
  registerHookProvider(id: string, label: string, provider: HookProvider): void;
  getHookProvider(id: string): HookProvider | undefined;
}

export interface WorkflowDelegatesMeta {
  assignee: DelegateMeta[];
  validator: DelegateMeta[];
  serviceTask: DelegateMeta[];
  hook: DelegateMeta[]; // отдельный список — источник данных для UI хуков, не смешивается с serviceTask-пикером
}
```

```typescript
// contracts/graph.ts
export interface PostEnterHook {
  providerId: string;
  params?: Record<string, unknown>;
  /** Своя политика ретраев на каждом хуке (как у asyncTask), не общая на ноду. */
  maxAttempts: number;
  retryDelayMs: number;
}

interface WorkflowNodeBase {
  // ...id, code, label, position...
  /** Side-effect делегаты, срабатывающие после того, как нода стала current_state. Не влияют на маршрутизацию. */
  postEnterHooks?: PostEnterHook[];
}
```

UI (properties panel, userTask/end): секция «Хуки после входа» — список строк (провайдер из
`meta.hook` + JSON-параметры, тот же `JsonParamsField`, что у `serviceTaskProviderParams`),
кнопки добавить/удалить по образцу `RequestTypeFieldsEditor`. На канвасе (`workflow-node-types.tsx`)
— простой индикатор (точка) на нодах с непустым `postEnterHooks`, чтобы факт наличия хуков был
виден без открытия панели.

## Открытые вопросы — решены (2026-07-22)

- **Диспетчеризация**: общая таблица `workflow_automation_jobs` + дискриминатор `kind: 'route' |
  'hook'` (не отдельная таблица). `route` — существующие `asyncTask`-джобы (успех продолжает
  `advance()`/`settle()` через `completeAutomationJob`). `hook` — джобы `postEnterHooks`, создаются
  в `settle()` (ветки `end` и `userTask`) сразу после записи `currentState`, в той же транзакции.
  `runAutomationJob` ветвится по `job.kind` сразу после claim'а: `hook` уходит в отдельный
  `runHookJob` (помечает джобу `done`/`failed`, `advance()` не вызывает), `route` — по старому пути.
  `completeAutomationJob` (в т.ч. admin `/override`) теперь явно отклоняет `kind !== 'route'`
  (`InvalidActionError`) — маршрутизировать хук-джобу вручную бессмысленно.
- **Ретраи/видимость**: как у `asyncTask` — `maxAttempts`/`retryDelayMs` задаются на каждом хуке
  (не на уровне ноды), failed-хуки видны в существующем admin-списке джоб
  (`GET /admin/workflow-jobs`), `POST /admin/workflow-jobs/:id/retry` работает одинаково для обоих
  `kind` (сброс в `pending`, дальше решает `runAutomationJob`).
- **Идемпотентность**: хук срабатывает при каждом входе в ноду, включая повторный (цикл в графе) —
  джобы создаются заново на каждый `settle()`, без дедупликации по инстансу/ноде.

Решения приняты пользователем в диалоге , не
переоткрывать без явного пересмотра.

## Зависимости

Требовала джоб-инфраструктуру фазы C (`workflow_automation_jobs` + воркер) — на момент реализации
уже существовала (`2026-07-21-workflow-async-task.md`, реализован параллельно).

## Изменения по файлам (как реализовано)

| Файл | Действие |
|------|----------|
| `module-workflow/src/contracts/registry.ts` | `HookProvider`, `registerHookProvider`/`getHookProvider`, `WorkflowDelegatesMeta.hook` |
| `module-workflow/src/contracts/graph.ts` | `PostEnterHook`, `WorkflowNodeBase.postEnterHooks?: PostEnterHook[]` |
| `module-workflow/src/backend/services/registry.ts` | Реализация реестра хуков (`WorkflowRegistryImpl`) |
| `module-workflow/src/backend/schemas/workflow-automation-jobs.ts` + `migrations/0004_workflow_automation_jobs_kind.sql` | `kind varchar(10) default 'route'` |
| `module-workflow/src/backend/services/engine.ts` | `settle()` создаёт hook-джобы (end/userTask); `runAutomationJob` ветвится по `kind` → `runHookJob`; `completeAutomationJob` отклоняет `kind !== 'route'`; `startProcess`/`executeAction`/`completeAutomationJob` эagerно триггерят весь массив `automationJobIds` |
| `module-workflow/src/backend/validation.ts` | Валидация `postEnterHooks`: известный провайдер, `maxAttempts`/`retryDelayMs` |
| `module-workflow/src/frontend/widgets/properties-panel/ui/properties-panel.tsx` | Секция «Хуки после входа» (userTask/end), компонент `HooksEditor` |
| `module-workflow/src/frontend/widgets/workflow-node-types/ui/workflow-node-types.tsx` | Индикатор-точка на ноде при непустых `postEnterHooks` |
| `module-workflow/src/frontend/lib/graph-mapping.ts` | Проброс `postEnterHooks` в `configToFlow`/`flowToConfig`, дефолты ретраев |

## Порядок реализации

- [x] Контракт `HookProvider` + реестр (`registerHookProvider`/`getHookProvider`/`WorkflowDelegatesMeta.hook`)
- [x] `WorkflowNodeBase.postEnterHooks`; properties panel — секция хуков (userTask/end)
- [x] Индикатор хуков на канвасе
- [x] Диспетчеризация хук-джоб после коммита (`kind`-дискриминатор в `workflow_automation_jobs`)
- [x] `turbo build typecheck` + biome

## Проверка

Ручной сценарий (SQL/UI) не прогонялся — нет поднятой БД в этой сессии. Логика проверена
статически: `pnpm build`/`pnpm typecheck` по всему монорепо и `biome check` на изменённых файлах —
чисто. Тестовый `HookProvider`, зарегистрированный доменным модулем, должен: сработать после
коммита перехода на userTask/end с непустым `postEnterHooks`; не повлиять на `advance()`/маршрут;
повторно сработать при повторном входе в ту же ноду (цикл); уйти в `failed` после исчерпания
`maxAttempts`, оставаясь видимым в `GET /admin/workflow-jobs`.
