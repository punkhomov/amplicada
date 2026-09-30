# Storage Pagination & Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Большие папки грузятся страницами с бесконечным скроллом, а большой текстовый контент — частями (Range), без потери текста на границах UTF-8; слишком крупные Office-файлы не тянутся в браузер.

**Architecture:** Core `listObjects` получает постраничный контракт (`maxKeys`/`continuationToken` → `nextToken`) с сохранением текущего «дочитать всё» по умолчанию. Роут листинга принимает `cursor`/`limit`. Фронт переходит на `useInfiniteQuery` + sentinel-скролл. `file-viewer` получает оконное чтение текста (`offsetBytes`) с безопасной склейкой UTF-8 и потолок размера для Office.

**Tech Stack:** Fastify 5, `@aws-sdk/client-s3` (`MaxKeys`/`ContinuationToken`), React 19, `@tanstack/react-query` (`useInfiniteQuery`), `node:test`, Playwright.

**Spec:** `ref/plans/2026-09-29-admin-storage-roadmap.md` (enabler «постраничный контракт `listObjects`»); предсказание формы — `ref/notes/platform-core.md` D-006.

## Global Constraints

- Только `pnpm`; политика workspace не меняется.
- Тесты: `*.test.ts` → `tsc` → `node --test`; прогон пакета `pnpm --filter <pkg> build && pnpm --filter <pkg> test`.
- Обратная совместимость контракта: без `maxKeys` `listObjects` по-прежнему дочитывает все страницы; `nextToken` добавлен аддитивно.
- Async-роуты Fastify возвращают `reply` во всех ветках.
- i18n — оба словаря; комментарии «почему».
- Dev остановлен перед работой, поднят после (AGENTS.md).

## Review Focus

- Границы UTF-8 при оконном чтении текста: многобайтный символ, разрезанный между чанками, не должен превращаться в `U+FFFD`.
- Оконное чтение не должно пропускать или дублировать байты на стыках (`nextOffset` строго монотонен).
- Бесконечный скролл: `nextToken` исчерпан → sentinel не крутит бесконечные запросы; смена папки сбрасывает страницы.
- Выбор (selection) при догрузке страниц не теряется и не захватывает невидимое.
- Office-файл больше потолка не качается вовсе (проверка по `size` до `readBytes`).
- Диалог перемещения/дерево не ломаются от нового поля `nextToken` (fetch первой страницы с большим limit).

---

### Task 1: Core `listObjects` — постраничный контракт

**Files:**
- Modify: `packages/platform-core/src/contracts/backend/storage.ts`
- Modify: `packages/platform-core/src/backend/services/storage-service.ts`
- Test: `packages/platform-core/src/backend/services/storage-service.test.ts`

**Interfaces:**
- `StorageListOptions += { maxKeys?: number; continuationToken?: string }`.
- `StorageListResult += { nextToken?: string }` — `NextContinuationToken`, когда `IsTruncated`.
- Поведение: `maxKeys` не задан → drain всех страниц, `nextToken` undefined (как сейчас); задан → **один** запрос с `MaxKeys` и `ContinuationToken`, `nextToken` наружу.
- Экспортировать чистый хелпер пагинации? Не нужно.

- [ ] **Step 1: Тесты** (стиль `fakeClient`/`page` из файла):

```ts
test('listObjects с maxKeys отдаёт одну страницу и nextToken', async () => {
  const { client, sent } = fakeClient([page(['a'], 'tok-2')]);
  const storage = new StorageServiceImpl(client, 'bucket');
  const result = await storage.listObjects('p/', { maxKeys: 2, continuationToken: 'tok-1' });
  assert.deepEqual(result.objects.map(o => o.key), ['a']);
  assert.equal(result.nextToken, 'tok-2');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].input, { Bucket: 'bucket', Prefix: 'p/', Delimiter: undefined, ContinuationToken: 'tok-1', MaxKeys: 2 });
});

test('listObjects без maxKeys дочитывает всё, nextToken не выставлен', async () => {
  const { client, sent } = fakeClient([page(['a'], 'tok-2'), page(['b'])]);
  const storage = new StorageServiceImpl(client, 'bucket');
  const result = await storage.listObjects('p/');
  assert.deepEqual(result.objects.map(o => o.key), ['a', 'b']);
  assert.equal(result.nextToken, undefined);
  assert.equal(sent.length, 2);
});
```

