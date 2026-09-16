---
title: Композиция модулей
type: reference
updated: 2026-09-16
verified_commit: a5c2ac9
---

# Композиция модулей

## CLI

Команда `amplicada-modules` читает dependencies приложения и генерирует обе стороны
по умолчанию (`src/cli.ts:23`, `src/application.ts:198`).

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

Модуль задаёт `amplicada: true`. Стороны определяются по `exports["./backend"]` и
`exports["./frontend"]`; каждая экспортирует объект регистрации как `module`.
Стили определяются по необязательному `./frontend/tailwind.css`. Старый объектный
формат amplicada отклоняется (`src/application.ts:73`). Id/name остаются в коде модуля.

Генерируются `src/generated/backend-modules.ts`, `frontend-modules.ts` и `modules.css`.
Массив `modules` передаётся в соответствующий bootstrap, CSS импортируется приложением.
Генератор добавляет dependencies по runtime id импортированных объектов, не изменяя
сами объекты (`src/application.ts:148`). Один граф пакетов сортируется и фильтруется
по доступной стороне. Порядок сохраняется и через промежуточную другую сторону.

Состав — только модули из прямых production dependencies приложения. Для каждого
проверяются dependencies и обязательные peerDependencies: зависимость-модуль должна
тоже входить в состав. Вложенная установка этого не заменяет. Optional peer добавляет
порядок, только если выбран приложением. При отсутствии в составе он игнорируется,
даже если физически установлен. Циклы, включая optional-связи выбранных модулей,
отклоняются до записи файлов (`src/application.ts:104`).

Обычные библиотеки, devDependencies и optionalDependencies не активируют модули.
Разные установки одного модуля в графе запрещены; совместимость semver проверяет
пакетный менеджер. Поиск не использует NODE_PATH (`src/application.ts:59`). Генератор
не исполняет модульный код; наличие экспорта module проверяет сборка, дубликаты runtime id — bootstrap.

Optional-сервис доступен в setup потребителя, если поставщик предоставляет эту сторону
и зарегистрировал сервис в своём setup. Проверка getById сообщает присутствие, а не
статус start. Типы импортируются через import type, без импортов реализации optional peer.

Установка пакетов не входит в генерацию. Изменение состава требует повторной генерации,
сборки и перезапуска; удаления данных модуля не происходит.

## Программный API

Импорт из `@amplicada/application-tools` (`package.json`, `src/application.ts:7`):

| Экспорт | Назначение |
|---|---|
| `discoverApplication(directory, side?)` | План из dependencies, без записи (`src/application.ts:198`) |
| `planApplication(configPath)` | План из явного конфига (`src/application.ts:215`) |
| `writeApplicationPlan(plan, side?)` | Запись выбранных файлов; одинаковые не переписываются (`src/application.ts:240`) |
| `ApplicationPlan`, `GeneratedFile`, `Side` | Типы плана, файла и стороны (`src/application.ts:7`) |

ApplicationPlan.order содержит имена npm-пакетов по сторонам; runtime id используются
в generated dependencies. ApplicationPlan.modules содержит packageName, version,
dependencies (имена пакетов) и признаки backend/frontend/styles (`src/application.ts:8`).

Явный конфиг содержит `id`, `modules` (имена npm-пакетов), `targets` с каталогами
backend/frontend относительно конфига. В этом режиме нужные модули перечисляются
явно и должны быть в dependencies соответствующих targets (`src/application.ts:215`).
Обычный build приложения снова использует discovery, если его script не передаёт `--config`.

## Установка

Требуется Node 24+ (`package.json`). Перед установкой обязательны настройки проекта
в `pnpm-workspace.yaml`: `ignoreScripts: true`, `blockExoticSubdeps: true`,
`minimumReleaseAge: 43200`. Они применяются и к временным внешним проектам;
CLI не меняет политику установки. Инфраструктура и каркас приложения настраиваются отдельно.

Устройство и границы: [модель композиции](../explanation/composition-model.md).
Практическая задача: [optional-интеграция](../how-to/optional-module-integration.md).
