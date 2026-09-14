---
title: "03. Runtime HTTP API"
type: plan
tier: 2
status: implemented
date: 2026-07-16
---

# 03. Runtime HTTP API

Родительский план: [2026-07-16-workflow.md](2026-07-16-workflow.md)

**Блокируется:** [02](02-engine-and-versioning.md)
**Блокирует:** [06](06-process-view-frontend.md)
**Не блокирует и не блокируется:** [04](04-admin-api-and-documents.md) — обе фазы зависят только
от 02, можно вести параллельно.
**Пакет:** `module-workflow`

## Что делаем

HTTP-слой поверх интерпретатора (фаза 02): запуск процесса, выполнение действия, инбокс, таймлайн.
Портальный UI-потребитель этих роутов — вне скоупа текущей разбивки (см. родительский план,
«Отложено»); в этой итерации потребитель — только страница процесса из фазы 06.

## Роуты

Префикс `/api/workflows` (переименован из `/api/hr-workflows` — см.
критику, раунд 6, по той же причине, что и
имя пакета).

| Метод | Путь | Авторизация | Описание |
|---|---|---|---|
| `POST` | `/api/workflows/:code/start` | любой аутентифицированный | Запуск нового процесса, `current_version_id` workflow'а на момент вызова |
| `GET` | `/api/workflows/processes/:id` | аутентифицированный (см. ниже) | Детали процесса: `payload`, `currentState`, `workflowCode`, `completedAt` |
| `POST` | `/api/workflows/processes/:id/actions/:action` | **строго assignee** текущей pending-задачи | Выполнение перехода |
| `GET` | `/api/workflows/tasks/my` | аутентифицированный, неявно `assignee_id = request.user.id` | Инбокс текущего пользователя |
| `GET` | `/api/workflows/processes/:id/timeline` | аутентифицированный (см. ниже) | `workflow_audit_log` по процессу |

**Известное упрощение v1** (озвучить пользователю при ревью, не решено отдельным вопросом):
`GET`-роуты детали/таймлайна в v1 не проверяют, что запрашивающий — создатель или assignee
процесса, только факт аутентификации. Единственный потребитель в этой разбивке — admin-страница
[06](06-process-view-frontend.md), не публичный портал (тот явно отложен). Полноценная
data-level авторизация — тема будущей системы прав (см. родительский план, «Отложено»).

## Аутентификация — по образцу `module-admin`

Тот же паттерн, что уже используется (`packages/module-admin/src/backend/index.ts`): плагин с
`preHandler`, резолвящим `auth-service` из `context.services` и вызывающим
`getCurrentUser(request)`, а не `request.user` (в этой кодовой базе он намеренно не
декорируется — см. комментарий в `module-admin/src/backend/index.ts:20-23`).

```typescript
app.register(
  async function workflowRoutes(fastify) {
    fastify.addHook('preHandler', async (request, reply) => {
      const authService = context.services.resolve<BackendAuthService>('auth-service');
      const user = authService.getCurrentUser(request);
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
    });

    fastify.setErrorHandler((err, _request, reply) => {
      if (err instanceof InvalidActionError || err instanceof ValidatorFailedError) {
        return reply.code(400).send({ error: err.message });
      }
      if (err instanceof ForbiddenActionError) return reply.code(403).send({ error: err.message });
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      reply.code((err as Error & { statusCode?: number }).statusCode ?? 500).send({ error: err.message });
    });

    createProcessRoutes(fastify, context);
    createTaskRoutes(fastify, context);
  },
  { prefix: '/api/workflows' },
);
```

## Авторизация действия — `ForbiddenActionError`

```typescript
async function actionHandler(request, reply) {
  const user = authService.getCurrentUser(request)!; // preHandler уже гарантировал наличие
  const task = await loadPendingTaskForInstance(request.params.id);
  if (!task || task.assigneeId !== user.id) {
    throw new ForbiddenActionError('Действие доступно только назначенному исполнителю');
  }
  const result = await executeAction(request.params.id, request.params.action, request.body.payload, user.id, request.body.comment);
  reply.send(result);
}
```

`ForbiddenActionError` — новый тип ошибки движка (дополняет `errors.ts` из фазы 02).

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/module-workflow/src/backend/errors.ts` | Изменить | Добавить `ForbiddenActionError`, `NotFoundError` |
| `packages/module-workflow/src/backend/routes/processes.ts` | Создать | `POST /:code/start`, `GET /processes/:id`, `POST /processes/:id/actions/:action`, `GET /processes/:id/timeline` |
| `packages/module-workflow/src/backend/routes/tasks.ts` | Создать | `GET /tasks/my` |
| `packages/module-workflow/src/backend/setup.ts` | Изменить | `setup(context, app)` — регистрация fastify-плагина с префиксом `/api/workflows`, preHandler авторизации, error handler (по образцу `module-admin/src/backend/index.ts`) |

## Порядок реализации

- [x] `errors.ts` — `ForbiddenActionError`, `WorkflowNotFoundError` (имя вместо `NotFoundError` — конкретнее)
- [x] `routes/processes.ts` — все 4 роута процессов
- [x] `routes/tasks.ts` — `GET /tasks/my` (с JOIN на `process_instances` для `workflowCode`)
- [x] `setup.ts` — регистрация плагина, preHandler, error handler
- [x] Подключить `moduleWorkflow` в `apps/api` (порядок: до `hrModule` — будущему потребителю нужен `resolve('workflow-registry')`)

Статус: реализовано 2026-07-16, вживую не прогнано. Отличие: `GET /processes/:id` сразу возвращает
`availableActions`/`isAssignee` — расширение, которое план откладывал в фазу 06, но оно тривиально
и избавляет фазу 06 от бэкенд-правок.

## Проверка

1. `POST /api/workflows/training-request/start` без сессии → 401
2. То же с валидной сессией → 201, процесс создан, `workflow_tasks` содержит запись на резолвленного assignee
3. `POST .../actions/approve` от имени НЕ-assignee → 403
4. То же от имени assignee → 200, `current_state` изменился согласно графу
5. `POST .../actions/nonexistent-action` → 400, состояние не изменилось
6. `GET /api/workflows/tasks/my` возвращает только задачи текущего пользователя
7. `GET .../timeline` — хронология включает и явные действия, и автоматические хопы через Gateway
