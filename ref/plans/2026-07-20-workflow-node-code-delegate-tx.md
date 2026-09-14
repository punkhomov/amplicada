---
title: workflow — стабильный код ноды для отчётности + транзакция в делегатах
type: plan
tier: 2
status: implemented
date: 2026-07-20
---

# workflow — стабильный код ноды для отчётности + транзакция в делегатах

Продолжение [2026-07-19-workflow-fields-actor-automation.md](2026-07-19-workflow-fields-actor-automation.md)
(фазы A+B которого реализованы). В обсуждении фазы C всплыли два независимых друг от друга и от
асинхронной автоматики улучшения — оформляются отдельным планом, чтобы не раздувать уже закрытый
документ.

## Текущая проблема

1. **Нет стабильного ключа ноды для внешних потребителей.** `node.id` генерируется в редакторе как
   `${type}-${crypto.randomUUID().slice(0, 8)}` (`workflow-editor-page.tsx:97`) — случайный
   технический токен. Он не персистентен между версиями графа: если админ пересоздаст ноду (а не
   отредактирует существующую), `id` будет другим. `process_instances.current_state` хранит именно
   его — сравнение «в каком статусе процесс» между версиями требует резолва через JSONB
   `workflow_versions.config`, что не индексируется и не годится для отчётности/кэша (пример
   запроса: «сколько заявок сейчас на согласовании у руководителя», «полный отчёт по типу заявки»).
   `node.label` для этого тоже не подходит — это переводимый текст для UI, не код.
2. **Синхронные делегаты не могут писать транзакционно.** `DelegateContext` (`contracts/registry.ts`)
   не содержит `db` — `AssigneeProvider`/`ValidatorProvider`/`ServiceTaskProvider` могут только
   мутировать `payload`/`context` в памяти, но не могут атомарно записать что-то в свою таблицу
   вместе с переходом движка (например, зарезервировать бюджет, декрементировать лимит). Транзакция
   у движка уже есть (`WorkflowEngine.inTransaction`) — просто не прокинута дальше в `ctx`.

Оба пункта не связаны с асинхронной автоматикой (обсуждение fаза C, `asyncTask`/hooks остаётся
«по потребности» без изменений) — это независимые улучшения синхронного пути движка.

## Решение

Добавить на ноду стабильный `code` (аналог `edge.action`, но для статусов вместо действий) —
опциональный, задаётся админом в редакторе, отдельный от технического `id` и переводимого `label`;
денормализовать его на `process_instances.current_state_code` (обновляется вместе с `currentState`
в `settle()`) для дешёвых индексируемых запросов извне движка. Прокинуть транзакционный `db` в
`DelegateContext`, чтобы синхронные делегаты могли участвовать в транзакции движка.

## Архитектура

```typescript
// contracts/graph.ts
interface WorkflowNodeBase {
  id: string;
  /**
   * Стабильный домен-код ноды для внешних потребителей (отчёты, кэш) — в отличие от id
   * (технический, может пересоздаваться) и label (переводимый текст). Опционален.
   */
  code?: string;
  label: string;
  position: { x: number; y: number };
}
```

```typescript
// contracts/registry.ts
export interface DelegateContext {
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  params?: Record<string, unknown>;
  /**
   * Транзакция движка — доступна только синхронным делегатам (assignee/validator/serviceTask),
   * вызываемым внутри WorkflowEngine.inTransaction. Асинхронные джобы (фаза C) этого поля не
   * получают: к моменту их исполнения транзакция уже закоммичена.
   */
  db?: BackendDbService;
}
```

`process_instances.current_state_code` пишется в единственном месте, где меняется `currentState` —
`WorkflowEngine.settle()` (обе ветки: `end` и `userTask`), значением `finalNode.code ?? null`.
Заполняется только для нод, у которых админ явно задал `code` — секьюрный дефолт `null`, как и у
`editableKeys`.

## Зависимости

Новых npm-пакетов и инфраструктуры нет. Одна миграция в `module-workflow` (только денормализованная
колонка + индекс — `code` ноды живёт в JSONB `config`, миграции не требует).

## Изменения по файлам

| Файл | Действие |
|------|----------|
| `module-workflow/src/contracts/graph.ts` | `WorkflowNodeBase.code?: string` |
| `module-workflow/src/contracts/registry.ts` | `DelegateContext.db?: BackendDbService` |
| `module-workflow/migrations/0003_process_instance_state_code.sql` | `process_instances.current_state_code varchar(100)` + индекс (+ `_journal.json`) — `0002` уже занят `create_workflow_automation_jobs` |
| `module-workflow/src/backend/schema.ts` | Отразить миграцию |
| `module-workflow/src/backend/engine.ts` | `settle()` пишет `currentStateCode`; `ctx`-литералы в `startProcess`/`executeAction` получают `db` |
| `module-workflow/src/frontend/lib/graph-mapping.ts` | `EditorNodeData.code?: string`, проброс в `configToFlow`/`flowToConfig` (userTask, end) |
| `module-workflow/src/frontend/components/properties-panel.tsx` | Поле «Код статуса (стабильный, для отчётности)» для userTask/end |

## Порядок реализации

- [x] Контракт `WorkflowNodeBase.code`; properties panel — поле кода на userTask/end; проброс в
      graph-mapping
- [x] Миграция `current_state_code` + индекс; `schema.ts`
- [x] `engine.ts`: `settle()` резолвит и пишет `currentStateCode`
- [x] Контракт `DelegateContext.db`; прокинуть транзакционный `db` в `ctx` в `startProcess` и
      `executeAction`
- [x] `turbo build typecheck` + biome

## Проверка

1. На ноде «На согласовании у руководителя» задать код `in_agreement_with_the_supervisor`,
   опубликовать версию, подать заявку → `SELECT current_state_code FROM process_instances WHERE
   id = ...` возвращает этот код (не `node.id`).
2. Republish графа с пересозданием той же по смыслу ноды (новый технический `id`, тот же `code`) →
   у новых инстансов `current_state_code` совпадает со старыми несмотря на разный `current_state`.
3. Нода без заданного `code` → `current_state_code IS NULL`, процесс работает как раньше.
4. Тестовый синхронный делегат (validator/assignee/serviceTask) использует `ctx.db` для записи в
   свою таблицу; откат экшена (например, `ValidatorFailedError`) откатывает и эту запись — она не
   остаётся в БД.
