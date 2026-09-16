---
title: Подключение модулей к приложению
type: guide
tier: 3
status: implemented
date: 2026-09-16
---

# Подключение модулей к приложению

По умолчанию состав приложения — модули в `dependencies` его package.json.
Отдельный список модулей, ручные imports и CSS-import для каждого модуля не нужны.
`@amplicada/application-tools` предоставляет команду `amplicada-modules`: она работает
в обычном проекте с установленными npm-пакетами, без Turbo и исходников платформы.
Требуется Node 24+. Пакеты в этой ветке подготовлены для упаковки; публикация в npm
этим изменением не выполняется. До публикации можно устанавливать архивы `pnpm pack`.

Подробно о переходе «было → стало» и рассмотренных вариантах —
[заметки application-tools, D-004](../notes/application-tools.md).
Модель состава и lifecycle — [объяснение](../../packages/application-tools/docs/explanation/composition-model.md).
Пошаговая задача автора модуля — [optional-интеграция](../../packages/application-tools/docs/how-to/optional-module-integration.md).

## Обязательные настройки установки

До первого `pnpm install` создайте `pnpm-workspace.yaml` даже в одиночном проекте:

```yaml
ignoreScripts: true
blockExoticSubdeps: true
minimumReleaseAge: 43200
```

Это обязательная политика проекта, включая временные проверки вне монорепозитория.
Не отключайте её для прохождения установки или запуска install scripts зависимостей.
Если пакет блокируется, сначала выясните причину; исключения не добавляются автоматически.
Zero-config композиции не отменяет защиту установки. Перед проверками в другой
директории явно указывайте её путь.

## Один проект с backend и frontend

Один раз подключите генерацию к scripts приложения. Пример package.json после
публикации пакетов (версии здесь иллюстративные; используйте выпущенные версии):

```json
{
  "name": "my-portal",
  "type": "module",
  "scripts": {
    "generate": "amplicada-modules",
    "build": "pnpm generate && tsc && vite build",
    "start": "node dist/backend.js"
  },
  "dependencies": {
    "@amplicada/platform-core": "0.0.0",
    "@amplicada/module-auth-password": "0.0.0"
  },
  "devDependencies": {
    "@amplicada/application-tools": "0.0.0"
  }
}
```

Это фрагмент: TypeScript, React, Vite/Tailwind и их обычные настройки добавляются
в зависимости от устройства вашего приложения. Для Vite задайте отдельный outDir
(например `dist-web`), чтобы его сборка не очищала `dist` backend. Генератор композиции
не создаёт каркас приложения и пока не заменяет конфигурацию его инструментов.

Генерация создаёт три файла в одном проекте:

- `src/generated/backend-modules.ts` — статические backend-импорты и массив `modules`;
- `src/generated/frontend-modules.ts` — frontend-импорты и массив `modules`;
- `src/generated/modules.css` — CSS активных frontend-частей.

Backend подключает массив один раз:

```ts
import { createApp, bootstrap } from '@amplicada/platform-core/backend';
import { modules } from './generated/backend-modules.js';

const { app, context } = await createApp();
await bootstrap(app, modules, context);
await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
```

Frontend аналогично передаёт массив из `frontend-modules.js` в
`bootstrapFrontend(modules, context)`, затем создаёт router и рендерит
`FrontendProvider`. Собственные страницы и оформление остаются в коде приложения.
Единственное подключение стилей в `src/index.css`:

```css
@import "@amplicada/platform-core/frontend/styles/base.css";
@import "@amplicada/platform-core/frontend/tailwind.css";
@import "./generated/modules.css";
```

Теперь добавьте модуль в `dependencies`, выполните `pnpm install`, `pnpm build`,
`pnpm start`. Генератор сам включит его стороны и стили. При удалении зависимости
следующая сборка уберёт imports. `devDependencies` и обычные библиотеки без поля
`amplicada` не активируются. Наличие библиотеки другого модуля в node_modules также
само по себе не активирует его setup.

Генерацию запускайте и перед dev/typecheck. После изменения dependencies во время
работы dev перезапустите dev. Добавьте `/src/generated/` в .gitignore; одинаковые
файлы не переписываются, редактировать их вручную не нужно. `--check` только проверяет
состав; наличие объявленных JS-экспортов и типы окончательно проверяет сборка.

## Раздельные приложения API и web

Каждое приложение имеет собственный package.json. В scripts API используйте
`amplicada-modules --target backend`, web — `amplicada-modules --target frontend`.
Обе стороны одного модуля устанавливаются в dependencies соответствующих проектов.
В нашем репозитории это уже настроено: `pnpm build`, `pnpm dev`, `pnpm typecheck`
генерируют состав автоматически. `pnpm modules:generate` готовит файлы отдельно.
В свежем клоне сначала собираются workspace-зависимости CLI и core через Turbo.