- [ ] **Step 2: RED** — `pnpm --filter @amplicada/platform-core build && ... exec node --test dist/backend/services/storage-service.test.js` (падает на `MaxKeys`/`nextToken`).
- [ ] **Step 3: Реализовать** контракт и сервис (`singlePage`-режим в цикле; добавить `MaxKeys` в команду).
- [ ] **Step 4: GREEN** — весь пакет (`pnpm --filter @amplicada/platform-core test`), включая прежние «дочитывает все страницы».
- [ ] **Step 5: Commit** `feat(platform-core): paginated listObjects contract`.

---

### Task 2: Роут листинга с курсором

**Files:**
- Modify: `packages/module-admin/src/contracts/storage.ts`
- Modify: `packages/module-admin/src/backend/routes/storage.ts`
- Test: `packages/module-admin/src/backend/routes/storage.test.ts`

**Interfaces:**
- `StorageListing += { nextToken?: string }`.
- `GET /storage/objects?prefix=&cursor=&limit=` → `{ prefix, prefixes, objects, nextToken? }`.
  - `limit` — положительное целое, дефолт `200`, максимум `1000`; мусор → `400`.
  - `cursor` — непустая строка (opaque); отсутствует → первая страница.
  - Вызов core: `listObjects(prefix, { delimiter: '/', maxKeys: limit, continuationToken: cursor })`.
- Дерево/диалог move продолжают вызывать без курсора — получают первую страницу (в тесте зафиксировать дефолт).

- [ ] **Step 1: Тесты** — страница с `nextToken`, передача `cursor` в core, `limit` вне диапазона → 400, отсутствие курсора → без `ContinuationToken`.
- [ ] **Step 2: RED**, **Step 3: реализовать**, **Step 4: GREEN** (`module-admin`), **Step 5: Commit** `feat(module-admin): cursor pagination for storage listing`.

---

### Task 3: Фронт — бесконечный скролл списка

**Files:**
- Modify: `packages/module-admin/src/frontend/pages/admin-storage/lib/queries.ts`
- Modify: `packages/module-admin/src/frontend/pages/admin-storage/ui/admin-storage.tsx`
- Modify: `.../ui/storage-list.tsx` (строка «загрузка»/sentinel)
- Modify: `.../ui/storage-tree.tsx`, `.../storage-move-dialog.tsx` (лимит первой страницы, `nextToken` не мешает)
- Modify: locales (`admin_storage_loading_more` в en/ru)

**Interfaces:**
- `storageObjectsInfiniteQueryOptions(api, prefix)` → `{ queryKey, queryFn, initialPageParam: undefined, getNextPageParam: last => last.nextToken }`.
- Плоский список: `pages.flatMap(p => toEntries(p))`; `visibleKeys` — из загруженного.
- Sentinel-строка в конце списка (`IntersectionObserver`, `rootMargin: '200px'`): при попадании и `hasNextPage && !isFetchingNextPage` → `fetchNextPage()`; показывать `admin_storage_loading_more`, когда `isFetchingNextPage`; не запрашивать, когда `!hasNextPage`.
- `refetch`/invalidate работают как раньше (инф. кэш сбрасывается на первой странице).
- Поиск остаётся клиентским по загруженным элементам — поведение задокументировать.

- [ ] **Step 1: реализовать** инфинитив-квери и sentinel; смена `prefix` сбрасывает страницы (ключ запроса включает prefix).
- [ ] **Step 2:** `pnpm build && pnpm typecheck`; Playwright: сгенерировать `pages/` с 250 файлами через API, открыть, проскроллить вниз — догрузка второй страницы, в DOM > 200 строк, `nextToken` исчерпан → запросов больше нет (считать запросы `page.on('request')` с `cursor=`), смена папки не тянет старые страницы. Скриншоты, `pageerror` пусто.
- [ ] **Step 3: Commit** `feat(module-admin): infinite scroll for storage listing`.

---

