---
title: Композиция модулей
type: reference
updated: 2026-09-15
verified_commit: 25eafbb
---

# Композиция модулей

## CLI

Команда `amplicada-modules` читает dependencies приложения и генерирует обе стороны
по умолчанию (`src/cli.ts:23`, `src/application.ts:222`).

| Параметр | Поведение |
|---|---|
| `--app directory` | Каталог приложения; по умолчанию cwd |
| `--target backend` или `--target frontend` | Генерировать одну сторону |
| `--check` | Проверить состав без записи файлов |
| `--config file` | Явный состав вместо discovery; путь относителен cwd |
| `--help` | Показать справку |

Параметры определены в `src/cli.ts:7`. Переменных окружения для выбора состава нет.
При ошибке код завершения — 1 (`src/cli.ts:37`). `--check` не проверяет наличие
объявленного JS-символа в dist: это проверяет компилятор приложения.

## Метаданные и файлы

Модуль задаёт `amplicada` в своём package.json: обязательные `id`, `name`, хотя бы одну
сторону `backend`/`frontend` с именем `export`; необязательные `requires`,
`dependencies` каждой стороны и `styles` (`src/application.ts:58`). Списки зависимостей
содержат id модулей. CSS допускается через экспорт `./frontend/tailwind.css`.

Генерируются `src/generated/backend-modules.ts`, `frontend-modules.ts` и `modules.css`.
Массив `modules` передаётся в соответствующий bootstrap, CSS импортируется приложением.
Дубликаты id, отсутствующие зависимости и циклы отклоняются. Графы требований состава
и порядка каждой стороны проверяются отдельно (`src/application.ts:152`).

Обычные библиотеки и devDependencies не активируются. Обязательный поставщик из
dependencies/peerDependencies модуля подключается, если импортируется из приложения;
иначе его нужно добавить в production dependencies приложения (`src/application.ts:222`).
Установка пакетов не входит в генерацию. Изменение состава требует повторной генерации,
сборки и перезапуска; удаления данных модуля не происходит.

## Программный API

Импорт из `@amplicada/application-tools` (`package.json`, `src/application.ts:7`):

| Экспорт | Назначение |
|---|---|
| `discoverApplication(directory, side?)` | План из dependencies, без записи (`src/application.ts:222`) |
| `planApplication(configPath)` | План из явного конфига (`src/application.ts:110`) |
| `writeApplicationPlan(plan, side?)` | Запись выбранных файлов; одинаковые не переписываются (`src/application.ts:203`) |
| `ApplicationPlan`, `GeneratedFile`, `Side` | Типы плана, файла и стороны (`src/application.ts:7`) |

Явный конфиг содержит `id`, `modules` (имена npm-пакетов), `targets` с каталогами
backend/frontend относительно конфига. В этом режиме нужные модули перечисляются
явно и должны быть в dependencies соответствующих targets (`src/application.ts:110`).
Обычный build приложения снова использует discovery, если его script не передаёт `--config`.

## Установка

Требуется Node 24+ (`package.json`). Перед установкой обязательны настройки проекта
в `pnpm-workspace.yaml`: `ignoreScripts: true`, `blockExoticSubdeps: true`,
`minimumReleaseAge: 43200`. Они применяются и к временным внешним проектам;
CLI не меняет политику установки. Инфраструктура и каркас приложения настраиваются отдельно.
