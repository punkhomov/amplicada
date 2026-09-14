---
title: "07. HR-делегаты и сквозная проверка"
type: plan
tier: 2
status: in-progress
date: 2026-07-16
---

# 07. HR-делегаты и сквозная проверка

Родительский план: [2026-07-16-workflow.md](2026-07-16-workflow.md)

**Блокируется:** [01](01-contracts-and-schema.md)–[06](06-process-view-frontend.md)
**Блокирует:** ничего — последняя фаза
**Пакет:** `module-hr` (потребитель) + сквозная проверка всего `module-workflow`

## Что делаем

Доказываем, что Plugin Registry реально работает как точка расширения (не только на тестовом
модуле из фаз 01–04), и прогоняем сквозной сценарий по всем фазам сразу — по аналогии с
[06-testing-and-validation.md](../2026-07-14-task-scheduler/06-testing-and-validation.md) у
task-scheduler.

## Найденный по ходу пробел: делегата «текущий руководитель» пока не на чем строить

`hr_user_profile` (`packages/module-hr/src/backend/schema.ts`) не содержит ссылки на руководителя
(нет `managerId`/`supervisorId` — только персональные поля сотрудника). Реальный
org-chart-делегат — это отдельная задача моделирования HR-домена (кому сотрудник подчиняется),
не инфраструктурная задача этой разбивки. Заводить её здесь означало бы протащить бизнес-логику
HR в план, который был явно ограничен инфраструктурой (см. родительский план, вступление).

**Решение для этой фазы:** регистрируем нарочно минимальный `AssigneeProvider`, который резолвит
исполнителя из `params`, заданных прямо в конфиге ноды редактора (`assigneeProviderParams:
{ userId: '...' }`) — этого достаточно, чтобы доказать механизм регистрации/резолва делегата
целиком, не решая задачу оргструктуры. Реальный org-chart-делегат — предмет отдельного будущего
плана (когда до него дойдёт очередь, добавить `managerId` в `hr_user_profile` и написать
полноценный `AssigneeProvider`, использующий его).

```typescript
// module-hr/backend/workflow-delegates.ts
export const fixedAssigneeProvider: AssigneeProvider = {
  async resolve({ params }) {
    const userId = (params as { userId?: string })?.userId;
    if (!userId) throw new Error('fixed-assignee: params.userId обязателен');
    return userId;
  },
};
```

```typescript
// module-hr/backend/setup.ts
setup(context) {
  // ...существующая регистрация hr_user_profile, миграций и т.д.
  const workflowRegistry = context.services.resolve<WorkflowRegistry>('workflow-registry');
  workflowRegistry.registerAssigneeProvider('fixed-assignee', 'Фиксированный исполнитель', fixedAssigneeProvider);
}
```

`module-hr` теперь зависит от `module-workflow` (не наоборот) — соответствует направлению
зависимости из родительского плана.

## Сквозной сценарий

1. В `apps/api`/`apps/demo` подключить `moduleWorkflow` и `moduleHr` в правильном порядке
   (`module-workflow` до `module-hr` — `resolve('workflow-registry')` в `module-hr.setup()`
   иначе упадёт)
2. Через админку создать шаблон `test-approval` (Document System, бесплатно)
3. Через редактор ([05](05-editor-frontend.md)) собрать граф: Start → UserTask (approve/reject,
   `fixed-assignee`) → Gateway (`payload.amount > 1000` → UserTask (доп. согласование) | default →
   End) → опубликовать
4. `POST /api/workflows/test-approval/start` с `payload.amount = 5000`
5. Выполнить `approve` от имени назначенного пользователя → убедиться, что Gateway автоматически
   увёл процесс на второй UserTask (условие `> 1000` выполнилось)
6. Выполнить второе действие → процесс завершён (`end`), `completed_at` проставлен
7. Открыть страницу процесса ([06](06-process-view-frontend.md)) → таймлайн показывает 3 записи:
   explicit approve, автоматический хоп через Gateway (тот же `actor_id`), explicit финальное
   действие
8. Опубликовать новую версию шаблона (v2) с изменённым графом → убедиться, что уже завершённый
   instance из шага 6 остался привязан к v1 (замена конфига по частично пройденному процессу
   невозможна физически — `workflow_version_id` не меняется)

## Проверка инвариантов

- `grep` по `packages/module-workflow/**` не находит ни одного импорта из `packages/module-hr/**`
  (обратное — можно и есть, см. выше)
- `pnpm -w typecheck` и `pnpm exec biome check` по всем пакетам разбивки — чисто
- `packages/module-workflow` по-прежнему не импортирует ничего из `packages/module-admin/**`,
  кроме единственного разрешённого случая — `registerComponent`, если он использовался (см.
  [04](04-admin-api-and-documents.md), «Открытый хвост»)

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/module-hr/src/backend/workflow-delegates.ts` | Создать | `fixedAssigneeProvider` |
| `packages/module-hr/src/backend/setup.ts` | Изменить | `resolve('workflow-registry')` + регистрация делегата |
| `packages/module-hr/package.json` | Изменить | `@amplicada/module-workflow` как peer/dev-зависимость |
| `apps/api/src/index.ts` (или `apps/demo`) | Изменить | Подключить `moduleWorkflow` перед `moduleHr` |

## Порядок реализации

- [x] `fixedAssigneeProvider` + регистрация в `module-hr/backend/setup.ts` (id `fixed-assignee`,
      label «Фиксированный исполнитель»); в `hrModule` добавлено `dependencies: ['workflow']`
      (декларативно, ADR-02)
- [x] Обновить `package.json` `module-hr` (peer+dev зависимость на `module-workflow`)
- [x] Подключить оба модуля в `apps/api` в правильном порядке (сделано ещё в фазе 03:
      `workflowModule` до `hrModule`)
- [ ] Пройти сценарий 1–8 руками — **не прогнано**: требует запущенного окружения, ручная проверка
      за пользователем
- [x] Прогнать проверку инвариантов: grep — ни одного импорта `module-hr`/`module-admin` из
      `module-workflow`; `turbo build typecheck` + `biome check` чисто
- [ ] Обновить `ref/README.md`/`ref/context.md` — после живого прогона сценария (не раньше:
      до него план не считается `implemented`)

Статус: код фазы написан 2026-07-16. Сквозной сценарий (раздел выше) — единственное, что осталось
до закрытия всего плана.

## Проверка

Полностью описана в разделе «Сквозной сценарий» и «Проверка инвариантов» выше — отдельного раздела
не дублирую.