### Task 4: `file-viewer` — оконное чтение текста и потолок Office

**Files:**
- Modify: `packages/file-viewer/src/contracts/index.ts` (`readText(options?: { limitBytes?; offsetBytes? })`; `TextReadResult += { nextOffsetBytes?: number }`)
- Create: `packages/file-viewer/src/frontend/lib/utf8.ts` (+ `.test.ts`) — `utf8CompletePrefix(bytes: Uint8Array): number` (длина префикса из целых кодовых точек)
- Modify: `.../lib/use-resolved-source.ts` (Range c offset; URL-путь читает `arrayBuffer`, обрезает по `utf8CompletePrefix`; blob/file — slice)
- Modify: `.../renderers/text.tsx` (режим просмотра: «Показать ещё» — догрузка следующего окна, append; edit не трогаем)
- Modify: `.../renderers/word.tsx`, `spreadsheet.tsx` (если `descriptor.size` > `OFFICE_MAX_PREVIEW_BYTES` = 50 МБ → external-карточка без `readBytes`)
- Modify: locales file-viewer? Подписи передаёт потребитель; добавить `loadMore` в `FileViewerLabels` и в `viewerLabels` модуля-admin (en/ru)
- Test: `utf8.test.ts`, `read-source.test.ts` (offset)

**Interfaces:**
- `readText` при URL: `Range: bytes=<offset>-<offset+limit-1>`; `nextOffsetBytes = offset + completePrefixLength`; `truncated` — как раньше.
- `utf8CompletePrefix`: 0..4 байта незавершённой последовательности в хвосте → отбрасываются; валидные ASCII/2-3-4-байтные — считаются.

- [ ] **Step 1: тесты** `utf8CompletePrefix`: чистый ASCII; хвост из 1 и из 2 байт от 3-байтного символа; полный 4-байтный эмодзи; невалидный лид-байт (возвращает длину до него). И тест оконного чтения: фейковый `fetch` проверяет заголовок `Range` и `nextOffsetBytes` на стыке.
- [ ] **Step 2: RED**, **Step 3: реализовать**, **Step 4: GREEN** (`file-viewer`), **Step 5:** Playwright: текстовый файл ~1.5 МБ — открыть, «Показать ещё», текст продолжается без `U+FFFD` на стыке (проверить поиск строки, лежащей за первым лимитом); Office-файл > 50 МБ (или подменить порог в тесте) → external-карточка.
- [ ] **Step 6: Commit** `feat(file-viewer): windowed text reading and office preview size cap`.

---

### Task 5: Docs/notes/plan/roadmap/context

- [ ] `packages/platform-core/docs/reference/storage.md` — постраничный контракт (`maxKeys`/`continuationToken`/`nextToken`), дефолт «дочитать всё».
- [ ] `packages/module-admin/docs/reference/storage.md` — `cursor`/`limit`, `nextToken`, бесконечный скролл, клиентский поиск по загруженному; `file-viewer` — оконное чтение, потолок Office.
- [ ] `ref/notes/platform-core.md` — обновить D-006 («Что изменит решение» сбылось) или добавить D-007; `ref/notes/file-viewer.md` — D-008 (оконное чтение и потолок), `module-admin` — дополнение к D-006.
- [ ] `ref/plans/2026-09-29-admin-storage-roadmap.md` — отметить enabler `nextToken` закрытым, внести оконное чтение; `ref/context.md` — ключевики.
- [ ] Commit `docs: storage pagination and streaming`.

---

## Self-Review

- **Coverage:** пагинация (T1–T3), стриминг/частичная загрузка (T4), docs (T5).
- **Review Focus → tests:** UTF-8 стыки — T4 (`utf8CompletePrefix` + оконный тест); монотонность offset — T4; бесконечный скролл/исчерпание/смена папки — T3 (живой счётчик запросов); selection при догрузке — T3 (sync уже есть, проверить живьём); Office-потолок — T4; совместимость дерева/диалога — T2/T3.
- **Type consistency:** `nextToken` в core/route/UI совпадает; `readText` расширяется аддитивно (`offsetBytes`, `nextOffsetBytes`), потребители (text.tsx) обновляются в той же задаче.
