---
title: Admin Storage — ближайшие итерации (roadmap)
type: plan
tier: 3
status: in-progress
date: 2026-09-29
---

# Admin Storage — ближайшие итерации

Ветка `feat/admin-storage-explorer`. Уже сделано и влито в ветку: общая либа превью
(`@amplicada/file-viewer`, D-001…D-004), файловый менеджер `/admin/storage`
(листинг по папкам, ключ в query, inline-превью; `module-admin` D-004), `Range`/`206`
в core. Ниже — что делаем дальше по этой линии. Не пул «вообще всего проекта», а
непосредственно storage + file-viewer + потребители.

## Итерация 1 — закрыть текущую ветку ✔ (2026-09-29)

- [x] **Правка текста.** `PUT /storage/objects?key=` (JSON `{ content }`, `bodyLimit` 8 МБ,
      проверка существования, сохранение `contentType`) + `mode="edit"`/`onSave` в
      превью-диалоге. Закрывает пробел `ref/notes/file-viewer.md` (правка не подключена).
- [x] **Office-превью docx/xlsx.** `@silurus/ooxml` (Rust/WASM + Canvas, MIT, 0 deps),
      точный pin `0.88.0` (в итоге). Отдельные entry `/docx`, `/xlsx`, ленивые; `readBytes()`
      в контракте рендерера; фолбэк на external-карточку. Заменил запрет клиентской
      конвертации из D-002 новым решением D-005. Качество и фолбэк проверены живьём.
- [x] **Docs/notes/plan.** `ref/notes/file-viewer.md` (D-005 Office, D-006 правка),
      дописан D-004 в `module-admin`, `packages/*/docs`, ключевики в `ref/context.md`.
- [x] **Флаг правки (follow-up 2026-09-29).** `STORAGE_EDIT_ENABLED` (default `false`):
      без него `PUT` не регистрируется, `GET /storage/config` отдаёт `editEnabled`, UI открывает
      превью read-only. Записано `module-admin` D-005.

## Итерация 2 — Explorer UI и операции ✔ (2026-09-29)

Пользовательское решение: вид близко к Windows Explorer **вместе** с операциями, не
только косметика. Макеты — throwaway HTML + скриншоты Playwright.

**Chrome страницы** (в текущем админ-layout'е):
- [x] Командная панель: `Новая папка`, `Загрузить` | `Переименовать`, `Переместить`,
      `Скачать`, `Удалить`; справа поиск, обновить, переключатель вид/плитка.
- [x] Адресная строка: «вверх» + хлебные крошки (сегменты кликабельны).
- [x] Левое дерево префиксов с ленивым раскрытием (переиспользует `GET /storage/objects`).
- [x] Статус-бар: выбрано / всего / размер.
- [x] Контекстное меню (правый клик по строке и по пустому месту).

**Операции** (выбраны все):
- [x] Создать папку (маркер-объект `.../`; `POST /storage/folder`).
- [x] Переименовать (инлайн; `F2`/меню/двойной клик).
- [x] Переместить (drag&drop на узел/папку + диалог; `POST /storage/move`, copy+delete).
- [x] Мультивыбор (клик/Ctrl/Shift/чекбокс) + массовые удаление и перемещение;
      `DELETE /storage/objects { keys[] }`.
- [x] Сортировка (имя/размер/изменён/тип, asc/desc), обновить, хоткеи (`F2`, `Del`,
      `Ctrl+A`, `Enter`, `Esc`).
- [x] **Вид «плитка» (tiles)** — реализовать; переключатель в панели, не откладывать
      молча.
- [x] Панель свойств объекта (etag, contentType, точный `lastModified`).

**Структура кода:** разбить страницу на `StorageToolbar`, `StorageTree`, `StorageList`,
`StorageContextMenu`, `MoveDialog` + хук выбора/сортировки.

**Сделано (коммиты `328eb072..45ab313f`):** core-примитивы `copyObject`/`deleteObjects`,
роуты `POST /storage/folder`, `POST /storage/move`, пакетный `DELETE /storage/objects`,
Explorer-UI целиком. **Открытые хвосты:** пагинация закрыта итерацией
`2026-09-29-storage-pagination-streaming.md` (2026-09-30, enabler `nextToken`);
`contentType`/`etag` в свойствах показывают `—` — нужен metadata-роут
(`ListObjectsV2` тип не отдаёт); в SeaweedFS вложенные пустые папки могут пережить
`deletePrefix`/перенос родителя (запись filer вне объектов). Живой e2e-прогон — шаг 8 плана
`2026-09-29-admin-storage-explorer-ui.md`.

**Осознанно вне итерации:** массовое скачивание zip'ом (серверный `archiver` или
по одному) — отдельной задачей; права/роли (ниже).

