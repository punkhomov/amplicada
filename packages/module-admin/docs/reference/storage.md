---
title: Admin — файловый менеджер хранилища
type: reference
updated: 2026-09-29
verified_commit: 74e82866
---

# Admin — файловый менеджер хранилища

Страница `/admin/storage` показывает содержимое S3-совместимого хранилища как файловый
менеджер: папки-префиксы, хлебные крошки, поиск по текущей папке, загрузка в папку,
предпросмотр и удаление. Директорий в S3 нет — «папка» здесь это общий префикс ключей до
следующего `/` (`CommonPrefixes`), см. `listObjects` в
[platform-core storage](../../../platform-core/docs/reference/storage.md).

Доступ — только аутентифицированная сессия (тот же `preHandler`, что у остальных
admin-роутов). Отдельных прав на объекты нет.

## HTTP API

Все роуты — под `/api/admin`.

| Метод и путь | Что делает |
|---|---|
| `GET /storage/objects?prefix=` | Листинг одной «папки»: `{ prefix, prefixes, objects }` |
| `POST /storage/objects?prefix=` | Загрузка файла (multipart-часть `file`) в папку; тело — потоком |
| `PUT /storage/objects?key=` | Сохранение текста в существующий объект; JSON `{ content }` |
| `DELETE /storage/objects?key=` | Удаление объекта |
| `DELETE /storage/folder?prefix=` | Рекурсивное удаление папки; ответ `{ deleted }` — число объектов |
| `GET /storage/objects/download?key=` | Скачивание (`Content-Disposition: attachment`), `Range` → `206` |
| `GET /storage/objects/view?key=` | Просмотр в браузере (`inline`), `Range` → `206` |

Ключ объекта — query-параметр `key`, не сегмент пути: `:key` в Fastify не матчит слэши,
то есть на ключах вида `learning/pkg/index.html` роут отвечал бы 404. `prefix` нормализуется
к виду с `/` на конце (`foo` → `foo/`), иначе листинг захватил бы `foobar.txt`.

`prefix` без значения — корень бакета. `DELETE /storage/folder` без `prefix` отвечает
`400`: пустой префикс означал бы удаление всего бакета.

`PUT /storage/objects` принимает JSON `{ content: string }` (лимит тела — 8 МБ) и сохраняет
текст в уже существующий объект: ключ — в `key`, существование проверяется `HEAD` (иначе `404`,
новый объект не создаётся), прежний `Content-Type` сохраняется. Ошибки: `400` — нет ключа или
не строковый `content`, `404` — объекта нет.

### Типы ответов

`GET /storage/objects`:

```json
{
  "prefix": "learning/",
  "prefixes": ["learning/pkg-a/", "learning/pkg-b/"],
  "objects": [
    { "key": "learning/index.json", "size": 1234, "etag": "\"...\"", "lastModified": "2026-09-18T10:00:00.000Z" }
  ]
}
```

Объекты-маркеры папок (ключи с `/` на конце) в `objects` не попадают — они видны как папки
в `prefixes` и удаляются вместе с папкой.

`GET /storage/objects/download` и `/view` отдают `Content-Disposition`, `Accept-Ranges:
bytes`, `X-Content-Type-Options: nosniff`; при наличии `Range` — `206` с `Content-Range`.
Для активных типов (`image/svg+xml`, `text/html`, XML) просмотр дополнительно получает
`Content-Security-Policy: sandbox`, чтобы чужой документ не исполнился на нашем origin.

## Предпросмотр

Диалог превью — общая библиотека [`@amplicada/file-viewer`](../../../file-viewer/docs/reference/file-viewer.md):
админка отдаёт ей источник `{ type: 'url', url: view-роут }` и кнопку скачивания, а выбор
рендерера (картинка, видео, аудио, PDF, текст в Monaco, Office docx/xlsx, «открыть в
браузере») — на стороне библиотеки. Тип определяется по расширению ключа: `ListObjectsV2`
`Content-Type` не отдаёт, а HEAD на каждую строку списка — это запрос на файл. Кнопка превью
есть только у типов, которые библиотека умеет показать. Текстовые файлы открываются в режиме
правки (`mode="edit"`): сохранение идёт через `PUT /storage/objects`, список после этого
обновляется.

## Ограничения

- Папка отдаётся целиком, пагинации нет.
- Поиск фильтрует только текущую папку на клиенте.
- Файл без расширения превью не получает, даже если это картинка.
- Загрузка — до лимита multipart платформы (100 МБ).
- Правка — только текст и только существующий объект: `PUT` не создаёт новые ключи, а файлы
  крупнее 5 МБ открываются в режиме правки read-only (потолок редактора библиотеки).
