---
title: "file-viewer — обзор"
type: index
package: file-viewer
updated: 2026-09-29
verified_commit: 74e82866
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
| Реестр рендереров | `defaultRenderers` (image, video, audio, pdf, text, word, spreadsheet, external), `externalRenderer`; свой — проп `renderers` |
| Байты для рендерера | `RendererProps.readBytes(): Promise<ArrayBuffer>` (часть контракта рендерера) |
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

- Сверено с кодом: `2026-09-29`, коммит `74e82866` (ветка `feat/admin-storage-explorer`).
- Проверено живым прогоном через `module-admin` `/admin/storage` в Playwright (headless Chromium):
  предпросмотр текста в Monaco, **правка текста с сохранением** (`mode="edit"`), **Office
  docx/xlsx** (Canvas-рендер), картинки с зумом/панорамированием, скачивание, навигация.
- Production-сборка `apps/web` подтверждает ленивые чанки Monaco и Office (WASM вынесен
  отдельно, в основной бандл не попадает) и работу `?worker`.
- Фолбэк Office на external-карточку проверен битым `.docx`; битый `.xlsx` библиотека
  обрабатывает своей error-surface (см. `ref/notes/file-viewer.md`, D-005).
