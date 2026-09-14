---
title: "04. Admin API и интеграция с Document System"
type: plan
tier: 2
status: implemented
date: 2026-07-16
---

# 04. Admin API и интеграция с Document System

Родительский план: [2026-07-16-workflow.md](2026-07-16-workflow.md)

**Блокируется:** [02](02-engine-and-versioning.md)
**Блокирует:** [05](05-editor-frontend.md), [06](06-process-view-frontend.md)
**Не блокирует и не блокируется:** [03](03-runtime-api.md)
**Пакет:** `module-workflow` (+ одна строка экспорта в `module-admin`, см. ниже)

## Что делаем

Регистрируем `workflows` и `process_instances` как Document-типы (переиспользуем существующий
Document System вместо CRUD из раздела 5.1 исходного ТЗ) и добавляем только то, чего Document
System не покрывает: историю версий, публикацию графа, список делегатов для редактора.

## Почему бесплатного CRUD почти не остаётся

Как только `workflows` зарегистрирован как `DocumentType` с `creatable: true`, **создание/список/
редактирование базовых полей** (`code`, `name`, `description`, `isActive`) уже бесплатно доступны
через существующие generic-роуты `module-admin` (`GET/POST /api/admin/documents/workflow`,
`GET/PUT/DELETE .../workflow/:id`) — ничего писать не нужно. То же для `process_instances`
(только чтение, `creatable: false` — создаются исключительно через `POST /start`, фаза 03).

Бесплатным НЕ покрывается: история версий (`workflow_versions` — не Document, внутренняя деталь
редактора), сама публикация графа (это вызов движка, не update строки), список делегатов (не
Document вообще — см. критику, раунд 2). Только это и остаётся бespoke API этой фазы.

## Document-регистрация

По образцу `packages/platform-core/src/backend/document-definitions.ts`
(`registerCoreDocuments`) — здесь то же самое, но вызывается из `module-workflow`'s own
`setup(context)` через `context.documents`, а не из `platform-core`:

```typescript
// module-workflow/backend/documents.ts
export function registerWorkflowDocuments(docs: DocumentRegistry): void {
  docs.register(Documents.WORKFLOW, {
    label: 'Процессы (шаблоны)',
    schema: workflows,
    idColumn: 'id',
    creatable: true,   // code/name/description — обычная форма Document System
    deletable: false,  // никогда не удаляем — есть versions и process_instances
  });
  docs.register(Documents.WORKFLOW_PROCESS, {
    label: 'Заявки',
    schema: processInstances,
    idColumn: 'id',
    creatable: false,  // только через POST /api/workflows/:code/start
    deletable: false,
  });

  docs.objects.registerPage(WorkflowPages.WORKFLOW_CARD, { document: Documents.WORKFLOW, label: 'Основная информация' });
  docs.objects.registerPage(WorkflowPages.WORKFLOW_EDITOR, {
    document: Documents.WORKFLOW,
    label: 'Редактор графа',
    linkTemplate: '/admin/workflows/{id}/editor', // фаза 05
  });
  docs.objects.registerPage(WorkflowPages.PROCESS_CARD, { document: Documents.WORKFLOW_PROCESS, label: 'Основная информация' });
  docs.objects.registerPage(WorkflowPages.PROCESS_TIMELINE, {
    document: Documents.WORKFLOW_PROCESS,
    label: 'Таймлайн',
    linkTemplate: '/admin/workflows/processes/{id}', // фаза 06
  });

  docs.objects.registerGroup(WorkflowGroups.WORKFLOW_BASE, { document: Documents.WORKFLOW, page: WorkflowPages.WORKFLOW_CARD, label: 'Основное', order: 0 });
  docs.objects.registerGroup(WorkflowGroups.PROCESS_BASE, { document: Documents.WORKFLOW_PROCESS, page: WorkflowPages.PROCESS_CARD, label: 'Основное', order: 0 });

  docs.objects.extend(Documents.WORKFLOW, {
    module: 'workflow',
    group: WorkflowGroups.WORKFLOW_BASE,
    fields: {
      code: { label: 'Код', widget: 'text' },
      name: { label: 'Название', widget: 'text' },
      description: { label: 'Описание', widget: 'text' },
      isActive: { label: 'Активен', widget: 'checkbox' },
    },
    load: async (db, docId) => (await db.select().from(workflows).where(eq(workflows.id, docId)).limit(1))[0] ?? {},
    save: async (tx, id, data) => { await tx.update(workflows).set(data).where(eq(workflows.id, id)); },
  });

  // process_instances: только скалярные поля — payload/context (JSONB) не имеют подходящего
  // generic-widget'а (FieldMetadata.widget не включает 'json'), полноценно показываются на
  // кастомной таймлайн-странице (фаза 06), не здесь. Осознанное решение, не пробел.
  docs.objects.extend(Documents.WORKFLOW_PROCESS, {
    module: 'workflow',
    group: WorkflowGroups.PROCESS_BASE,
    fields: {
      workflowCode: { label: 'Процесс', widget: 'text', readonly: true },
      currentState: { label: 'Текущий этап', widget: 'text', readonly: true },
      createdAt: { label: 'Создана', widget: 'date', readonly: true },
      completedAt: { label: 'Завершена', widget: 'date', readonly: true },
    },
    load: async (db, docId) => (await db.select().from(processInstances).where(eq(processInstances.id, docId)).limit(1))[0] ?? {},
  });

  docs.lists.extend(Documents.WORKFLOW, {
    module: 'workflow',
    fields: {
      code: { label: 'Код', type: 'text', size: 160 },
      name: { label: 'Название', type: 'text', size: 240 },
      isActive: { label: 'Активен', type: 'checkbox', size: 90 },
    },
  });
  docs.lists.extend(Documents.WORKFLOW_PROCESS, {
    module: 'workflow',
    fields: {
      workflowCode: { label: 'Процесс', type: 'text', size: 180 },
      currentState: { label: 'Этап', type: 'text', size: 160 },
      createdAt: { label: 'Создана', type: 'datetime', size: 180 },
      completedAt: { label: 'Завершена', type: 'datetime', size: 180 },
    },
  });
}
```

