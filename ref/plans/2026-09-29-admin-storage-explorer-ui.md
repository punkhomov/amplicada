# Admin Storage Explorer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести `/admin/storage` до файлового менеджера в духе Windows Explorer: командная панель, дерево, адресная строка, мультивыбор, операции (папка/переименовать/переместить/удалить), контекстное меню, сортировка, хоткеи, вид списком и плиткой.

**Architecture:** Новые примитивы в core (`copyObject`, `deleteObjects`) — тонкие обёртки над S3-командами. `module-admin` добавляет роуты `POST /storage/folder`, `POST /storage/move`, пакетное `DELETE /storage/objects`; переиспользует существующий `listObjects`. Фронт: чистые хелперы (entries/selection/sort/paths) с unit-тестами + компоненты страницы (`StorageToolbar`, `StorageTree`, `StorageList`, `StorageTiles`, `StorageContextMenu`, `StorageMoveDialog`, `StoragePropertiesDialog`), собираемые в `admin-storage.tsx`.

**Tech Stack:** TypeScript 7 (tsc), Fastify 5, `@aws-sdk/client-s3`, React 19, `@tanstack/react-query`, Tailwind v4 + shadcn-кит (`@amplicada/platform-core/frontend/ui/*`), `node:test` (компилируется в `dist`, запуск `node --test`), Playwright (живой UI).

**Spec:** `ref/plans/2026-09-29-admin-storage-roadmap.md` (итерация 2) + макеты из сессии. Решения: `ref/notes/module-admin.md` D-004/D-005, `ref/notes/platform-core.md` D-006.

## Global Constraints

- Только `pnpm`; политику `pnpm-workspace.yaml` не ослаблять.
- Тесты: `*.test.ts` рядом с кодом, `tsc` → `dist`, `node --test "dist/**/*.test.js"`. Прогон пакета: `pnpm --filter <pkg> build && pnpm --filter <pkg> test`.
- Async-роуты Fastify **обязаны** возвращать `reply` во всех ветках (иначе Fastify ругается на преждевременное завершение) — как в существующих роутах `storage.ts`.
- Ключ объекта — всегда query-параметр `key`, не сегмент пути (D-004).
- Правка текста остаётся за `STORAGE_EDIT_ENABLED`, эту итерацию не трогаем.
- UI-строки — через i18n (`admin_storage_*` в `packages/module-admin/src/frontend/locales/{en,ru}.json`), en и ru синхронно.
- Комментарии — «почему», не «что».
- Перед работой dev остановлен; после — поднять и оставить рабочим (AGENTS.md).
- Роли/права не вводятся: доступ — «аутентифицированная сессия», как и было.

## Review Focus

- Перемещение папки в саму себя или в своего потомка — должно быть отвергнуто (`400`), не зацикливаться.
- Коллизия имён при перемещении/переименовании — что происходит, если целевой ключ уже существует (решение: `409`, без перезаписи).
- Пустое/невалидное имя папки (`/`, `..`, пустая строка, длинное) — `400`.
- Создание папки на существующий префикс — `409`, не тихая перезапись.
- Пакетное удаление > 1000 ключей — режется на пачки, ничего не теряется.
- Копирование объекта вложенного ключа с кириллицей/пробелами (URL-encoding `CopySource`).
- Выбор при сортировке/смене папки: удалённые из вида ключи не остаются «тихо выбранными» в bulk-операциях.

---

### Task 1: Core — `copyObject` и `deleteObjects`

**Files:**
- Modify: `packages/platform-core/src/contracts/backend/storage.ts`
- Modify: `packages/platform-core/src/backend/services/storage-service.ts`
- Test: `packages/platform-core/src/backend/services/storage-service.test.ts`

**Interfaces:**
- Produces (в `BackendStorageService`):
  - `copyObject(fromKey: string, toKey: string): Promise<void>` — S3 `CopyObject`; `CopySource` — `"<bucket>/<encodeURIComponent(fromKey)>"` (кириллица/пробелы в ключе).
  - `deleteObjects(keys: string[]): Promise<number>` — пакетами по 1000 (`DeleteObjects`, `Quiet: true`), возвращает число удалённых ключей. Пустой массив — no-op, возвращает `0`.
- `deletePrefix` внутри переиспользует `deleteObjects` (батчинг в одном месте), поведение не меняется.

