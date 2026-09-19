---
title: Admin — файловый менеджер хранилища
type: reference
updated: 2026-09-18
verified_commit: 56aa450c
---

# Admin — файловый менеджер хранилища

Страница `/admin/storage` показывает содержимое S3-совместимого хранилища как файловый
менеджер: папки-префиксы, хлебные крошки, поиск по текущей папке, загрузка в папку,
предпросмотр и удаление. Директорий в S3 нет — «папка» здесь это общий префикс ключей до
следующего `/` (`CommonPrefixes`), см. `listObjects` в
[platform-core storage](../../platform-core/docs/reference/storage.md).

Доступ — только аутентифицированная сессия (тот же `preHandler`, что у остальных
admin-роутов). Отдельных прав на объекты нет.

## HTTP API

Все роуты — под `/api/admin`.

| Метод и путь | Что делает |
|---|---|
| `GET /storage/objects?prefix=` | Листинг одной «папки»: `{ prefix, prefixes, objects }` |
| `POST /storage/objects?prefix=` | Загрузка файла (multipart-часть `file`) в папку; тело — потоком |
| `DELETE /storage/objects?key=` | Удаление объекта |
| `DELETE /storage/folder?prefix=` | Рекурсивное удаление папки; ответ `{ deleted }` — число объектов |
| `GET /storage/objects/download?key=` | Скачивание (`Content-Disposition: attachment`), `Range` → `206` |
| `GET /storage/objects/view?key=` | Просмотр в браузере (`inline`), `Range` → `206` |

Ключ объекта — query-параметр `key`, не сегмент пути: `:key` в Fastify не матчит слэши,
то есть на ключах вида `learning/pkg/index.html` роут отвечал бы 404. `prefix` нормализуется
к виду с `/` на конце (`foo` → `foo/`), иначе листинг захватил бы `foobar.txt`.

`prefix` без значения — корень бакета. `DELETE /storage/folder` без `prefix` отвечает
`400`: пустой префикс означал бы удаление всего бакета.

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

Диалог превью открывается по клику на файл (или кнопке с глазом). Плеер выбирается по
расширению ключа, а не по `Content-Type`: `ListObjectsV2` тип не отдаёт, а HEAD на каждую
строку списка — это запрос на файл.

| Расширения | Превью |
|---|---|
| `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `ico`, `svg` | `<img>` |
| `mp4`, `webm`, `mov`, `mkv`, `ogv` | `<video controls>` (с перемоткой через `Range`) |
| `mp3`, `wav`, `ogg`, `flac`, `m4a`, `aac` | `<audio controls>` |
| `pdf` | `<iframe>` |
| `txt`, `json`, `csv`, `log`, `md`, `yml`, `yaml`, `xml`, `html`, `css`, `js` | текст, первые 256 КБ (запрос с `Range`) |
| остальное | карточка «предпросмотр недоступен» и кнопка скачивания |

HTML и JS показываются текстом, а не открываются: чужой документ не должен исполниться.
Для файлов без превью остаётся скачивание.

## Ограничения

- Папка отдаётся целиком, пагинации нет.
- Поиск фильтрует только текущую папку на клиенте.
- Файл без расширения превью не получает, даже если это картинка.
- Загрузка — до лимита multipart платформы (100 МБ).
