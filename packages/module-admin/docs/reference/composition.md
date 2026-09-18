---
title: Admin — интеграция действий
type: reference
updated: 2026-09-17
verified_commit: 5767b800
---

# Admin — интеграция действий

Frontend setup регистрирует сервисы `admin:toolbar` и `admin:apps`
(`src/frontend/index.tsx:31-32`).

## Действия документа (`admin:toolbar`)
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

## Приложения (`admin:apps`)

Режим «Приложения» — вкладка `apps` в шапке админки (`src/frontend/layouts/admin-layout.tsx:22`).
Каталог открывается на `/admin/apps`, конкретное приложение — на `/admin/apps/:appId`
(`src/frontend/index.tsx:73-74`); хост рендерит компонент приложения под шапкой
с кнопкой «назад» и названием приложения (без хлебных крошек — их, если нужно, рисует
само приложение).

| Метод | Поведение |
|---|---|
| `register(app)` | Добавляет приложение; тот же id заменяет предыдущее |
| `getAll()` | Возвращает приложения, сортируя по order (по умолчанию 0) |
| `getById(id)` | Приложение по id или `undefined` |

`AdminApp` (`src/contracts/apps.ts:3`): `id` и `component` обязательны; `titleKey` и
`descriptionKey` — i18n-ключи вида `support-chat:app_title` (локали модуля неймспейсятся
его id), `icon` — компонент иконки, `iconClass` — tailwind-классы подложки иконки
в каталоге (`bg-sky-500/10 text-sky-600`), `order` — порядок в каталоге.

Заголовок открытого приложения подставляется в шапку админки, а не рисуется отдельной
полосой: страница вызывает `useAdminHeader(render, deps)`
(`src/frontend/lib/admin-header.ts`), и пока она смонтирована, layout показывает её
заголовок слева вместо «Администрирование» и вкладок.

```ts
import type { AdminAppsService } from '@amplicada/module-admin/frontend';

// Внутри setup(context), при объявленном peer @amplicada/module-admin:
const apps = context.services.resolve<AdminAppsService>('admin:apps');
apps.register({
  id: 'my-app',
  titleKey: 'my-module:app_title',
  descriptionKey: 'my-module:app_description',
  icon: WrenchIcon,
  order: 20,
  component: MyAppPage,
});
```

Типы экспортируются из `@amplicada/module-admin/contracts` и `@amplicada/module-admin/frontend`.
Первое приложение — `module-support-chat` (`/admin/apps/support-chat`).
