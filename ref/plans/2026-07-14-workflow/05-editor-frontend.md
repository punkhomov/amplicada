---
title: "05. Графический редактор (React Flow)"
type: plan
tier: 2
status: implemented
date: 2026-07-16
---

# 05. Графический редактор (React Flow)

Родительский план: [2026-07-16-workflow.md](2026-07-16-workflow.md)

**Блокируется:** [04](04-admin-api-and-documents.md)
**Блокирует:** ничего в этой разбивке
**Пакет:** `module-workflow`

## Что делаем

Страница `/admin/workflows/:id/editor` — единственный новый UI-паттерн во всей разбивке (в
кодовой базе нет прецедента графового редактора, `AdminTaskDetail` — это таблица+логи, не canvas).
Достигается кликом по `DocumentPage.linkTemplate`, зарегистрированному в [04](04-admin-api-and-documents.md),
из карточки Document `workflow` (Document System уже даёт список/создание шаблонов бесплатно —
здесь только сам редактор графа).

## Структура страницы

```
┌─────────────┬────────────────────────────────────┬──────────────────┐
│  Палитра     │              Canvas                │  Properties      │
│  (5 типов    │         (React Flow)                │  Panel           │
│  нод, drag)  │                                     │  (выбранный      │
│              │                                     │  узел/ребро)     │
└─────────────┴────────────────────────────────────┴──────────────────┘
                                                    [ Опубликовать v{N+1} ]
```

Палитра — 5 типов нод из [01](01-contracts-and-schema.md): Start, User Task, Gateway, Service
Task, End. Каждая — своя визуальная нода (`nodeTypes` React Flow, иконка + подпись + бейдж типа).

## Загрузка / публикация

```typescript
// Загрузка при открытии страницы
const { data: versions } = useQuery({
  queryKey: ['workflows', id, 'versions'],
  queryFn: () => api.get<WorkflowVersion[]>(`/workflows/admin/workflows/${id}/versions`),
});
const latest = versions?.at(-1);
const initialConfig: WorkflowVersionConfig = latest?.config ?? emptyStartEndTemplate(); // Start → End, если версий ещё нет

// Публикация
const publishMutation = useMutation({
  mutationFn: (config: WorkflowVersionConfig) => api.post(`/workflows/admin/workflows/${id}/publish`, { config }),
  onError: (err: ApiError) => setValidationErrors(err.body?.errors ?? [err.message]),
});
```

Никакого автосохранения черновика на бэкенд — состояние графа живёт только в React Flow store
(`useNodesState`/`useEdgesState`) до нажатия «Опубликовать» (решено в
критике, раунд 3: несохранённые правки
теряются при уходе со страницы — принятый компромисс v1).

Маппинг между React Flow internal state и `WorkflowVersionConfig` — чистые функции в обе стороны
(`configToFlow(config): { nodes, edges }` / `flowToConfig(nodes, edges): WorkflowVersionConfig`),
React Flow node `id`/`position`/`type` соответствуют напрямую полям `WorkflowNode`.

## Properties Panel — форма зависит от типа выбранного элемента

| Выбрано | Поля |
|---|---|
| `start` / `end` нода | Только `label` |
| `userTask` нода | `label`, `assigneeProviderId` (select из `GET .../builder/meta`), `assigneeProviderParams` (JSON-текстовое поле — делегату могут понадобиться произвольные параметры, не пытаемся угадать форму заранее), `validatorIds` (multi-select) |
| `gateway` нода | Без полей — вся конфигурация на исходящих рёбрах |
| `serviceTask` нода | `label`, `serviceTaskProviderId` (select), `serviceTaskProviderParams` (JSON-текст) |
| Ребро из `userTask` | `action` (текст — имя действия, `approve`/`reject` и т.п.), `label` (для читаемости на канвасе) |
| Ребро из `gateway` | Переключатель «Условие» / «По умолчанию» (`isDefault`). Если «Условие» — построитель: список строк `поле / оператор / значение`, объединённых через AND → сериализуется в JSONLogic (`conditionBuilderToJsonLogic()`) |
| Ребро из `start`/`serviceTask` | Без полей (ровно одно исходящее ребро, никакого выбора) |

Построитель условий в v1 — только плоский AND, без вложенных групп/OR (см. родительский план,
формат условий). `поле` — текстовый ввод пути (`payload.amount`), не автокомплит по схеме payload
(схемы payload в системе нет — она свободный JSONB).