Вызывается из `module-workflow/backend/setup.ts`: `registerWorkflowDocuments(context.documents)`.

## Bespoke admin-роуты (то немногое, что не покрывает Document System)

Тот же префикс и preHandler-аутентификация, что в [03](03-runtime-api.md) (без отдельной
admin-роли — в этой кодовой базе роуты `/api/admin/*` у `module-admin` тоже не проверяют роль,
только факт аутентификации; не вводим здесь то, чего нет в остальной системе).

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/workflows/admin/workflows/:id/versions` | Список версий (метаданные + `config`, чтобы редактор мог подгрузить граф) |
| `POST` | `/api/workflows/admin/workflows/:id/publish` | `publishVersion()` из [02](02-engine-and-versioning.md); 4xx с деталями при неудачной валидации |
| `GET` | `/api/workflows/admin/builder/meta` | `WorkflowRegistry.listMeta()` — делегаты для пикеров properties panel |

## Открытый хвост: `registerComponent` не экспортирован из `module-admin`

Обнаружено при проектировании: кастомные компоненты для групп Document (как `ScheduledTaskCard`)
регистрируются через `registerComponent()` (`module-admin/src/frontend/lib/component-registry.ts`),
но эта функция сейчас **только импортируется внутри `module-admin/src/frontend/index.tsx`**, не
реэкспортирована через `./frontend` — снаружи вызвать её нельзя. В этой фазе не нужна (базовые
карточки `workflows`/`process_instances` обходятся generic-полями, без кастомных компонентов), но
если в фазе 05/06 понадобится кастомная карточка — потребуется добавить одну строку экспорта в
`module-admin/src/frontend/index.tsx` (`export { registerComponent } from './lib/component-registry.js'`).
Не нарушает направление зависимости (`module-workflow` → `module-admin`, не наоборот) — фиксирую
здесь, чтобы не переоткрывать вопрос в фазе 05/06.

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/module-workflow/src/backend/documents.ts` | Создать | `registerWorkflowDocuments()` |
| `packages/module-workflow/src/contracts/documents.ts` | Создать | `Documents.WORKFLOW`/`WORKFLOW_PROCESS`, `WorkflowPages.*`, `WorkflowGroups.*` — id-константы |
| `packages/module-workflow/src/backend/routes/admin.ts` | Создать | `GET .../versions`, `POST .../publish`, `GET .../builder/meta` |
| `packages/module-workflow/src/backend/setup.ts` | Изменить | Вызов `registerWorkflowDocuments(context.documents)`, монтирование `routes/admin.ts` в тот же fastify-плагин, что и [03](03-runtime-api.md) |

## Порядок реализации

- [x] `contracts/documents.ts` — id-константы (`WorkflowDocuments`/`WorkflowPages`/`WorkflowGroups` —
      с префиксом Workflow*, чтобы не конфликтовать с core-константами `Documents` при co-import)
- [x] `backend/documents.ts` — `registerWorkflowDocuments()`
- [x] `backend/routes/admin.ts` — 3 роута
- [x] Подключить в `setup.ts`

Статус: реализовано 2026-07-16, вживую не прогнано. `registerComponent` из «открытого хвоста» не
понадобился — карточки обеих Document-типов обошлись generic-полями, как и предполагалось.

## Проверка

1. `GET /api/admin/documents/workflow` (стандартный роут `module-admin`) возвращает список
   зарегистрированных workflow-шаблонов — без единой строчки кода в этой фазе
2. `POST /api/admin/documents/workflow` создаёт новый шаблон (code/name/description) — та же
   бесплатность
3. `GET /api/workflows/admin/workflows/:id/versions` — пусто для только что созданного шаблона
   (версий ещё нет)
4. `POST .../publish` с невалидным графом (без start-ноды) → 4xx с деталями, версия не создана
5. `POST .../publish` с валидным графом → 201, `workflows.current_version_id` обновлён,
   `GET .../versions` показывает новую запись
6. `GET .../builder/meta` возвращает делегаты, зарегистрированные тестовым модулем в фазе 01/02
   (до появления `module-hr` в фазе 07 — годится любой тестовый `AssigneeProvider`)
