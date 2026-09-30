---
title: file-viewer — справочник
type: reference
updated: 2026-09-30
verified_commit: 61bed2d7
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
same-origin автоматически; `readText` и `readBytes` ходят с `credentials: 'include'`).
`file`/`blob` живут в object URL, который создаёт и отзывает `useResolvedSource`.

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
| `textPreviewLimitBytes` | `number` | Размер окна просмотра текста, по умолчанию 512 КБ; остальное — по кнопке «Показать ещё» |
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

### Оконное чтение текста

В режиме просмотра текст читается окнами по `textPreviewLimitBytes` (по умолчанию 512 КБ).
Если после окна остались байты (`truncated`), над редактором появляется кнопка `loadMore`
(«Показать ещё»): следующее окно запрашивается с `offsetBytes = nextOffsetBytes` и
**дописывается** к уже прочитанному — позиция и выделение не теряются. Ошибка догрузки не
выбрасывает буфер: рядом с кнопкой показывается `failed`, кнопка остаётся для повтора.

- Для `url`-источника окно — `Range: bytes=<offset>-<offset+limit-1>`. Ответ на оконный
  запрос (`offset > 0`) обязан быть `206 Partial Content`: полный `200` считается ошибкой
  (иначе догрузка вклеила бы файл целиком).
- Для `file`/`blob` — `slice` по тем же границам.
- Хвост окна, разрезавший многобайтный символ, отбрасывается: `nextOffsetBytes` указывает на
  его начало, и следующее окно дочитывает символ целиком — без пропусков, дублей и `U+FFFD`
  на стыке. Исключение — последнее окно: незавершённый хвост (возможен только у битого
  файла) декодируется как есть.
- В режиме правки окно одно (5 МБ), догрузки нет; файл больше лимита открывается read-only
  с предупреждением.

`readText` входит в `RendererProps` и доступен любому рендереру: свои рендереры могут читать
текст теми же окнами.

## Рендереры по умолчанию

| id | Форматы | Поведение |
|---|---|---|
| `image` | png/jpg/gif/webp/avif/bmp/ico/svg | `<img>` + зум/панорамирование |
| `video` | mp4/webm/mov/mkv/ogv | `<video controls>` |
| `audio` | mp3/wav/ogg/flac/m4a/aac | `<audio controls>` |
| `pdf` | pdf | `<iframe>` (вьюер браузера) |
| `text` | txt/json/csv/log/md/yml/xml/html/css/js/… | Monaco (view/edit) |
| `word` | docx/docm | Canvas-рендер `DocxScrollViewer`, read-only |
| `spreadsheet` | xlsx/xlsm | Canvas-сетка `XlsxViewer`, вкладки листов, read-only |
| `external` | всё остальное | карточка + «открыть в новой вкладке» |

Определение типа: `mime` главнее расширения; при отсутствии `mime` (листинг S3) — расширение.
`html`/`js` показываются текстом, а не исполняются.

Тип можно вычислить отдельно: `fileKindOf({ name, mime })` →
`'image' | 'video' | 'audio' | 'pdf' | 'text' | 'word' | 'spreadsheet' | 'other'`.

### Office (`@silurus/ooxml`)

Рендереры `word`/`spreadsheet` построены на `@silurus/ooxml` — Rust/WASM-парсер OOXML и
Canvas-отрисовка (без инъекции DOM, read-only). Зависимость — точный пин `0.88.0` (лицензия
MIT, ноль собственных зависимостей, пакет pre-1.0). WASM и код вьюеров (~1.3 МБ gzip docx /
~1.0 МБ xlsx) грузятся только при первом открытии файла отдельными чанками и в основной бандл
не попадают. Если динамический импорт, чтение байтов или загрузка падают — рендерер отдаёт
external-карточку (исключение: невалидный xlsx `XlsxViewer` рисует своей error-surface).
Поддержан только OOXML: `.doc`/`.xls`, PPTX и прочее уходят в `external`. Файл крупнее
50 МиБ не разбирается вовсе: рендерер по метаданным (`descriptor.size > 50 МиБ`) отдаёт
external-карточку, не импортируя WASM и не читая байты. Потолок применяется, только когда
размер известен; у `url`-источника без `size` ограничения нет.

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

`RendererProps`: `descriptor`, `url` (`string | null`), `readText({ limitBytes?, offsetBytes? })`
→ `TextReadResult` (`{ text, truncated, nextOffsetBytes? }`; окно байт с безопасной границей
UTF-8), `readBytes()` (`Promise<ArrayBuffer>` — файл целиком, для Office/архивов),
`openExternal()`, `edit?`.

## Подписи

Дефолты английские. Потребитель передаёт `labels` из своей i18n; в шаблонах поддерживается
`{{key}}` (использует `textTruncated` с `{{size}}`). `loadMore` — подпись кнопки догрузки
окна текста, `failed` показывается и при ошибке догрузки.

## Ограничения

- Требуется Vite: воркеры Monaco подключаются через `?worker`; с другим бандлером текстовый
  редактор упадёт в `<textarea>`.
- Текст читается окнами: просмотр — порциями по 512 КБ с ручной догрузкой («Показать ещё»),
  правка — одно окно 5 МБ; обрезанный в режиме правки файл открывается только для чтения.
- Догрузка текста ручная, автоматического потока/бесконечного скролла в просмотре нет.
- Office: только OOXML (docx/docm/xlsx/xlsm), read-only; `.doc`/`.xls`, PPTX и прочее —
  external-карточка. Файл крупнее 50 МиБ — тоже external-карточка, без разбора. Первое
  открытие Office подтягивает крупный WASM-чанк.
