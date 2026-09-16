---
title: Подключить необязательный сервис другого модуля
type: how-to
updated: 2026-09-16
verified_commit: a5c2ac9
---

# Подключить необязательный сервис другого модуля

Задача: модуль работает самостоятельно, но при подключённой админке добавляет действие
в её интерфейс. Ниже используется существующий admin:toolbar; аналогично подключаются
другие сервисы, зарегистрированные поставщиком во время setup.

## 1. Объявите optional peer

Фрагмент package.json модуля-потребителя внутри монорепозитория:

```json
{
  "amplicada": true,
  "peerDependencies": {
    "@amplicada/module-admin": "workspace:*"
  },
  "peerDependenciesMeta": {
    "@amplicada/module-admin": { "optional": true }
  },
  "devDependencies": {
    "@amplicada/module-admin": "workspace:*"
  }
}
```

DevDependency нужна для компиляции вашего пакета. Optional peer описывает необязательную
интеграцию. Обычная peerDependency без optional означает обязательный модуль для
композиции. Не добавляйте admin в dependencies потребителя, если он должен отсутствовать:
такая запись делает связь обязательной для генератора (`src/application.ts:89`).
Для отдельно разрабатываемого npm-пакета укажите совместимые опубликованные версии
вместо workspace-ссылок. При публикации пакеты должны содержать собранный dist.

Проверьте, что пакет предоставляет ./frontend, а его barrel экспортирует объект
регистрации как module. CSS при необходимости экспортируется как ./frontend/tailwind.css;
второй список экспортов в amplicada не нужен (`src/application.ts:72`).

## 2. Получите сервис через контекст

Пример frontend setup потребителя:

```tsx
import type { AdminToolbarService, ToolbarActionProps } from '@amplicada/module-admin/contracts';
import type { FrontendModule } from '@amplicada/platform-core/contracts/frontend';
import { moduleManifest } from '../contracts/manifest.js';

function ExampleAction({ isNew }: ToolbarActionProps) {
  return <span>{isNew ? 'Новый документ' : 'Существующий документ'}</span>;
}

export const module: FrontendModule = {
  ...moduleManifest,
  setup(context) {
    if (context.modules.getById('admin')) {
      const toolbar = context.services.resolve<AdminToolbarService>('admin:toolbar');
      toolbar.register({
        id: 'example-action',
        label: 'Пример действия',
        documentType: 'user',
        component: ExampleAction,
      });
    }
  },
};
```

В этом примере компонент только показывает состояние; замените его собственной
интеракцией. ModuleManifest содержит стабильные id/name и version вашего модуля.
Сам module и есть экспорт точки входа либо re-export из ./frontend/index.ts.
Форма register определена в `packages/module-admin/src/contracts/toolbar.ts:19`;
реальная интеграция auth — `packages/module-auth-password/src/frontend/setup.tsx:19`.

Не импортируйте реализацию admin, в том числе функцию регистрации или runtime-константу
из его frontend barrel. Верхнеуровневый импорт требует пакет до выполнения if.
Строка admin:toolbar — публичный токен сервиса; тип интерфейса импортируется отдельно.
Не ловите исключение resolve для выбранного admin: отсутствие обещанного сервиса — ошибка.

## 3. Сохраните независимость публичных типов

Import type отсутствует в результирующем JavaScript. Однако если ExampleAction
экспортируется наружу, его .d.ts может импортировать ToolbarActionProps из admin.
Тогда приложение без admin способно столкнуться с отсутствующим типом.

Оставьте интеграционный компонент внутренним. Публично экспортируйте module с явной
аннотацией FrontendModule и только те компоненты/типы, которые не требуют optional peer.
Если такая зависимость нужна именно в публичном API, потребуется отдельное решение
о доступности контрактов; optional-флаг сам по себе эту проблему не решает.

В auth публичный frontend barrel содержит module и LoginPage, а ChangePasswordAction
используется только внутри setup (`packages/module-auth-password/src/frontend/index.ts:1`).
Не используйте skipLibCheck как способ скрыть утечку optional-типов.

## 4. Проверьте оба состава приложения

Перед любой установкой, включая временный проект, создайте pnpm-workspace.yaml:

```yaml
ignoreScripts: true
blockExoticSubdeps: true
minimumReleaseAge: 43200
```

В подготовленном приложении с подключённым CLI сначала оставьте в dependencies только
core, свой модуль и обычные необходимые библиотеки. Выполните:

```bash
pnpm install
pnpm build
pnpm exec tsc --listFilesOnly
```

Проверьте, что admin отсутствует в generated imports/CSS и в публичном графе типов,
а основная функциональность модуля и его setup работают. Проверяйте вне монорепозитория:
workspace devDependencies могут скрыть отсутствие optional peer у потребителя.

Затем явно добавьте admin в dependencies приложения, повторите установку и сборку.
Теперь admin должен предшествовать потребителю в generated-массиве, а действие появиться
в admin:toolbar после setup. Проверьте удаление admin обратно: следующая генерация
должна убрать его импорт и связь порядка, сохранив ваш модуль (`src/application.ts:123`, `:148`).

| Симптом | Что проверить |
|---|---|
| Сборка без admin ищет его реализацию | Нет ли обычного import/re-export в потребителе |
| Typecheck без admin ищет его типы | Не ссылаются ли публичные .d.ts на optional peer |
| getById видит admin, но resolve падает | Объявлена ли связь, предоставлена ли нужная сторона, создаётся ли сервис в setup |
| CLI сообщает о цикле | Нет ли взаимных зависимостей выбранных модулей; optional не отменяет цикл |
| Admin установлен, но не активен | Есть ли прямая dependency приложения и включён ли admin в --config |

Проверка присутствия не заменяет порядок и не является API статусов.
Подробнее — [состав, граф и жизненный цикл](../explanation/composition-model.md),
[справочник CLI](../reference/composition.md).
Сверено с рабочим деревом поверх a5c2ac9.
