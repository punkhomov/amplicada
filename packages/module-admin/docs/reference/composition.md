---
title: Admin — интеграция действий
type: reference
updated: 2026-09-16
verified_commit: a5c2ac9
---

# Admin — интеграция действий

Frontend setup регистрирует сервис `admin:toolbar` (`src/frontend/index.tsx:28`).
Типы `AdminToolbarService`, `ToolbarAction`, `ToolbarActionProps` экспортируются из
`@amplicada/module-admin/contracts` (`src/contracts/toolbar.ts:3`).

| Метод | Поведение |
|---|---|
| `register(action)` | Добавляет действие; тот же id заменяет предыдущее |
| `getAll(documentType?)` | Возвращает действия по типу документа, сортируя по order (по умолчанию 0) |

Действие без documentType подходит ко всем типам. Без аргумента getAll возвращает
все действия. Свойства действия: id, label, component обязательны; order и documentType
необязательны. Component получает documentType, editData, updateField, isNew
(`src/contracts/toolbar.ts:3`, `src/frontend/lib/toolbar-action-registry.ts:3`).

Сервис создаётся отдельно для каждого frontend setup. Карточка документа получает
его из своего контекста (`src/frontend/pages/admin-document-card/ui/admin-document-card.tsx:257`).
Он используется auth для смены пароля и hr-poll для публикации опроса.
Старый экспорт registerToolbarAction удалён: используйте context.services.resolve.
Другие component/table-action реестры этим изменением не переводились на сервисы.

Потребитель объявляет admin обязательным либо optional peer. При optional peer:

```ts
import type { AdminToolbarService } from '@amplicada/module-admin/contracts';

// Внутри setup(context), при объявленном optional peer:
if (context.modules.getById('admin')) {
  const toolbar = context.services.resolve<AdminToolbarService>('admin:toolbar');
  toolbar.register({ id: 'example', label: 'Действие', component: ExampleAction });
}
```

Генератор гарантирует порядок setup выбранного peer. При ручной композиции задавайте
runtime dependencies самостоятельно. Сервис существует только на frontend.