- [x] **Step 1: Написать падающие тесты** (в существующий `storage-service.test.ts`, стиль `fakeClient`/`page` оттуда)

```ts
test('copyObject шлёт CopyObject с ключом и URL-encoded источником', async () => {
  const { client, sent } = fakeClient([{}]);
  const storage = new StorageServiceImpl(client, 'bucket');
  await storage.copyObject('a/конспект 1.txt', 'b/конспект 1.txt');
  assert.equal(sent[0].constructorName, 'CopyObjectCommand');
  assert.deepEqual(sent[0].input, {
    Bucket: 'bucket',
    Key: 'b/конспект 1.txt',
    CopySource: `bucket/${encodeURIComponent('a/конспект 1.txt')}`,
  });
});

test('deleteObjects режет ключи на пачки по 1000', async () => {
  const { client, sent } = fakeClient([{}, {}]);
  const storage = new StorageServiceImpl(client, 'bucket');
  const keys = Array.from({ length: 1500 }, (_, i) => `k${i}.txt`);
  assert.equal(await storage.deleteObjects(keys), 1500);
  assert.equal(sent.length, 2);
  assert.equal((sent[0].input.Delete as { Objects: unknown[] }).Objects.length, 1000);
  assert.equal((sent[1].input.Delete as { Objects: unknown[] }).Objects.length, 500);
});

test('deleteObjects с пустым списком не ходит в S3', async () => {
  const { client, sent } = fakeClient([]);
  const storage = new StorageServiceImpl(client, 'bucket');
  assert.equal(await storage.deleteObjects([]), 0);
  assert.equal(sent.length, 0);
});
```

- [x] **Step 2: Прогнать — падает**

Run: `pnpm --filter @amplicada/platform-core build && pnpm --filter @amplicada/platform-core exec node --test dist/backend/services/storage-service.test.js`
Expected: FAIL — `copyObject`/`deleteObjects` не функции.

- [x] **Step 3: Реализовать**
- В контракт добавить методы с док-комментариями (почему именно так — в стиле файла).
- В `StorageServiceImpl`: `CopyObjectCommand` из `@aws-sdk/client-s3`; `deleteObjects` — цикл по 1000 (как в `deletePrefix`), `Quiet: true`; `deletePrefix` переписать через `deleteObjects`.

- [x] **Step 4: Прогнать — проходит**

Run: `pnpm --filter @amplicada/platform-core build && pnpm --filter @amplicada/platform-core test`
Expected: PASS, включая прежние тесты `deletePrefix`.

- [x] **Step 5: Commit**

```bash
git add packages/platform-core/src/contracts/backend/storage.ts packages/platform-core/src/backend/services/storage-service.ts packages/platform-core/src/backend/services/storage-service.test.ts
git commit -m "feat(platform-core): storage copyObject and deleteObjects primitives"
```

---

### Task 2: Backend — создать папку, переместить, пакетно удалить

**Files:**
- Modify: `packages/module-admin/src/contracts/storage.ts`
- Modify: `packages/module-admin/src/backend/routes/storage.ts`
- Test: `packages/module-admin/src/backend/routes/storage.test.ts`

**Interfaces:**
- Consumes: `copyObject`, `deleteObjects`, `listObjects(prefix)` (без delimiter), `putObject`, `headObject`, `deletePrefix` из Task 1.
- Produces (contracts):
  ```ts
  export interface StorageCreateFolderRequest { name: string }
  export interface StorageMoveRequest { keys: string[]; destination: string }
  export interface StorageMoveResult { moved: number }
  export interface StorageDeleteRequest { keys: string[] }
  ```
