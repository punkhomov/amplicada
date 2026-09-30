---
title: platform-core — сервис storage (S3)
type: reference
updated: 2026-09-30
verified_commit: 61bed2d7
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
| `copyObject(fromKey, toKey)` | Серверное копирование одного объекта (`CopyObject`); `CopySource` URL-кодируется целиком |
| `deleteObject(key)` | Удаление одного ключа |
| `deleteObjects(keys)` | Удаление списка ключей пачками по 1000; возвращает число ключей, пустой список — no-op |
| `deletePrefix(prefix)` | Рекурсивное удаление под префиксом пачками по 1000; возвращает число ключей |
| `headObject(key)` | `StorageObjectInfo` или `null`, если объекта нет |
| `listObjects(prefix?, { delimiter, maxKeys?, continuationToken? })` | Листинг: `{ objects, prefixes, nextToken? }`; с `delimiter` — один уровень; с `maxKeys` — одна страница, без — все |
| `getSignedUrl(key, expiresInSeconds?)` | Presigned URL (по умолчанию 3600 с) |

`StorageObjectInfo`: `key`, `size`, `contentType?`, `etag?`, `lastModified?` (`Date`).
`StorageListResult`: `objects`, `prefixes`, `nextToken?` (последний — только в постраничном
режиме, см. «Пагинация листинга»).

`copyObject` копирует ровно один объект и поддерево не обходит — «перемещение» в S3
собирается потребителем как copy + delete. `deleteObjects` режет список на пачки по 1000
(лимит `DeleteObjects`) и возвращает число ключей; `deletePrefix` переиспользует его —
батчинг и защита от пустого запроса живут в одном месте.

## Листинг и «папки»

Директорий в S3 нет: ключи плоские. «Папка» — это общий префикс ключей до разделителя.
`listObjects(prefix, { delimiter: '/' })` возвращает два набора:

- `objects` — объекты текущего уровня (`StorageObjectInfo[]`),
- `prefixes` — полные префиксы вложенных «папок» с `/` на конце (`learning/pkg/`).

Без `delimiter` листинг рекурсивный и `prefixes` пуст. Объекты-маркеры папок (ключ с `/` на
конце) приходят в `objects` как есть; отсеивать их — дело потребителя.

`deletePrefix` — это и есть удаление «папки»: удаляет все объекты под префиксом, а затем
`DeleteObject` на сам префикс. Второй вызов нужен для SeaweedFS: его filer держит пустую
директорию отдельной записью, которой нет среди объектов, — без неё «папка» осталась бы
висеть пустой в листинге. В настоящем S3 это no-op (`DeleteObject` на несуществующий ключ
возвращает 204) плюс добивает объект-маркер, если он был создан. Пустой префикс запрещён
(означал бы снос бакета целиком) — метод бросает исключение.

## Пагинация листинга

`ListObjectsV2` отдаёт максимум 1000 ключей за вызов, поэтому у `listObjects` два режима
(`src/backend/services/storage-service.ts:154`):

- **Без `maxKeys`** — прежнее поведение: сервис сам дочитывает все страницы по
  `ContinuationToken` и возвращает весь уровень целиком; `nextToken` в ответе отсутствует.
  Форма результата при этом не изменилась — ключ не добавляется «пустым».
- **С `maxKeys`** — ровно один запрос к S3 с `MaxKeys`; `continuationToken` уходит как
  `ContinuationToken`. Наружу возвращается `nextToken` (`NextContinuationToken`), только если
  S3 сообщил `IsTruncated`; отсутствие `nextToken` — страница последняя.

`continuationToken` — opaque-токен из `nextToken` предыдущего ответа: содержимое не
разбирается. `maxKeys` больше 1000 S3 всё равно урежет до 1000. `continuationToken` без
`maxKeys` не действует — листинг останется «дочитать всё».

Типы — `StorageListOptions` и `StorageListResult` в `src/contracts/backend/storage.ts:25`.

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
- Перемещения в контракте нет: S3 не переименовывает префикс, move — это `copyObject` на
  каждый объект + `deleteObjects`. Рекурсию по поддереву собирает потребитель.
- `listObjects` без `maxKeys` отдаёт весь уровень целиком: на папке с десятками тысяч объектов
  это память и роута, и ответа — потребителю с UI нужен постраничный режим.
- `putObject` держит тело в памяти; для крупных файлов — `putObjectStream`.
