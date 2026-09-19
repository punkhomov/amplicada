---
title: platform-core — сервис storage (S3)
type: reference
updated: 2026-09-18
verified_commit: 56aa450c
---

# platform-core — сервис storage (S3)

Core-сервис `storage` — тонкая обёртка над S3-совместимым хранилищем (SeaweedFS в dev).
Доступ у потребителей — через service locator: `context.services.resolve<BackendStorageService>('storage')`.
Контракт — `src/contracts/backend/storage.ts`, реализация — `src/backend/services/storage-service.ts`.

Только backend. Токен сервиса — `storage`; фронтенду ключи и бакет недоступны, раздача —
через роуты потребителя.

## Интерфейс

| Метод | Поведение |
|---|---|
| `putObject(key, body, options?)` | Запись `Buffer \| Uint8Array \| string` целиком |
| `putObjectStream(key, body, options?)` | Запись `Readable`; с `contentLength` — одним `PUT`, без — multipart через `Upload` |
| `getObject(key)` | Чтение объекта в память (`Buffer`) |
| `getObjectStream(key, { range })` | Потоковое чтение; `range` — HTTP-заголовок `Range` как есть |
| `deleteObject(key)` | Удаление одного ключа |
| `deletePrefix(prefix)` | Рекурсивное удаление под префиксом пачками по 1000; возвращает число ключей |
| `headObject(key)` | `StorageObjectInfo` или `null`, если объекта нет |
| `listObjects(prefix?, { delimiter })` | Листинг: `{ objects, prefixes }`; с `delimiter` — один уровень |
| `getSignedUrl(key, expiresInSeconds?)` | Presigned URL (по умолчанию 3600 с) |

`StorageObjectInfo`: `key`, `size`, `contentType?`, `etag?`, `lastModified?` (`Date`).

## Листинг и «папки»

Директорий в S3 нет: ключи плоские. «Папка» — это общий префикс ключей до разделителя.
`listObjects(prefix, { delimiter: '/' })` возвращает два набора:

- `objects` — объекты текущего уровня (`StorageObjectInfo[]`),
- `prefixes` — полные префиксы вложенных «папок» с `/` на конце (`learning/pkg/`).

Без `delimiter` листинг рекурсивный и `prefixes` пуст. `ListObjectsV2` отдаёт максимум 1000
ключей за вызов — `listObjects` дочитывает все страницы по `ContinuationToken` сам.
Объекты-маркеры папок (ключ с `/` на конце) приходят в `objects` как есть; отсеивать их —
дело потребителя.

`deletePrefix` — это и есть удаление «папки»: удаляет все объекты под префиксом, а затем
`DeleteObject` на сам префикс. Второй вызов нужен для SeaweedFS: его filer держит пустую
директорию отдельной записью, которой нет среди объектов, — без неё «папка» осталась бы
висеть пустой в листинге. В настоящем S3 это no-op (`DeleteObject` на несуществующий ключ
возвращает 204) плюс добивает объект-маркер, если он был создан. Пустой префикс запрещён
(означал бы снос бакета целиком) — метод бросает исключение.

## Range и медиа

`getObjectStream` принимает значение заголовка `Range` (RFC 9110) и уходит с ним в S3 как
есть, включая суффиксную форму `bytes=-500`. В ответе:

- `body` — `Readable`,
- `contentLength` — длина именно этого ответа (у range-запроса — куска),
- `contentType`, `etag`, `lastModified`,
- `contentRange` — заголовок `Content-Range` от S3 (`bytes 0-1023/98765`); есть только у
  частичного ответа — по нему потребитель и решает отдавать `206`.

Несколько диапазонов в одном заголовке S3 не поддерживает: вернётся объект целиком.
Диапазон вне размера объекта → ошибка со `statusCode = 416` (канон Fastify: роут отдаёт
статус как есть).

## Ограничения

- Бакет один, задаётся при инициализации сервиса; `ensureBucket` создаёт его при старте.
- Нет `CopyObject`: переименование/перемещение в S3 — это copy + delete, в контракте его нет.
- `listObjects` не постраничный: отдаёт весь уровень целиком.
- `putObject` держит тело в памяти; для крупных файлов — `putObjectStream`.
