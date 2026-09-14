---
title: "01. Контракты, схема БД, Plugin Registry"
type: plan
tier: 2
status: implemented
date: 2026-07-16
---

# 01. Контракты, схема БД, Plugin Registry

Родительский план: [2026-07-16-workflow.md](2026-07-16-workflow.md)

**Блокируется:** ничем — самая нижняя фаза.
**Блокирует:** все остальные подпланы.
**Пакет:** новый `@amplicada/module-workflow`. Никакого кода из `module-hr`/`module-admin` здесь
не появляется и не должно.

## Что делаем

Фундамент: типы конфига графа (nodes/edges), контракт Plugin Registry, схема БД (5 таблиц),
миграция, скелет пакета (`package.json`, `tsconfig.json`, `backend/setup.ts`). Никакой логики
выполнения, никаких HTTP-роутов — чистое описание "из чего состоит процесс", без побочных эффектов.

## Модель графа (contracts)

```typescript
// contracts/graph.ts

export type NodeType = 'start' | 'userTask' | 'gateway' | 'serviceTask' | 'end';

interface WorkflowNodeBase {
  id: string;
  label: string;
  position: { x: number; y: number }; // раскладка в React Flow, персистится как есть
}

export interface StartNode extends WorkflowNodeBase { type: 'start' }
export interface EndNode extends WorkflowNodeBase { type: 'end' }

export interface UserTaskNode extends WorkflowNodeBase {
  type: 'userTask';
  assigneeProviderId: string;
  assigneeProviderParams?: Record<string, unknown>;
  validatorIds?: string[]; // все должны пройти перед ЛЮБЫМ исходящим action
}

export interface GatewayNode extends WorkflowNodeBase { type: 'gateway' }

export interface ServiceTaskNode extends WorkflowNodeBase {
  type: 'serviceTask';
  serviceTaskProviderId: string;
  serviceTaskProviderParams?: Record<string, unknown>;
}

export type WorkflowNode = StartNode | UserTaskNode | GatewayNode | ServiceTaskNode | EndNode;

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  action?: string;        // обязателен на рёбрах, исходящих из userTask
  condition?: JsonLogicRule; // обязателен на рёбрах, исходящих из gateway (кроме isDefault)
  isDefault?: boolean;    // fallback-ребро gateway, ровно одно на узел
}

export type JsonLogicRule = Record<string, unknown>; // рекурсивное дерево, типизируется на уровне рантайм-валидации (фаза 02), не здесь

export interface WorkflowVersionConfig {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
```

`serviceTask` — узел, которого нет в палитре исходного ТЗ (4.2.1), но необходим, чтобы
`ServiceTaskProvider` (уже объявленный в ТЗ 3.1) вообще имел, где выполняться. Обоснование и
поведение — в родительском плане, раздел «Модель графа».

## Plugin Registry (contracts)

```typescript
// contracts/registry.ts

export interface DelegateContext {
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  params?: Record<string, unknown>; // из *ProviderParams конкретной ноды
}

export interface AssigneeProvider {
  resolve(ctx: DelegateContext): Promise<string>; // id пользователя
}

export interface ValidatorProvider {
  validate(ctx: DelegateContext): Promise<{ valid: boolean; message?: string }>;
}

export interface ServiceTaskProvider {
  execute(ctx: DelegateContext): Promise<void>;
}

export interface DelegateMeta {
  id: string;
  label: string;
}

export interface WorkflowRegistry {
  registerAssigneeProvider(id: string, label: string, provider: AssigneeProvider): void;
  registerValidatorProvider(id: string, label: string, provider: ValidatorProvider): void;
  registerServiceTaskProvider(id: string, label: string, provider: ServiceTaskProvider): void;

  getAssigneeProvider(id: string): AssigneeProvider | undefined;
  getValidatorProvider(id: string): ValidatorProvider | undefined;
  getServiceTaskProvider(id: string): ServiceTaskProvider | undefined;

  listMeta(): {
    assignee: DelegateMeta[];
    validator: DelegateMeta[];
    serviceTask: DelegateMeta[];
  };
}
```

Три раздельных типизированных набора (не один полиморфный `register(kind, id, provider)`) — каждое
место интерпретатора и так точно знает, какого типа делегат ему нужен в конкретной точке графа, не
нужен runtime kind-check.

Никакого CRUD/browsing вокруг делегатов не будет (см. обсуждение в
заметка,
раунд 2) — `listMeta()` существует только для пикера в properties panel редактора (фаза 05).

**Именование без `I`-префикса** — `AssigneeProvider`, не `IAssigneeProvider` (в кодовой базе нигде
не используется венгерская нотация, см. `BackendModule`, `DocumentRegistry`, `TaskScheduler`).

## Как регистрируется — `context.services`, не новое поле `BackendSetupContext`

`WorkflowRegistry` резолвится через `context.services.resolve<WorkflowRegistry>('workflow-registry')`
— **required-зависимость** для любого модуля, которому нужны делегаты (ADR-02:
`ref/adr/02-dependency-injection.md`), не новое поле в общем `BackendSetupContext`. Расширять
`BackendSetupContext` (`platform-core/src/contracts/backend/setup.ts`) новым полем `workflow` было
бы неверно — это заставило бы `platform-core` знать о концепции, которая ему не принадлежит
(движок не в core). Сервис-локатор с явным токеном ничего от core не требует.

```typescript
// module-workflow/backend/setup.ts
setup(context) {
  const registry = new WorkflowRegistryImpl();
  context.services.register('workflow-registry', registry);
}

// module-hr/backend/setup.ts (потребитель, фаза 07)
setup(context) {
  const registry = context.services.resolve<WorkflowRegistry>('workflow-registry');
  registry.registerAssigneeProvider('current-manager', 'Текущий руководитель', currentManagerProvider);
}
```