## Регистрация страницы

```typescript
// module-workflow/frontend/setup.tsx
setup(context) {
  context.routes.register('/admin/workflows/:id/editor', <WorkflowEditorPage />, { layout: 'admin' });
}
```

`layout: 'admin'` — строковый ключ, резолвится `ModuleRoutes` в рантайме (см.
`ref/guides/module-system.md`, «Если layout не зарегистрирован — console.warn + fallback»).
`module-workflow` не импортирует ничего из `module-admin` для этого — просто рассчитывает, что
`module-admin` установлен в приложение и зарегистрировал layout `'admin'` (мягкая рантайм-связь
через соглашение об имени, не через код). Не нарушает инвариант из родительского плана.

## Зависимости

| Пакет | Зачем | Новый? |
|-------|-------|--------|
| `reactflow` | Canvas, drag-and-drop нод, рёбра, zoom/pan | Да |

## Изменения по файлам

| Файл | Действие | Описание |
|------|----------|----------|
| `packages/module-workflow/package.json` | Изменить | `reactflow` в зависимости |
| `packages/module-workflow/src/frontend/pages/workflow-editor-page.tsx` | Создать | Страница целиком: загрузка, canvas, публикация |
| `packages/module-workflow/src/frontend/components/node-palette.tsx` | Создать | Sidebar с 5 draggable типами нод |
| `packages/module-workflow/src/frontend/components/workflow-node-types.tsx` | Создать | 5 кастомных React Flow node-компонентов |
| `packages/module-workflow/src/frontend/components/properties-panel.tsx` | Создать | Формы по таблице выше, диспетчеризация по типу выбранного элемента |
| `packages/module-workflow/src/frontend/components/condition-builder.tsx` | Создать | Построитель условий (field/operator/value → JSONLogic) |
| `packages/module-workflow/src/frontend/lib/graph-mapping.ts` | Создать | `configToFlow()` / `flowToConfig()` |
| `packages/module-workflow/src/frontend/setup.tsx` | Изменить | Регистрация роута редактора |
| `packages/module-workflow/src/frontend/tailwind.css` | Создать | `@source "../"` по конвенции модулей |

## Порядок реализации

- [x] ~~`reactflow`~~ → **`@xyflow/react` 12.11.0**: `reactflow` v11 — прежнее имя пакета, v12
      живёт под `@xyflow/react` (актуальный, официальная поддержка React 19); версия согласована
      с пользователем по 30-дневной политике
- [x] `graph-mapping.ts` — маппинг в обе стороны; юнит-тест на симметричность **пропущен** (нет
      тестовой инфраструктуры в репо — см. статус фазы 02)
- [x] `node-palette.tsx` + drag-and-drop создания нод (biome-ignore на a11y drag-источника —
      клавиатурной альтернативы в v1 нет, TODO в коде)
- [x] `workflow-node-types.tsx` — визуальное отличие 5 типов (цветные рамки + иконки lucide)
- [x] `properties-panel.tsx` — формы нод; JSON-параметры делегатов через textarea с apply-on-blur
- [x] `condition-builder.tsx` — построитель условий; условие, собранное не билдером (вложенные
      or/группы), показывается read-only JSON — редактирование в v1 недоступно
- [x] Публикация: вызов API, ошибки валидации — инлайн-Alert поверх канваса
- [x] Регистрация роута в `setup.tsx`; модуль подключен в `apps/web` (main.tsx + index.css)

Статус: реализовано 2026-07-16, `vite build` проходит, вживую не прогнано. Отличие: стили канваса
(`@xyflow/react/dist/style.css`) импортируются в `apps/web/src/index.css`, а не в tsx модуля — tsc
модуля не умеет css-импорты. Каждому новому app-потребителю редактора понадобится та же строка.

## Проверка

1. Открыть редактор для нового шаблона (без версий) → видит Start → End по умолчанию
2. Добавить User Task между ними, выбрать assignee-делегата, соединить рёбрами с `action`
   `approve`/`reject`
3. Опубликовать без указания `action` на одном из рёбер userTask → инлайн-ошибка валидации, версия
   не создана
4. Добавить Gateway с двумя условиями и default-рёбром, опубликовать успешно → `current version`
   в списке версий увеличился
5. Перезагрузить страницу без публикации после правок → правки потеряны (ожидаемое поведение v1)
