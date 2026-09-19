---
title: "file-viewer — обзор"
type: index
package: file-viewer
updated: 2026-09-19
verified_commit: 56aa450c
---

# file-viewer

> Потребительская документация. Рационал решений, отвергнутые альтернативы и известные
> пробелы — в `ref/notes/file-viewer.md`.

`@amplicada/file-viewer` — frontend-библиотека предпросмотра файлов и редактирования текста.
Не модуль: нет `setup`, нет `amplicada: true`, подключается обычной зависимостью (ADR-06).
Рендереры по типу файла, ленивые тяжёлые вьюеры, расширяемый реестр.

## Публичная поверхность

| Что | Как |
|---|---|
| Поверхность предпросмотра | `<FilePreview source={...} />` — [`@amplicada/file-viewer/frontend`] |
| Готовый диалог | `<FilePreviewDialog open onOpenChange source={...} />` |
| Редактор текста | `<TextEditor value language readOnly onChange onSave />` |
| Определение типа | `fileKindOf(descriptor)`, `fileExtension(name)`, `monacoLanguageOf(descriptor)` |
| Реестр рендереров | `defaultRenderers`, `externalRenderer`; свой — проп `renderers` |
| Источник | типы `FileSource`, `FileDescriptor` из `@amplicada/file-viewer/contracts` |
| Формат размера | `formatBytes(bytes)` |

## Карта документации

| Раздел | Файл |
|---|---|
| Первый контакт | — нет |
| Задачи | — нет |
| Справочник | [reference/file-viewer.md](./reference/file-viewer.md) |
| Концепции | — нет |

## Карта покрытия

| Подсистема | Где описана |
|---|---|
| Точки расширения (сервисы/токены) | — нет (библиотека, не модуль) |
| HTTP API | — нет (фронтенд) |
| Схема БД и миграции | — нет |
| Документы/списки/дашборд | — нет |
| Задачи и фоновые процессы | — нет |
| Frontend: API либы | [reference/file-viewer.md](./reference/file-viewer.md) |
| Конфиг (env, зависимости, порядок загрузки) | [reference/file-viewer.md](./reference/file-viewer.md) |
| Интеграции и потребители | [reference/file-viewer.md](./reference/file-viewer.md) |
| Ограничения для потребителя | [reference/file-viewer.md](./reference/file-viewer.md) |

## Freshness

- Сверено с кодом: `2026-09-19`, коммит `56aa450c` (рабочее дерево грязное, `feat/admin-storage-explorer`).
- Проверено живым прогоном через `module-admin` `/admin/storage` в Playwright (headless Chromium):
  предпросмотр текста в Monaco, картинки с зумом/панорамированием, скачивание, навигация.
- Production-сборка `apps/web` подтверждает ленивые чанки Monaco и работу `?worker`.
- Не проверено вживую: режим правки (`mode="edit"`) — ни один потребитель пока не подключён.
