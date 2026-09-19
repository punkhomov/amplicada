---
title: file-viewer — справочник
type: reference
updated: 2026-09-19
verified_commit: 56aa450c
order: 10
---

# file-viewer — справочник

Пакет `@amplicada/file-viewer`. Точки входа: `./frontend` (компоненты) и `./contracts` (типы).
Стили — `./frontend/tailwind.css`; приложение обязано импортировать его один раз
(см. «Подключение»).

## Установка в приложение

Пакет — **peerDependency** модулей (как `platform-core`), потому что его состояние
(реестр, контекст подписей) должно быть единым. В приложении — обычная зависимость:

```json
// app package.json
"dependencies": { "@amplicada/file-viewer": "workspace:*" }
```

```css
/* app index.css — Tailwind v4 не сканирует node_modules сам */
@import "@amplicada/file-viewer/frontend/tailwind.css";
```

```json
// модуль-потребитель
"peerDependencies": { "@amplicada/file-viewer": "workspace:*" },
"devDependencies": { "@amplicada/file-viewer": "workspace:*" }
```

## Источник

```ts
type FileSource =
  | { type: 'url'; url: string; name?: string; mime?: string; size?: number }
  | { type: 'file'; file: File }
  | { type: 'blob'; blob: Blob; name: string; mime?: string; size?: number };
```

`url` — готовый адрес; авторизация на стороне потребителя (сессионная кука уходит на
same-origin автоматически, `readText` идёт с `credentials: 'include'`). `file`/`blob` живут
в object URL, который создаёт и отзывает `useResolvedSource`.

`FileDescriptor` (`{ name, mime?, size? }`) — минимум для выбора рендерера и шапки; из
`FileSource` выводится автоматически.

## Компоненты

### `<FilePreview>`

| Проп | Тип | Назначение |
|---|---|---|
| `source` | `FileSource \| null` | Файл; `null` — не рендерит ничего |
| `mode` | `'view' \| 'edit'` | `edit` включает правку текста (нужен `onSave`) |
| `onSave` | `(content: string) => void \| Promise<void>` | Сохранение текста |
| `labels` | `Partial<FileViewerLabels>` | Переводы chrome'а либы |
| `renderers` | `RendererPlugin[]` | Замена/расширение реестра |
| `textPreviewLimitBytes` | `number` | Потолок просмотра текста, по умолчанию 512 КБ |
| `className` | `string` | Класс контейнера (задаёт размеры) |

Рендерер выбирается по `match` с учётом `priority` (больше — раньше). Тяжёлые рендереры
обёрнуты в `Suspense` и грузятся по требованию.

### `<FilePreviewDialog>`

Наследует пропсы `FilePreview` плюс:

| Проп | Тип | Назначение |
|---|---|---|
| `open` / `onOpenChange` | `boolean` / `(open) => void` | Управление диалогом |
| `title` | `string` | Заголовок; по умолчанию — имя источника |
| `description` | `ReactNode` | Подпись под заголовком; по умолчанию — размер |
| `actions` | `ReactNode` | Доп. кнопки в подвале (например, «Скачать» своего роута) |

В подвале всегда есть «открыть в новой вкладке». Высота области предпросмотра — `70vh`
(задана явно, иначе `h-full` у рендерера схлопывается).

### `<TextEditor>`

| Проп | Тип | Назначение |
|---|---|---|
| `value` | `string` | Содержимое |
| `language` | `string` | Язык Monaco; по умолчанию `plaintext` |
| `readOnly` | `boolean` | Просмотр вместо правки |
| `onChange` | `(value) => void` | Изменение |
| `onSave` | `(value) => void` | Ctrl/Cmd+S и вызов извне |
| `className` | `string` | Класс контейнера |

Monaco грузится динамически при первом монтировании. Если не поднялся — `<textarea>` с тем же
контрактом (правка не пропадает). Тема следует классу `dark` на `<html>`.

## Рендереры по умолчанию

| id | Форматы | Поведение |
|---|---|---|
| `image` | png/jpg/gif/webp/avif/bmp/ico/svg | `<img>` + зум/панорамирование |
| `video` | mp4/webm/mov/mkv/ogv | `<video controls>` |
| `audio` | mp3/wav/ogg/flac/m4a/aac | `<audio controls>` |
| `pdf` | pdf | `<iframe>` (вьюер браузера) |
| `text` | txt/json/csv/log/md/yml/xml/html/css/js/… | Monaco (view/edit) |
| `external` | всё остальное | карточка + «открыть в новой вкладке» |

Определение типа: `mime` главнее расширения; при отсутствии `mime` (листинг S3) — расширение.
`html`/`js` показываются текстом, а не исполняются.

Тип можно вычислить отдельно: `fileKindOf({ name, mime })` → `'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other'`.

## Свой рендерер

```tsx
import type { RendererPlugin } from '@amplicada/file-viewer/frontend';

const officeRenderer: RendererPlugin = {
  id: 'office',
  match: d => /\.docx?$/i.test(d.name),
  component: OfficeRenderer,        // ComponentType<RendererProps>
  priority: 10,                     // выше дефолтных
};
```

`RendererProps`: `descriptor`, `url` (`string | null`), `readText({ limitBytes })`,
`openExternal()`, `edit?`.

## Подписи

Дефолты английские. Потребитель передаёт `labels` из своей i18n; в шаблонах поддерживается
`{{key}}` (использует `textTruncated` с `{{size}}`).

## Ограничения

- Требуется Vite: воркеры Monaco подключаются через `?worker`; с другим бандлером текстовый
  редактор упадёт в `<textarea>`.
- Текст читается с потолком (512 КБ просмотр / 5 МБ правка); обрезанный в режиме правки
  открывается только для чтения.
- Пагинации/потока в просмотре нет.
- Office не рендерится: `<img>`/`<iframe>`/«открыть в браузере».