`resolve()` бросает исключение, если `module-workflow` не установлен в приложение раньше
`module-hr` — это осознанно (required-зависимость, громкий сбой на старте лучше тихого пропуска).

## Схема БД

Отличия от исходного ТЗ (раздел 2), с обоснованием:

| Таблица в ТЗ | Таблица здесь | Причина |
|---|---|---|
| `tasks` | `workflow_tasks` | Коллизия имён с `context.tasks`/`scheduled_tasks` (`TaskScheduler`, уже в `platform-core`) |
| `audit_log` | `workflow_audit_log` | Превентивно — `audit_log` слишком общее имя, ничего пока на него не претендует, но лучше не занимать его одним модулем сейчас |
| `REFERENCES users(id)` (везде) | `REFERENCES identity_user(id)` | В этой кодовой базе core-таблица идентичности называется `identity_user`, не `users` (см. `ref/context.md`) — прямая фактическая правка ТЗ, не архитектурное решение |

```sql
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    current_version_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id),
    version_number INT NOT NULL,
    config JSONB NOT NULL,
    created_by UUID NOT NULL REFERENCES identity_user(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workflow_id, version_number)
);

CREATE TABLE process_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id),
    workflow_code VARCHAR(100) NOT NULL,
    current_state VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    context JSONB NOT NULL DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES identity_user(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE workflow_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_instance_id UUID NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
    assignee_id UUID NOT NULL REFERENCES identity_user(id),
    state VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_workflow_tasks_assignee ON workflow_tasks(assignee_id, status);

CREATE TABLE workflow_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_instance_id UUID NOT NULL REFERENCES process_instances(id),
    actor_id UUID NOT NULL REFERENCES identity_user(id),
    action VARCHAR(100) NOT NULL,
    from_state VARCHAR(100),
    to_state VARCHAR(100),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`workflows.current_version_id` — не FK в исходном ТЗ (циклическая ссылка workflows↔workflow_versions
не выражается FK-циклом при создании таблиц в одном файле без deferred constraint) — оставляем без
FK на уровне БД, как и в исходном ТЗ, консистентность гарантирует движок (фаза 02).

## Зависимости

| Пакет | Зачем | Новый? |
|-------|-------|--------|
| `@amplicada/platform-core` | `BackendModule`, `db`, `identityUser`, `context.services` | peer, уже везде |

Никаких новых npm-зависимостей в этой фазе (json-logic-js и reactflow появятся в фазах 02 и 05).

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/module-workflow/package.json` | Создать | По шаблону `ref/guides/module-structure.md`: subpath exports `./backend`, `./frontend`, `./contracts` |
| `packages/module-workflow/tsconfig.json` | Создать | По шаблону других модулей |
| `packages/module-workflow/src/contracts/graph.ts` | Создать | `NodeType`, `WorkflowNode`-иерархия, `WorkflowEdge`, `WorkflowVersionConfig`, `JsonLogicRule` |
| `packages/module-workflow/src/contracts/registry.ts` | Создать | `WorkflowRegistry`, `AssigneeProvider`, `ValidatorProvider`, `ServiceTaskProvider`, `DelegateContext`, `DelegateMeta` |
| `packages/module-workflow/src/contracts/index.ts` | Создать | Re-export |
| `packages/module-workflow/src/backend/schema.ts` | Создать | Drizzle-схема 5 таблиц выше |
| `packages/module-workflow/src/backend/registry.ts` | Создать | `WorkflowRegistryImpl` — три `Map`, синхронный `register*`/`get*`/`listMeta()`, без reconcile/БД (в отличие от `TaskRegistryImpl` — делегатам не нужен статус paused/schedule/stale, это чистые функции) |
| `packages/module-workflow/src/backend/setup.ts` | Создать | `BackendModule`: регистрирует миграции + `WorkflowRegistryImpl` в `context.services('workflow-registry')` |
| `packages/module-workflow/src/backend/index.ts` | Создать | Re-export |
| `packages/module-workflow/migrations/0000_create_workflow.sql` | Создать | 5 таблиц выше |
| `packages/module-workflow/migrations/meta/_journal.json` | Создать | Journal для первой миграции |

## Порядок реализации

- [x] `package.json`, `tsconfig.json` по шаблону модуля
- [x] `contracts/graph.ts`, `contracts/registry.ts`, `contracts/index.ts`
- [x] `backend/schema.ts` — Drizzle-таблицы
- [x] `backend/registry.ts` — `WorkflowRegistryImpl`
- [x] `backend/setup.ts` — `BackendModule`, регистрация миграций + сервиса
- [x] Миграция `0000_create_workflow.sql` + `_journal.json`
- [x] Добавить `moduleWorkflow` в `apps/api` — подключен сразу по-настоящему (не закомментированным импортом): фазы 03–04 реализовывались той же сессией, скрывать модуль не имело смысла

Статус: реализовано 2026-07-16, typecheck/biome чисто. Раздел «Проверка» не прогнан вживую (нужен
Postgres). Уточнение: токен `'workflow-registry'` вынесен константой `WORKFLOW_REGISTRY_TOKEN` в
`contracts/registry.ts`, чтобы потребители не хардкодили строку.

## Проверка

1. `pnpm -w typecheck` и `pnpm exec biome check` по новому пакету — чисто
2. Поднять миграции → все 5 таблиц появились с правильными FK на `identity_user`
3. Из тестового модуля вызвать `context.services.resolve<WorkflowRegistry>('workflow-registry')`,
   зарегистрировать тестовый `AssigneeProvider`, убедиться, что `listMeta()` его возвращает
4. Убедиться, что `packages/module-workflow` не содержит ни одного импорта из `packages/module-hr`
   или `packages/module-admin`