- Produces (routes):
  - `POST /storage/folder?prefix=` body `{ name }` → папка-маркер `${prefix}${name}/` (пустое тело, `contentType: 'application/x-directory'`), ответ — `headObject`. `400` пустое/невалидное имя (`/`, `\`, `..`, длина > 255), `409` если префикс уже существует.
  - `POST /storage/move` body `{ keys, destination }` → для файла: `copyObject(key, destination + basename)`; для папки (ключ с `/`): рекурсивный листинг → `copyObject` каждого → `deleteObjects` старых → удалить маркер. `destination` нормализуется (`foo` → `foo/`). `400`: пустой `keys`, пустой/невалидный `destination`, папка перемещается в себя/потомка, ключа нет в бакете. `409`: целевой ключ уже существует. Ответ `{ moved }` (число верхнеуровневых элементов).
  - `DELETE /storage/objects` — теперь тело `{ keys: string[] }` вместо `?key=`: `400` пустой список, `200 { deleted }`, `deleteObjects`. Прежняя форма `?key=` удаляется (UI обновляется в Task 4).
  - Хелперы (экспортировать для тестов): `folderKey(prefix, name)`, `moveTargetOf(key, destination)`, `isDescendant(target, folderKey)`.

- [x] **Step 1: Написать падающие тесты** (дополнить `storage.test.ts`; fake-storage расширить `listObjects`/`copyObject`/`deleteObjects`)

```ts
test('POST /storage/folder создаёт маркер папки', async () => {
  const { app, puts } = appWith();
  const res = await app.inject({ method: 'POST', url: '/storage/folder?prefix=a/', payload: { name: 'docs' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(puts.at(-1), { key: 'a/docs/', body: '', contentType: 'application/x-directory' });
});

test('POST /storage/folder отвергает невалидное имя', async () => {
  const { app, puts } = appWith();
  for (const name of ['', 'a/b', '..', 'x'.repeat(256)]) {
    const res = await app.inject({ method: 'POST', url: '/storage/folder', payload: { name } });
    assert.equal(res.statusCode, 400, name);
  }
  assert.equal(puts.length, 0);
});

test('POST /storage/move переносит файл через copy+delete', async () => {
  const { app, moves } = appWith();
  const res = await app.inject({ method: 'POST', url: '/storage/move', payload: { keys: ['a/f.txt'], destination: 'b' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { moved: 1 });
  assert.deepEqual(moves, [{ from: 'a/f.txt', to: 'b/f.txt' }]);
});

test('POST /storage/move папки копирует поддерево и удаляет старое', async () => {
  const { app, moves, deletes } = appWith({ folderContents: { 'a/pkg/': ['a/pkg/i.html', 'a/pkg/sub/j.txt'] } });
  const res = await app.inject({ method: 'POST', url: '/storage/move', payload: { keys: ['a/pkg/'], destination: 'b/' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(moves, [
    { from: 'a/pkg/i.html', to: 'b/pkg/i.html' },
    { from: 'a/pkg/sub/j.txt', to: 'b/pkg/sub/j.txt' },
  ]);
  assert.deepEqual(deletes, [['a/pkg/i.html', 'a/pkg/sub/j.txt']]);
});

test('POST /storage/move отвергает перемещение папки в себя/потомка', async () => {
  const { app } = appWith();
  for (const destination of ['a/pkg/', 'a/pkg/sub/']) {
    const res = await app.inject({ method: 'POST', url: '/storage/move', payload: { keys: ['a/pkg/'], destination } });
    assert.equal(res.statusCode, 400, destination);
  }
});

test('DELETE /storage/objects удаляет список ключей', async () => {
  const { app, deletes } = appWith();
  const res = await app.inject({ method: 'DELETE', url: '/storage/objects', payload: { keys: ['a.txt', 'b.txt'] } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { deleted: 2 });
  assert.deepEqual(deletes, [['a.txt', 'b.txt']]);
});
```

- [x] **Step 2: Прогнать — падает**

Run: `pnpm --filter @amplicada/module-admin build && pnpm --filter @amplicada/module-admin exec node --test dist/backend/routes/storage.test.js`
Expected: FAIL — роутов нет.

- [x] **Step 3: Реализовать** роуты и хелперы строго по интерфейсам выше. Общие правила: ключи и destination нормализуются (`folderPrefix`), запрет `..`, проверка существования источника через `headObject`/листинг, проверка коллизии цели через `headObject`, ответ `reply` во всех ветках.

- [x] **Step 4: Прогнать — проходит**

Run: `pnpm --filter @amplicada/module-admin build && pnpm --filter @amplicada/module-admin test`
Expected: PASS (PUT-тесты тоже — env выставляется в `appWith`).

- [x] **Step 5: Commit**

```bash
git add packages/module-admin/src/contracts/storage.ts packages/module-admin/src/backend/routes/storage.ts packages/module-admin/src/backend/routes/storage.test.ts
git commit -m "feat(module-admin): folder create, move and bulk delete routes"
```

---

### Task 3: Frontend — чистые хелперы (entries, selection, sort, paths)

**Files:**
- Create: `packages/module-admin/src/frontend/pages/admin-storage/lib/entries.ts` (+ `.test.ts`)
- Create: `packages/module-admin/src/frontend/pages/admin-storage/lib/selection.ts` (+ `.test.ts`)
- Create: `packages/module-admin/src/frontend/pages/admin-storage/lib/sort.ts` (+ `.test.ts`)
- Modify: `packages/module-admin/src/frontend/pages/admin-storage/lib/paths.ts` (+ `.test.ts`)

**Interfaces:**
- `entries.ts`:
  ```ts
  export interface StorageEntry { kind: 'folder' | 'file'; key: string; name: string; size?: number; lastModified?: string }
  export function toEntries(listing: StorageListing): StorageEntry[]
  ```
  Папки — из `prefixes` (`kind:'folder'`, `name` — последний сегмент, `key` — полный префикс), файлы — из `objects`.
- `selection.ts`:
  ```ts
  export interface SelectionState { keys: string[]; anchor: string | null }
  export type SelectionAction =
    | { type: 'click'; key: string; additive: boolean; range: boolean; visible: string[] }
    | { type: 'check'; key: string; checked: boolean }
    | { type: 'checkAll'; keys: string[]; checked: boolean }
    | { type: 'clear' }
    | { type: 'sync'; visible: string[] };
  export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState
  ```
  `click` без модификаторов — одиночный выбор; `additive` — toggle; `range` — от `anchor` до `key` по `visible`; `sync` убирает ключи, которых нет в `visible`.
- `sort.ts`:
  ```ts
  export type StorageSortKey = 'name' | 'size' | 'modified' | 'type';
  export interface StorageSort { key: StorageSortKey; direction: 'asc' | 'desc' }
  export function sortEntries(entries: StorageEntry[], sort: StorageSort): StorageEntry[]
  ```
  Папки всегда выше файлов; внутри — по выбранному полю; при равенстве — по имени.
- `paths.ts` дополнить:
  ```ts
  export function parentPrefix(prefix: string): string           // 'a/b/' -> 'a/'
  export function moveTarget(key: string, destination: string): string  // файл -> destination + basename; 'a/pkg/' -> destination + 'pkg/'
  export function renameTarget(key: string, name: string): string       // та же папка, новое имя; для папки — со слэшем
  export function isInside(prefix: string, candidate: string): boolean  // candidate в поддереве prefix
  ```

- [x] **Step 1: Написать тесты** для всех четырёх модулей (в той же папке, стиль `node:test`): граничные случаи `toEntries` (маркеры уже отфильтрованы бэком), range-выбор, sync, сортировка папок/файлов и направлений, `moveTarget`/`renameTarget` для файла и папки, `isInside`.
- [x] **Step 2: Прогнать — падает** (`pnpm --filter @amplicada/module-admin build && ... exec node --test dist/frontend/pages/admin-storage/lib/*.test.js`)
- [x] **Step 3: Реализовать** функции (чистые, без React).
- [x] **Step 4: Прогнать — проходит** (`pnpm --filter @amplicada/module-admin test`)
- [x] **Step 5: Commit** `feat(module-admin): storage explorer helpers (entries, selection, sort, paths)`

---

### Task 4: Frontend — список, выделение, сортировка, инлайн-правка, хоткеи, статус-бар

**Files:**
- Create: `packages/module-admin/src/frontend/pages/admin-storage/ui/storage-list.tsx`
- Create: `packages/module-admin/src/frontend/pages/admin-storage/ui/storage-status-bar.tsx`
- Modify: `packages/module-admin/src/frontend/pages/admin-storage/ui/admin-storage.tsx`
- Modify: `packages/module-admin/src/frontend/locales/en.json`, `ru.json`
- Verify: `/tmp/opencode/verify-explorer.mjs` (Playwright)

**Interfaces:**
- Consumes: Task 3 хелперы; мутации Task 2 (`api.post('/admin/storage/folder', ...)`, `api.post('/admin/storage/move', ...)`, `api.delete('/admin/storage/objects', { body: { keys } })` — как в api-client).
- Produces: `StorageList` и `StorageStatusBar`, состояние выбора/сортировки/инлайн-редактирования в `AdminStorage`.

**Поведение (точные требования):**
- Таблица: колонки `[checkbox] | Имя | Размер | Изменён | Тип | действия`; чекбокс в шапке — выбрать все видимые; клик по строке — открыть файл/зайти в папку; Ctrl/Cmd-клик и Shift-клик — выбор; `Ctrl+A` — все видимые; `Esc` — снять выбор; `Enter` — открыть; `Delete` — удалить выбранное (через существующий `confirm`-стиль админки); `F2` — переименовать единственный выбранный.
- Сортировка: клик по заголовку меняет поле/направление (стрелка); папки всегда сверху.
- Инлайн: `F2`/двойной клик по имени → input в строке; `Enter` — commit (`renameTarget` + move), `Esc` — отмена. «Новая папка» → строка-плейсхолдер в начале списка с input; commit — `POST /storage/folder`, ошибка (409/400) — `alert` + строка остаётся.
- Статус-бар: `Выбрано: N`, `Элементов: M`, суммарный размер выбранных файлов (`formatBytes`).
- Действия в строке (иконки) сохраняются: превью (только для поддерживаемых типов), скачать, удалить.
- Выбор синхронизируется с видимым списком (`selectionReducer({type:'sync'})` при смене папки/поиска).

**Проверка:** `pnpm build`, `pnpm typecheck`; Playwright: открыть `/admin/storage`, создать папку инлайн, переименовать файл, выбрать два файла чекбоксами (статус-бар показывает «Выбрано: 2»), `Delete` — подтверждение и удаление.

- [x] **Step 1: Локали** — новые ключи `admin_storage_new_folder`, `admin_storage_rename`, `admin_storage_move`, `admin_storage_move_here`, `admin_storage_delete_selected`, `admin_storage_selected_count`, `admin_storage_items_count`, `admin_storage_folder_exists`, `admin_storage_invalid_name`, `admin_storage_other` (и ru-варианты).
- [x] **Step 2: `storage-status-bar.tsx`** — три показателя по пропсам `{ selected: number; total: number; selectedBytes: number }`.
- [x] **Step 3: `storage-list.tsx`** — таблица с пропсами `{ entries, sort, selection, editing, onSort, onRowClick, onCheck, onOpen, onCommitEdit, onCancelEdit, onRenameStart, onDelete, onDownload, onPreview }`.
- [x] **Step 4: собрать в `admin-storage.tsx`** — состояние (selection reducer, sort, editing), мутации, хоткеи на уровне страницы, интеграция `StorageStatusBar`; существующий диалог превью и тулбар-кнопка «Загрузить» сохраняются (тулбар расширяется в Task 5).
- [x] **Step 5: сборка/типы + Playwright**, затем commit `feat(module-admin): storage list with selection, sorting and inline rename`.

---

### Task 5: Frontend — командная панель, адресная строка, дерево, плитка

**Files:**
- Create: `.../ui/storage-toolbar.tsx`, `.../ui/storage-tree.tsx`, `.../ui/storage-tiles.tsx`
- Modify: `.../ui/admin-storage.tsx`, locales

**Поведение:**
- **Тулбар:** `Новая папка`, `Загрузить` | `Переименовать` (`F2`), `Переместить`, `Скачать`, `Удалить` (bulk, неактивны без выбора) | поиск, `Обновить`, переключатель `Списком`/`Плиткой`.
- **Адресная строка:** кнопка «вверх» (`parentPrefix`) + крошки `Storage › a › b` (кликабельны) — заменить текущий `AdminBreadcrumbs`-блок внутри страницы.
- **Дерево:** панель слева; корень `Storage`; узел раскрывается лениво (`GET /storage/objects?prefix=` → `prefixes`), клик — навигация, активный подсвечен; при глубине > 0 отступ.
- **Плитка:** сетка карточек (иконка по `fileKindOf`, имя, размер для файлов), те же выбор/открытие/контекст/инлайн, что у списка; режим хранится в state страницы.

**Проверка:** Playwright — дерево раскрывает вложенную папку, клик по крошке возвращает на уровень выше, переключатель плитки показывает/скрывает сетку.

- [x] Шаги: компоненты → интеграция → локали → сборка/типы → Playwright → commit `feat(module-admin): storage explorer toolbar, address bar, tree and tiles`.

---

### Task 6: Frontend — контекстное меню, диалоги «Переместить» и «Свойства», drag&drop

**Files:**
- Create: `.../ui/storage-context-menu.tsx`, `.../ui/storage-move-dialog.tsx`, `.../ui/storage-properties-dialog.tsx`
- Modify: `.../ui/admin-storage.tsx`, `.../ui/storage-list.tsx`, `.../ui/storage-tree.tsx`, locales

**Поведение:**
- **Контекстное меню:** правый клик по строке (если строка не в выборе — сначала выбрать её) и по пустому месту. Пункты: `Открыть`, `Скачать`, `Переименовать`, `Переместить…`, `Удалить`, `Свойства`; для пустого места — `Новая папка`, `Загрузить`, `Обновить`. Позиционирование по курсору, закрытие по клику вне и `Esc`.
- **Диалог перемещения:** список/дерево назначения (навигация по `GET /storage/objects`, начиная с корня), кнопка `Переместить сюда`; недоступные/невалидные цели (папка в себя/потомка, коллизия) — disabled/ошибка.
- **Свойства:** диалог с `key`, `size`, `contentType`, `etag`, `lastModified` выбранного объекта (данные из листинга; для папки — только ключ и тип «Папка»).
- **Drag&drop:** строки `draggable`; drop-цели — узлы дерева, строки-папки, крошки, кнопка «вверх»; drop вызывает move выбранного; подсветка допустимой цели, запрет drop в себя/потомка.

**Проверка:** Playwright — правый клик открывает меню; «Переместить…» переносит файл в другую папку (видно после навигации); drag&drop строки на узел дерева переносит файл.

- [x] Шаги: компоненты → интеграция → локали → сборка/типы → Playwright → commit `feat(module-admin): storage context menu, move dialog, properties and drag&drop`.

---

### Task 7: Документация и заметки

**Files:**
- Modify: `packages/module-admin/docs/reference/storage.md`
- Modify: `packages/module-admin/docs/index.md` (freshness)
- Modify: `ref/notes/module-admin.md` (новый D-006)
- Modify: `ref/plans/2026-09-29-admin-storage-roadmap.md` (отметить итерацию 2)
- Modify: `ref/context.md` (ключевики)

**Содержание:**
- storage.md: новые роуты (`POST /storage/folder`, `POST /storage/move`, `DELETE /storage/objects {keys}`), правила move (папка в себя — 400, коллизия — 409), описание Explorer-UI; убрать «пагинации нет» → пагинация остаётся ограничением, добавленное не обещать.
- notes: D-006 — почему пакетные операции и move=copy+delete, отвергнутое (presigned multipart copy, «move» через переименование префикса — S3 не умеет), грабли (CopySource encoding, >1000 ключей).
- roadmap: чекбоксы итерации 2; `ref/context.md` — ключевики `POST /storage/folder`, `/storage/move`, bulk delete, Explorer-UI.

- [x] Commit `docs: storage explorer UI and operations`.

---

### Task 8: Живая сквозная проверка (Playwright) и финальная сборка

**Files:** `/tmp/opencode/verify-explorer-e2e.mjs` (не коммитится).

- [ ] Сценарий: логин → засеять `expl/l1/f1.txt`, `expl/l2/` → создать папку → переименовать файл → Ctrl-выбор двух файлов → bulk delete → move файла в папку → открыть контекстное меню → свойства → переключить плитку. На каждом шаге скриншот в `/tmp/opencode/`, собрать `pageerror`/`console.error`.
- [ ] `pnpm build && pnpm test && pnpm typecheck` — всё зелёное.
- [ ] Commit (если остались правки после проверки): `test: storage explorer e2e adjustments` или пропустить шаг, если правок нет.

---

## Self-Review

- **Spec coverage:** все пункты итерации 2 закрыты: командная панель (T5), адресная строка (T5), дерево (T5), статус-бар (T4), контекстное меню (T6), новая папка (T2/T4), переименовать (T2/T4), переместить (T2/T6), мультивыбор+bulk (T2/T4), сортировка/обновить/хоткеи (T4/T5), плитка (T5), свойства (T6).
- **Review Focus → tests:** валидации/коллизии/потомки — T2 (роуты) + T6 (диалог); >1000 — T1; encoding — T1 (`encodeURIComponent`) + live move вложенного файла (T4/T6/T8); sync выбора — T3 (`sync`) + T4 (смена папки).
- **Type consistency:** `StorageEntry`/`SelectionState`/`StorageSort` определены в T3 и используются T4–T6; имена роутов и контрактов совпадают в T2 и T4.
