---
title: Подключение модулей к приложению
type: guide
tier: 3
status: implemented
date: 2026-09-15
---

# Подключение модулей к приложению

По умолчанию состав приложения — модули в `dependencies` его package.json.
Отдельный список модулей, ручные imports и CSS-import для каждого модуля не нужны.
`@amplicada/application-tools` предоставляет команду `amplicada-modules`: она работает
в обычном проекте с установленными npm-пакетами, без Turbo и исходников платформы.
Требуется Node 24+. Пакеты в этой ветке подготовлены для упаковки; публикация в npm
этим изменением не выполняется. До публикации можно устанавливать архивы `pnpm pack`.

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
(например `public`), чтобы его сборка не очищала `dist` backend. Генератор композиции
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

Автор модуля добавляет метаданные в его package.json:

```json
{
  "amplicada": {
    "id": "example",
    "name": "Example",
    "requires": [],
    "backend": { "export": "exampleModule", "dependencies": ["workflow"] },
    "frontend": { "export": "exampleFrontendModule", "dependencies": [] },
    "styles": "./frontend/tailwind.css"
  }
}
```

Backend/frontend публикуются через `exports` с ключами `./backend`/`./frontend`.
Отсутствующую сторону можно не объявлять. `styles` необязателен и ссылается на
экспорт `./frontend/tailwind.css`. `requires` и списки dependencies по умолчанию пусты.
Runtime-манифесты получают id/name/version и зависимости из этого же package.json.

`requires` содержит id модулей, необходимых составу в целом. `backend.dependencies`
и `frontend.dependencies` задают id поставщиков той же стороны, чей setup нужен раньше.
Графы проверяются независимо. Все метаданные регистрируются до первого setup;
setup/start идут по зависимостям, shutdown — в обратном порядке. Core-миграции
выполняются первыми, затем миграции модулей в порядке регистрации во время setup.

В режиме discovery обязательный поставщик подключается автоматически, если его пакет
объявлен в dependencies/peerDependencies потребителя и установлен так, что импортируется
из приложения. При изолированной вложенной зависимости pnpm выдаётся просьба добавить
поставщика в dependencies приложения. Генератор не устанавливает пакеты и не делает
абсолютных импортов внутрь .pnpm. Простая библиотечная peerDependency не активирует
модуль без требования в метаданных. Совместимость версий проверяет пакетный менеджер.

Дубликаты id, циклы и отсутствующие зависимости прерывают генерацию до изменения файлов.
Bootstrap повторяет проверку графа для ручного подключения и защиты от расхождения
runtime-манифестов. Код модулей при чтении метаданных не исполняется.

## Границы текущего решения

Zero-config сейчас относится к составу модулей. Адреса PostgreSQL, Redis, S3 и секреты
остаются настройками окружения. Изменение состава требует сборки и перезапуска.
Удаление зависимости не удаляет данные, файлы или задачи модуля из БД.
Прямой импорт может включать библиотечный код неактивного модуля: например auth UI
использует registry из module-admin, но это не запускает admin setup и его маршруты.

Архитектурное решение: [ADR-05](../adr/05-application-composition.md).
