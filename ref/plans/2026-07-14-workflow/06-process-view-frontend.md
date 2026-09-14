---
title: "06. Кастомная страница процесса (таймлайн)"
type: plan
tier: 2
status: implemented
date: 2026-07-16
---

# 06. Кастомная страница процесса (таймлайн)

Родительский план: [2026-07-16-workflow.md](2026-07-16-workflow.md)

**Блокируется:** [03](03-runtime-api.md), [04](04-admin-api-and-documents.md)
**Блокирует:** ничего в этой разбивке
**Пакет:** `module-workflow`

## Что делаем

Страница `/admin/workflows/processes/:id` — по образцу `AdminTaskDetail`
(`module-admin/src/frontend/pages/admin-task-detail.tsx`): таблица истории + детали, тот же
уровень сложности, паттерн уже есть в кодовой базе (в отличие от [05](05-editor-frontend.md)).
Достигается кликом по `DocumentPage.linkTemplate`, зарегистрированному в
[04](04-admin-api-and-documents.md), из карточки Document `process_instance`.

Это единственная точка в текущей разбивке, где пользователь может выполнить action над процессом
через UI — портального «Инбокс/Моя заявка» интерфейса для обычных пользователей в этой итерации
нет (см. родительский план, «Отложено»), так что до появления портала это единственный способ
продвинуть процесс через UI вообще (не через curl).

## Дополнение к API из фазы 03

`GET /api/workflows/processes/:id` (роут уже существует, фаза 03) — расширяется двумя полями,
нужными именно этой странице:

```typescript
interface ProcessDetail {
  id: string;
  workflowCode: string;
  currentState: string;
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  completedAt: string | null;
  availableActions: { action: string; label: string }[]; // из исходящих рёбер текущей userTask-ноды; [] если end или текущий пользователь не assignee
  isAssignee: boolean; // request.user.id === assignee_id текущей pending workflow_task
}
```

`availableActions` вычисляется из графа (та же frozen-версия, что резолвит движок) — метки рёбер
(`WorkflowEdge.label`, если задан в редакторе, иначе сам `action`).

## Структура страницы

```
┌────────────────────────────────────────────────────┐
│ {workflow.name}          [Badge: в работе/завершена] │
├────────────────────────────────────────────────────┤
│ Текущий этап: {currentState}                        │
│ Payload / Context — pretty-printed JSON (read-only)  │
├────────────────────────────────────────────────────┤
│ [Одобрить]  [Отклонить]  ...  ← только если isAssignee, по одной кнопке на availableActions │
│ Комментарий: [textarea]                              │
├────────────────────────────────────────────────────┤
│ Таймлайн (workflow_audit_log, новые сверху)          │
│  • {actor} перевёл(а) из {fromState} в {toState} ({action}) — {timestamp}, {comment} │
│  • ...автоматические хопы через Gateway тоже видны, без action, отмечены как системные │
└────────────────────────────────────────────────────┘
```

Редактирование `payload` через эту страницу — вне скоупа (портальная задача, не админская;
собирать динамическую форму из конфига ноды здесь не делаем). Действие сопровождается только
опциональным комментарием, как в `POST .../actions/:action` (фаза 03: `{ comment }`, `payload`
опционален и в v1 с этой страницы не отправляется).

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/module-workflow/src/backend/routes/processes.ts` | Изменить | `GET /processes/:id` — добавить `availableActions`, `isAssignee` в ответ (фаза 03 создала роут, здесь расширение) |
| `packages/module-workflow/src/frontend/pages/process-timeline-page.tsx` | Создать | Страница целиком |
| `packages/module-workflow/src/frontend/components/action-buttons.tsx` | Создать | Кнопки действий + комментарий, вызов `POST .../actions/:action` |
| `packages/module-workflow/src/frontend/setup.tsx` | Изменить | Регистрация роута `/admin/workflows/processes/:id` |

## Порядок реализации

- [x] Расширить `GET /processes/:id` — `availableActions`/`isAssignee` были добавлены ещё в фазе 03;
      в этой фазе добавлены `nodeLabels` (id ноды → label — страница показывает человекочитаемые
      этапы) и JOIN `identity_user` в `/timeline` (`actorLogin` вместо голого UUID) — небольшие
      расширения сверх плана
- [x] `process-timeline-page.tsx` — шапка, payload/context, таймлайн-список (авто-хопы `action='auto'`
      отображаются как «система» с иконкой)
- [x] `action-buttons.tsx` — кнопки + комментарий, mutation на `POST .../actions/:action`
- [x] Регистрация роута в `setup.tsx`

Статус: реализовано 2026-07-16, typecheck/biome чисто, вживую не прогнано.

## Проверка

1. Открыть страницу процесса от имени НЕ-assignee → кнопки действий не показаны, таймлайн виден
2. Открыть от имени assignee → кнопки показаны, соответствуют `availableActions` из графа
3. Нажать действие → таймлайн обновляется, `current_state` в шапке меняется, кнопки скрываются/
   меняются на новые (для следующего assignee, если это не он)
4. Процесс, дошедший до `end` → бейдж «завершена», кнопок нет
5. В таймлайне видны автоматические хопы через Gateway (если граф их содержит) — без явного
   `action`, но с `actor_id` инициатора цепочки (см. [02](02-engine-and-versioning.md))