Чтобы проверить состав одного приложения без записи:

```bash
pnpm --filter @amplicada/api generate --check
pnpm --filter @amplicada/web generate --check
```

## Явный состав для отдельной задачи

Обычная сборка читает `dependencies`; конфиг состава ей не нужен. Если отдельной
задаче всё же нужен ограниченный набор установленных модулей, CLI принимает явный
`--config`. Например, из каталога своего приложения:

```json
{
  "id": "subset",
  "modules": ["@amplicada/module-auth-password"],
  "targets": { "backend": ".", "frontend": "." }
}
```

```bash
pnpm exec amplicada-modules --config subset.json --check
```

Путь конфига относителен cwd, targets — его каталогу. Все необходимые модули
перечисляются и устанавливаются в production dependencies соответствующих targets.
Конфиг используется только при явном `--config`; поиска workspace и переключения
через переменную окружения нет. Для сборки такого состава отдельный script должен
вызвать CLI с `--config`, затем компилятор: обычный build заново обнаруживает dependencies.

Примеры full/minimal находятся в `packages/application-tools/test/fixtures/applications/`
и используются только тестом во временном проекте с фиктивными пакетами. Они не
описывают демоприложения и не участвуют в их сборке. Метаданные модулей и исходники CLI
учитываются обычным графом зависимостей Turbo; generated outputs восстанавливаются с dist.
Для собственной задачи с конфигом нужно включить этот конфиг в её inputs.

## Описание модуля и зависимостей

Автор модуля задаёт `"amplicada": true` в package.json. Стороны определяются по
exports `./backend` и `./frontend`, CSS — по `./frontend/tailwind.css`.
Каждая сторона экспортирует объект регистрации под именем `module`:

```ts
export { exampleModule as module } from './setup.js';
```

Стабильные id/name остаются в contracts/manifest.ts; version берётся из package.json.
Отдельных requires, списков зависимостей сторон и свойства styles больше нет.

| Поле package.json модуля | Поведение генератора |
|---|---|
| dependencies / обязательные peerDependencies | Если пакет — модуль, он должен входить в состав и запускается раньше |
| peerDependencies + peerDependenciesMeta.optional | Если модуль выбран, запускается раньше; если нет — пропускается |
| devDependencies / optionalDependencies | Не определяют состав и порядок |

Все обязательные модули устанавливаются явно в dependencies приложения. Например,
HR требует workflow: одного вложенного пакета в node_modules недостаточно.
В --config перечисляется полный состав, включая обязательные модули.
Обычные библиотеки без amplicada: true не активируются; их зависимости не обходятся.

### Опциональные сервисы

В auth админка объявлена optional peer:

```json
{
  "peerDependencies": { "@amplicada/module-admin": "workspace:*" },
  "peerDependenciesMeta": { "@amplicada/module-admin": { "optional": true } }
}
```

Интерфейс доступен при разработке через devDependency, реализация не импортируется:

```ts
import type { AdminToolbarService } from '@amplicada/module-admin/contracts';

// Внутри setup(context):
if (context.modules.getById('admin')) {
  const toolbar = context.services.resolve<AdminToolbarService>('admin:toolbar');
  toolbar.register({ id: 'my-action', label: 'Действие', component: MyAction });
}
```

При выбранном admin его setup завершится до auth setup. Поставщик должен предоставлять
нужную runtime-сторону и регистрировать сервис в setup, не start. Проверка getById сама
по себе сообщает только присутствие; гарантия порядка следует из peerDependencies.
Циклические optional-зависимости выбранных модулей отклоняются. Для взаимных вкладов
без вызова готового сервиса доступны extension points.

Import type стирается из JS. Ссылки на optional peer не должны попадать в публичный
граф .d.ts потребителя: иначе приложение снова потребует его типы. В auth компонент
ChangePasswordAction остаётся внутренним и не экспортируется из ./frontend.

Все метаданные регистрируются до первого setup; setup/start идут по зависимостям,
shutdown — в обратном порядке. Core-миграции выполняются первыми, затем миграции
модулей в порядке регистрации. Генератор ловит пропущенные модули и циклы до записи;
bootstrap повторно проверяет runtime id и граф. Код модулей при discovery не исполняется.

## Границы текущего решения

Zero-config относится к составу модулей. Адреса PostgreSQL, Redis, S3 и секреты
остаются настройками окружения. Изменение состава требует сборки и перезапуска.
Удаление зависимости не удаляет данные, файлы или задачи модуля из БД.
Без генератора ручной состав должен самостоятельно задавать runtime dependencies.

Архитектурные решения: [ADR-05](../adr/05-application-composition.md),
[ADR-06](../adr/06-module-conventions.md).