## Итерация 3 — потребители

- [ ] `support-chat` на `file-viewer`: превью вложений, включая Office, прямо в чате.
- [ ] Превью-генерация и несколько вложений на сообщение (требует таблицы вложений,
      `ref/notes/module-support-chat.md`).

## Enabler'ы (гейтят многое)

- [ ] **Роли/права доступа** (admin/support/user; права на префиксы) — сейчас «вошёл»
      значит всё. Гейтит приватность вложений и разграничение админки; всплывает в
      `module-admin` D-004 и в `module-support-chat`.
- [x] **Постраничный контракт `listObjects` (`nextToken`) в core → пагинация больших папок —
      ✔ (2026-09-30).** `maxKeys`/`continuationToken`/`nextToken` (core), листинг с
      `cursor`/`limit` и бесконечным скроллом (admin), оконное чтение текста и потолок Office
      (file-viewer). Реализация — `ref/plans/2026-09-29-storage-pagination-streaming.md`.
- [ ] Аудит операций хранилища (кто загрузил/удалил).
- [ ] Публичные/подписанные ссылки (share) — осторожно, хранилище во внутренней сети.
- [ ] Версии объектов / Trash.

## Риски и эксплуатация

- [ ] `@silurus/ooxml`: pin точной версии, ревизия апдейтов вручную (AI-generated,
      релизы раз в неделю), SBOM.
- [ ] Тесты роутов storage (сейчас выпадают из покрытия).
- [ ] CSP/helmet — если появится, разрешить `wasm`/worker.

## Заметки

- **Пагинация и стриминг (2026-09-30).** Итерация `2026-09-29-storage-pagination-streaming.md`
  закрыта: core `listObjects` получил аддитивный постраничный режим (`maxKeys`/
  `continuationToken`/`nextToken`, дефолт «дочитать всё» сохранён); `GET /storage/objects`
  принимает `cursor`/`limit` (дефолт 200, потолок 1000), список на `useInfiniteQuery` с
  sentinel-строкой; `file-viewer` читает текст окнами с безопасными границами UTF-8
  (кнопка «Показать ещё») и не разбирает Office крупнее 50 МиБ. Живой прогон: 250 файлов —
  первая страница 200 строк, одна догрузка по курсору, исчерпание токена останавливает
  запросы; текст 1.5 МБ склеивается без `U+FFFD`; `.docx` 51 МБ — external-карточка без
  запроса байтов. Открытые хвосты: серверного поиска нет (поиск клиентский по догруженному,
  пустой результат скрывает sentinel), дерево/диалог перемещения видят только первые 1000
  элементов папки, ошибка догрузки заменяет весь листинг экраном ошибки.
- **Спайк Office-рендера (2026-09-29).** Рассмотрены: облачные вьюеры (отпадают —
  приватные файлы), документ-серверы Collabora/ONLYOFFICE (тяжёлая инфра), серверная
  конвертация LibreOffice→PDF, client-JS (docx-preview/exceljs — приблизительно). Выбран
  `@silurus/ooxml`: MIT, ноль зависимостей, Vite 8 zero-config, per-format ленивые чанки,
  Canvas (без инъекции DOM). Размер ~1.3 МБ gzip DOCX / ~1.0 МБ XLSX при первом открытии.
  Риск — зрелость (v0.88.0, AI-generated).
- Связанные документы: `ref/notes/file-viewer.md`, `ref/notes/module-admin.md`,
  `ref/notes/module-support-chat.md`, `ref/notes/platform-core.md`,
  `packages/module-admin/docs/reference/storage.md`.
