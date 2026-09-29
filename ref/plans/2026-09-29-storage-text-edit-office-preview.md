# Text Editing + Office Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать админке хранилища правку текстовых объектов (`PUT`) и inline-превью Office (docx/xlsx) в общей либе `@amplicada/file-viewer`.

**Architecture:** Правка — тонкий `PUT`-роут в `module-admin` поверх уже существующего `BackendStorageService.putObject` (core) и подключение `mode="edit"`/`onSave` в превью-диалоге. Office — два ленивых рендерера в `file-viewer` поверх `@silurus/ooxml` (Rust/WASM + Canvas, read-only), регистрируемые в существующем реестре рендереров; рендереру отдаётся `ArrayBuffer` через новый `readBytes()`.

**Tech Stack:** TypeScript 7 (tsc), Fastify 5, Drizzle/S3 (core `storage`), React 19, Vite 8, `node:test` + `node:assert/strict` (тесты компилируются в `dist`, запускаются `node --test`), Playwright (живой UI).

**Spec:** `ref/plans/2026-09-29-admin-storage-roadmap.md` (итерация 1) + согласованный в чате дизайн. Решения-заметки: `ref/notes/file-viewer.md`, `ref/notes/module-admin.md`.

## Global Constraints

- Менеджер пакетов — только `pnpm` (v11). Политика `pnpm-workspace.yaml` (`ignoreScripts: true`, `blockExoticSubdeps: true`, `minimumReleaseAge: 10080`) не ослаблять.
- `@silurus/ooxml` ставим точным пином `0.88.0` (не `^`) — проект pre-1.0, релизы раз в неделю, AI-generated.
- Тесты: файл `*.test.ts` рядом с кодом, компилируется `tsc` в `dist`, запуск `node --test "dist/**/*.test.js"`. Пакетам `module-admin` и `file-viewer` нужно добавить скрипт `"test"` (у них его сейчас нет).
- Прогон тестов конкретного пакета: `pnpm --filter <pkg> build && pnpm --filter <pkg> test`. Один файл: `pnpm --filter <pkg> exec node --test dist/<path>.test.js`.
- Тексты UI — через существующий i18n (`admin_storage_*` в `packages/module-admin/src/frontend/locales/{en,ru}.json`); английский и русский синхронно.
- Комментарии в коде — в стиле репозитория (объяснять «почему», не «что»), без шума.
- Перед работой остановить dev (bracket-трюк из AGENTS.md), после — поднять и оставить рабочим.
- Документация — по-русски; после изменений обновить `ref/notes/*`, `packages/*/docs`, `ref/context.md`.

## Review Focus

- `PUT` без ключа или без строкового `content` — должен вернуть `400`, не `500`.
- `PUT` на несуществующий ключ — `404`, объект не создаётся.
- Текст больше дефолтного лимита Fastify (1 МБ) и до 8 МБ — сохраняется, не `413`.
- Кириллица/UTF-8: сохранённый текст возвращается байт-в-байт (в т.ч. размер).
- Устаревшие `.doc`/`.xls` (не OOXML) — попадают в external-карточку, не в Office-рендерер и не падают.

---

### Task 1: `PUT /storage/objects` — сохранение текста

**Files:**
- Modify: `packages/module-admin/package.json` (добавить `"test": "node --test \"dist/**/*.test.js\""`)
- Modify: `packages/module-admin/src/backend/routes/storage.ts`
- Create: `packages/module-admin/src/backend/routes/storage.test.ts`

**Interfaces:**
- Consumes: `createStorageRoutes(fastify, context)` из `./storage.js`; `context.services.resolve<BackendStorageService>('storage')`; методы `storage.headObject(key)`, `storage.putObject(key, body, { contentType })`.
- Produces: роут `PUT /storage/objects?key=<key>`, тело JSON `{ content: string }`, `bodyLimit` 8 МБ. Ответ — `StorageObjectInfo` от `headObject`. Ошибки: `400 { error }` (нет ключа / нет строкового `content`), `404 { error }` (объект не найден).

- [x] **Step 1: Написать падающий тест**

Create `packages/module-admin/src/backend/routes/storage.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { BackendSetupContext, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import { createStorageRoutes } from './storage.js';

interface PutCall { key: string; body: unknown; contentType?: string }

function appWith() {
  const puts: PutCall[] = [];
  const storage = {
    putObject: async (key: string, body: unknown, options?: { contentType?: string }) => {
      puts.push({ key, body, contentType: options?.contentType });
    },
    headObject: async (key: string) =>
      key === 'notes/a.json' ? { key, size: 1, contentType: 'application/json' } : null,
  } as unknown as BackendStorageService;
  const context = { services: { resolve: () => storage } } as unknown as BackendSetupContext;
  const app = Fastify();
  createStorageRoutes(app, context);
  return { app, puts };
}

test('PUT существующего текстового объекта сохраняет содержимое и contentType', async () => {
  const { app, puts } = appWith();
  const res = await app.inject({
    method: 'PUT',
    url: '/storage/objects?key=notes/a.json',
    payload: { content: '{"a":1}' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(puts, [{ key: 'notes/a.json', body: '{"a":1}', contentType: 'application/json' }]);
  assert.equal(res.json().key, 'notes/a.json');
});

test('PUT без ключа — 400', async () => {
  const { app, puts } = appWith();
  const res = await app.inject({ method: 'PUT', url: '/storage/objects', payload: { content: 'x' } });
  assert.equal(res.statusCode, 400);
  assert.equal(puts.length, 0);
});

test('PUT без строкового content — 400', async () => {
  const { app } = appWith();
  const res = await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: {} });
  assert.equal(res.statusCode, 400);
});

test('PUT несуществующего ключа — 404 и без записи', async () => {
  const { app, puts } = appWith();
  const res = await app.inject({ method: 'PUT', url: '/storage/objects?key=missing.txt', payload: { content: 'x' } });
  assert.equal(res.statusCode, 404);
  assert.equal(puts.length, 0);
});

test('PUT текста крупнее дефолтного лимита Fastify (2 МБ) сохраняется, не 413', async () => {
  const { app } = appWith();
  const res = await app.inject({
    method: 'PUT',
    url: '/storage/objects?key=notes/a.json',
    payload: { content: 'x'.repeat(2 * 1024 * 1024) },
  });
  assert.equal(res.statusCode, 200);
});

test('PUT сохраняет кириллицу без искажений', async () => {
  const { app, puts } = appWith();
  await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content: 'привет' } });
  assert.equal(puts[0].body, 'привет');
});
```

- [x] **Step 2: Прогнать тест — падает**

Run: `pnpm --filter @amplicada/module-admin build && pnpm --filter @amplicada/module-admin exec node --test dist/backend/routes/storage.test.js`
Expected: FAIL — `PUT` не зарегистрирован (404 `Route PUT:/storage/objects not found`).

- [x] **Step 3: Добавить `test`-скрипт в пакет**

В `packages/module-admin/package.json` в `"scripts"` добавить (рядом с `typecheck`):
```json
"test": "node --test \"dist/**/*.test.js\""
```

- [x] **Step 4: Реализовать роут**

В `packages/module-admin/src/backend/routes/storage.ts` внутри `createStorageRoutes`, после `POST /storage/objects`:

```ts
fastify.put('/storage/objects', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
  const key = objectKey(request);
  if (!key) return reply.code(400).send({ error: 'Не указан ключ объекта' });
  const { content } = (request.body ?? {}) as { content?: unknown };
  if (typeof content !== 'string') return reply.code(400).send({ error: 'Не передано содержимое' });
  const info = await storage.headObject(key);
  if (!info) return reply.code(404).send({ error: 'Объект не найден' });
  await storage.putObject(key, content, { contentType: info.contentType ?? 'text/plain; charset=utf-8' });
  return storage.headObject(key);
});
```

`bodyLimit` — потому что дефолт Fastify 1 МБ, а потолок редактора в либе — 5 МБ текста (JSON-тело чуть больше).

- [x] **Step 5: Прогнать тесты — проходят**

Run: `pnpm --filter @amplicada/module-admin build && pnpm --filter @amplicada/module-admin test`
Expected: PASS, все тесты `storage.test.js`.

- [x] **Step 6: Commit**

```bash
git add packages/module-admin/package.json packages/module-admin/src/backend/routes/storage.ts packages/module-admin/src/backend/routes/storage.test.ts
git commit -m "feat(module-admin): PUT /storage/objects for saving text content"
```

---

### Task 2: Правка текста в UI `/admin/storage`

**Files:**
- Modify: `packages/module-admin/src/frontend/pages/admin-storage/ui/admin-storage.tsx`
- Modify: `packages/module-admin/src/frontend/locales/en.json`, `packages/module-admin/src/frontend/locales/ru.json`
- Verify: `/tmp/opencode/verify-edit.mjs` (Playwright, не коммитится)

**Interfaces:**
- Consumes: роут из Task 1; `api.put<StorageObject>(path, body, { query })` из `@amplicada/platform-core/frontend`; `FilePreviewDialog` принимает `mode` и `onSave(content: string): Promise<void> | void` (либа сама включает редактор только для `text`).
- Produces: сохранение текста из диалога превью с обновлением листинга.

- [x] **Step 1: Добавить строку ошибки в словари**

В `en.json` и `ru.json` в группе ключей `admin_storage_*` добавить `admin_storage_save_error`:
- en: `"Failed to save file"`
- ru: `"Не удалось сохранить файл"`

- [x] **Step 2: Добавить мутацию сохранения**

В `admin-storage.tsx`, рядом с `deleteObjectMutation`:

```ts
const saveObjectMutation = useMutation({
  mutationFn: ({ key, content }: { key: string; content: string }) =>
    api.put<StorageObject>('/admin/storage/objects', { content }, { query: { key } }),
  onSuccess: invalidate,
  onError: () => alert(t('admin_storage_save_error')),
});
```

- [x] **Step 3: Подключить `onSave` к диалогу**

В `FilePreviewDialog` (строка ~276) добавить рядом с `source`/`labels`:

```tsx
mode="edit"
onSave={content => saveObjectMutation.mutateAsync({ key: preview?.key ?? '', content })}
```

Либа гасит правку для не-текстовых типов сама (`canEdit`), поэтому условие по типу в вызывающем коде не нужно.

- [x] **Step 4: Проверить сборку**

Run: `pnpm typecheck`
Expected: без ошибок в `@amplicada/module-admin`.

- [x] **Step 5: Живой Playwright-сценарий (проверка)**

Остановить dev, затем поднять (см. AGENTS.md). Скрипт `/tmp/opencode/verify-edit.mjs`:
1. Логин `admin`/`admin` (см. `ref/guides/playwright-sandbox.md`).
2. Через `page.context().request.post` загрузить в корень `note.txt` с содержимым `old`.
3. Открыть `/admin/storage`, превью `note.txt`.
4. В редакторе Monaco: `Ctrl+A`, набрать `new content`, нажать кнопку «Сохранить» (label `admin_storage_save`).
5. Дождаться `setTimeout(1500)`, `page.reload()`, снова открыть `note.txt` и снять скриншот — должен быть `new content`.

Run: `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright node /tmp/opencode/verify-edit.mjs`
Expected: скриншот показывает `new content`; в консоли нет ошибок.

- [x] **Step 6: Commit**

```bash
git add packages/module-admin/src/frontend/pages/admin-storage/ui/admin-storage.tsx packages/module-admin/src/frontend/locales/en.json packages/module-admin/src/frontend/locales/ru.json
git commit -m "feat(module-admin): edit text files from storage preview"
```

---

### Task 3: `file-viewer` — типы Office, `readBytes()`, тест-скрипт

**Files:**
- Modify: `packages/file-viewer/package.json` (добавить `"test": "node --test \"dist/**/*.test.js\""`)
- Modify: `packages/file-viewer/src/contracts/index.ts`
- Modify: `packages/file-viewer/src/frontend/lib/file-kind.ts`
- Create: `packages/file-viewer/src/frontend/lib/read-source.ts`
- Modify: `packages/file-viewer/src/frontend/lib/use-resolved-source.ts`
- Create: `packages/file-viewer/src/frontend/lib/file-kind.test.ts`
- Create: `packages/file-viewer/src/frontend/lib/read-source.test.ts`

**Interfaces:**
- Produces:
  - `FileKind` расширен значениями `'word' | 'spreadsheet'`.
  - `RendererProps.readBytes(): Promise<ArrayBuffer>` (и `ResolvedSource.readBytes`).
  - `readSourceBytes(source: FileSource): Promise<ArrayBuffer>` — для URL `fetch(url, { credentials: 'include' })` c проверкой `res.ok`; для `file`/`blob` — `blob.arrayBuffer()`.

- [x] **Step 1: Написать падающие тесты**

Create `packages/file-viewer/src/frontend/lib/file-kind.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileKindOf } from './file-kind.js';

test('docx → word', () => assert.equal(fileKindOf({ name: 'contract.docx' }), 'word'));
test('docm → word', () => assert.equal(fileKindOf({ name: 'form.docm' }), 'word'));
test('xlsx → spreadsheet', () => assert.equal(fileKindOf({ name: 'budget.xlsx' }), 'spreadsheet'));
test('xlsm → spreadsheet', () => assert.equal(fileKindOf({ name: 'macro.xlsm' }), 'spreadsheet'));
test('mime важнее расширения', () =>
  assert.equal(
    fileKindOf({ name: 'x', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'spreadsheet',
  ));
test('устаревшие .doc/.xls остаются other (не OOXML)', () => {
  assert.equal(fileKindOf({ name: 'old.doc' }), 'other');
  assert.equal(fileKindOf({ name: 'old.xls' }), 'other');
});
```

Create `packages/file-viewer/src/frontend/lib/read-source.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSourceBytes } from './read-source.js';

test('URL читается с credentials: include', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;
  try {
    const bytes = await readSourceBytes({ type: 'url', url: '/api/x' });
    assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
    assert.equal(calls[0].url, '/api/x');
    assert.equal(calls[0].init?.credentials, 'include');
  } finally {
    globalThis.fetch = original;
  }
});

test('blob читается без fetch', async () => {
  const bytes = await readSourceBytes({ type: 'blob', blob: new Blob([new Uint8Array([7, 8])]), name: 'b' });
  assert.deepEqual([...new Uint8Array(bytes)], [7, 8]);
});
```

- [x] **Step 2: Прогнать — падает**

Run: `pnpm --filter @amplicada/file-viewer build && pnpm --filter @amplicada/file-viewer exec node --test dist/frontend/lib/file-kind.test.js`
Expected: FAIL — `fileKindOf(...'docx')` возвращает `'other'`, `readSourceBytes` не экспортирован.

- [x] **Step 3: Добавить `test`-скрипт**

В `packages/file-viewer/package.json` в `"scripts"` добавить:
```json
"test": "node --test \"dist/**/*.test.js\""
```

- [x] **Step 4: Расширить контракты**

В `packages/file-viewer/src/contracts/index.ts`:
- `FileKind` → `'image' | 'video' | 'audio' | 'pdf' | 'text' | 'word' | 'spreadsheet' | 'other'`.
- В `RendererProps` добавить после `readText`:
```ts
  /** Читает файл целиком в память (для рендереров, которым нужны байты: Office, архивы). */
  readBytes(): Promise<ArrayBuffer>;
```

- [x] **Step 5: Маппинг типов**

В `file-kind.ts` дополнить `KINDS_BY_MIME`:
```ts
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-word.document.macroEnabled.12': 'word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12': 'spreadsheet',
```
и `KINDS_BY_EXTENSION`: `docx: 'word'`, `docm: 'word'`, `xlsx: 'spreadsheet'`, `xlsm: 'spreadsheet'`.

- [x] **Step 6: Реализовать `readSourceBytes`**

Create `packages/file-viewer/src/frontend/lib/read-source.ts`:

```ts
import type { FileSource } from '../../contracts/index.js';

/** Читает файл целиком. За авторизацию URL отвечает потребитель: сессионная кука уходит на same-origin. */
export async function readSourceBytes(source: FileSource): Promise<ArrayBuffer> {
  if (source.type === 'url') {
    const response = await fetch(source.url, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const blob = source.type === 'file' ? source.file : source.blob;
  return blob.arrayBuffer();
}
```

- [x] **Step 7: Прокинуть `readBytes` в `useResolvedSource`**

В `use-resolved-source.ts`:
- в интерфейс `ResolvedSource` добавить `readBytes(): Promise<ArrayBuffer>;`
- добавить `import { readSourceBytes } from './read-source.js';`
- рядом с `readText`:
```ts
const readBytes = useCallback((): Promise<ArrayBuffer> => {
  if (!source) return Promise.reject(new Error('Источник не задан'));
  return readSourceBytes(source);
}, [source]);
```
- в возвращаемый объект добавить `readBytes`.

В `packages/file-viewer/src/frontend/components/file-preview.tsx` в `<Renderer ... />` добавить проп `readBytes={resolved.readBytes}`.

- [x] **Step 8: Прогнать тесты — проходят**

Run: `pnpm --filter @amplicada/file-viewer build && pnpm --filter @amplicada/file-viewer test`
Expected: PASS (`file-kind.test.js`, `read-source.test.js`).

- [x] **Step 9: Commit**

```bash
git add packages/file-viewer/package.json packages/file-viewer/src/contracts/index.ts packages/file-viewer/src/frontend/lib/file-kind.ts packages/file-viewer/src/frontend/lib/read-source.ts packages/file-viewer/src/frontend/lib/use-resolved-source.ts packages/file-viewer/src/frontend/components/file-preview.tsx packages/file-viewer/src/frontend/lib/file-kind.test.ts packages/file-viewer/src/frontend/lib/read-source.test.ts
git commit -m "feat(file-viewer): Office file kinds and readBytes source access"
```

---

### Task 4: Office-рендереры (docx/xlsx) через `@silurus/ooxml`

**Files:**
- Modify: `packages/file-viewer/package.json` (dependency `@silurus/ooxml`)
- Create: `packages/file-viewer/src/frontend/renderers/word.tsx`
- Create: `packages/file-viewer/src/frontend/renderers/spreadsheet.tsx`
- Modify: `packages/file-viewer/src/frontend/renderers/registry.ts`
- Verify: `/tmp/opencode/verify-office.mjs` (Playwright)

**Interfaces:**
- Consumes: `RendererProps.readBytes()` (Task 3), `PreviewLoader`, `useFileViewer`, `ExternalRenderer` (фолбэк); `@silurus/ooxml/docx` → `DocxScrollViewer`, `@silurus/ooxml/xlsx` → `XlsxViewer`.
- Produces: рендереры `word` и `spreadsheet` в `defaultRenderers`; при ошибке загрузки/рендера — external-карточка.

- [x] **Step 1: Установить зависимость**

```bash
pnpm --filter @amplicada/file-viewer add @silurus/ooxml@0.88.0
```
Затем в `packages/file-viewer/package.json` убедиться, что в `"dependencies"` стоит точный `"@silurus/ooxml": "0.88.0"` (pnpm может поставить `^`, если передать не тот формат — поправить вручную и выполнить `pnpm install`).

- [x] **Step 2: Рендерер DOCX**

Create `packages/file-viewer/src/frontend/renderers/word.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { RendererProps } from '../../contracts/index.js';
import { PreviewLoader } from '../components/preview-loader.js';
import ExternalRenderer from './external.js';

type Status = 'loading' | 'ready' | 'error';

/** Ленивый рендерер DOCX: Rust/WASM-парсер, Canvas-отрисовка, read-only. */
export default function WordRenderer(props: RendererProps) {
  const { readBytes, url } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const readRef = useRef(readBytes);
  readRef.current = readBytes;
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let alive = true;
    let viewer: { destroy(): void } | null = null;
    setStatus('loading');
    (async () => {
      const { DocxScrollViewer } = await import('@silurus/ooxml/docx');
      const bytes = await readRef.current();
      if (!alive || !hostRef.current) return;
      const instance = new DocxScrollViewer(hostRef.current);
      viewer = instance;
      await instance.load(bytes);
      if (alive) setStatus('ready');
    })().catch(() => {
      if (alive) setStatus('error');
    });
    return () => {
      alive = false;
      viewer?.destroy();
    };
  }, [url]);

  if (status === 'error') return <ExternalRenderer {...props} />;

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {status === 'loading' && <PreviewLoader />}
    </div>
  );
}
```

`useEffect` зависит только от `url`, а `readBytes` берётся из ref: иначе новый объект `source` на каждый рендер родителя перезапускал бы загрузку.

- [x] **Step 3: Рендерер XLSX**

Create `packages/file-viewer/src/frontend/renderers/spreadsheet.tsx` — то же, но `XlsxViewer`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { RendererProps } from '../../contracts/index.js';
import { PreviewLoader } from '../components/preview-loader.js';
import ExternalRenderer from './external.js';

type Status = 'loading' | 'ready' | 'error';

/** Ленивый рендерер XLSX: Rust/WASM-парсер, Canvas-сетка с вкладками листов. */
export default function SpreadsheetRenderer(props: RendererProps) {
  const { readBytes, url } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const readRef = useRef(readBytes);
  readRef.current = readBytes;
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let alive = true;
    let viewer: { destroy(): void } | null = null;
    setStatus('loading');
    (async () => {
      const { XlsxViewer } = await import('@silurus/ooxml/xlsx');
      const bytes = await readRef.current();
      if (!alive || !hostRef.current) return;
      const instance = new XlsxViewer(hostRef.current);
      viewer = instance;
      await instance.load(bytes);
      if (alive) setStatus('ready');
    })().catch(() => {
      if (alive) setStatus('error');
    });
    return () => {
      alive = false;
      viewer?.destroy();
    };
  }, [url]);

  if (status === 'error') return <ExternalRenderer {...props} />;

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {status === 'loading' && <PreviewLoader />}
    </div>
  );
}
```

- [x] **Step 4: Зарегистрировать рендереры**

В `registry.ts`:

```ts
const wordRenderer: RendererPlugin = {
  id: 'word',
  match: descriptor => fileKindOf(descriptor) === 'word',
  component: lazy(() => import('./word.js')),
};

const spreadsheetRenderer: RendererPlugin = {
  id: 'spreadsheet',
  match: descriptor => fileKindOf(descriptor) === 'spreadsheet',
  component: lazy(() => import('./spreadsheet.js')),
};
```
И в `defaultRenderers` добавить `wordRenderer, spreadsheetRenderer` перед `externalRenderer`.

- [x] **Step 5: Сборка**

Run: `pnpm build`
Expected: успех. Проверить, что в выводе сборки `apps/web` для Office-рендереров и WASM появились **отдельные** чанки (не в основном бандле).

- [x] **Step 6: Живой Playwright-сценарий (проверка)**

Поднять dev. Скрипт `/tmp/opencode/verify-office.mjs`:
1. Логин, затем `page.context().request.post` multipart — загрузить реальные `sample-1.docx` и `sample-1.xlsx`:
   - `https://raw.githubusercontent.com/yukiyokotani/office-open-xml-viewer/main/packages/docx/public/demo/sample-1.docx`
   - `https://raw.githubusercontent.com/yukiyokotani/office-open-xml-viewer/main/packages/xlsx/public/demo/sample-1.xlsx`
   (скачать `ctx.request.get(...)` в `Buffer`, затем загрузить в `/api/admin/storage/objects?prefix=`).
2. Открыть `/admin/storage`, превью `sample-1.docx` → дождаться `canvas` внутри диалога (`waitForSelector('canvas')`), `waitForTimeout(4000)`, скриншот.
3. То же для `sample-1.xlsx` (проверить наличие вкладок листов).
4. Собрать `pageerror`/`console.error` — должно быть пусто.

Run: `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright node /tmp/opencode/verify-office.mjs`
Expected: на скриншотах — отрендеренные Word-страница и Excel-сетка; ошибок нет.

- [x] **Step 7: Commit**

```bash
git add packages/file-viewer/package.json pnpm-lock.yaml packages/file-viewer/src/frontend/renderers/word.tsx packages/file-viewer/src/frontend/renderers/spreadsheet.tsx packages/file-viewer/src/frontend/renderers/registry.ts
git commit -m "feat(file-viewer): lazy docx/xlsx preview via @silurus/ooxml"
```

---

### Task 5: Документация и заметки

**Files:**
- Modify: `ref/notes/file-viewer.md`
- Modify: `ref/notes/module-admin.md`
- Modify: `packages/file-viewer/docs/index.md`, `packages/file-viewer/docs/reference/file-viewer.md`
- Modify: `packages/module-admin/docs/reference/storage.md`
- Modify: `ref/plans/2026-09-19-storage-preview-editor.md`
- Modify: `ref/plans/2026-09-29-admin-storage-roadmap.md`
- Modify: `ref/context.md`
- Modify: `ref/README.md` (статусы планов)

**Interfaces:** нет кода; документация по формату скилла `.agents/skills/module-docs/`.

- [x] **Step 1: Заметки `file-viewer`**

В `ref/notes/file-viewer.md`:
- Добавить **D-005. Office — клиентский WASM/Canvas-рендерер вместо запрета конвертации** (accepted). Контекст: D-002 отклонял клиентскую конвертацию; появился `@silurus/ooxml` (Rust/WASM, Canvas, read-only, MIT, 0 deps). Решение: docx→`word`, xlsx→`spreadsheet`, лениво; `.doc/.xls` — external. Отвергнуто: документ-сервер Collabora/ONLYOFFICE (инфра), облачные вьюеры (приватность), серверная конвертация (инфра). Риск: pre-1.0, AI-generated. Что изменит: требование редактирования Office.
- Добавить **D-006. Правка текста подключена через `PUT`** (accepted): роут в `module-admin`, `mode="edit"`.
- В блоке цитаты вверху добавить строки-дайджесты D-005/D-006.
- В «Пробелы» удалить «Правка пока не подключена…», обновить про Office.

- [x] **Step 2: Заметки `module-admin`**

В D-004 дописать абзац: добавлен `PUT /storage/objects` (JSON `{content}`, `bodyLimit` 8 МБ, сохранение `contentType`), UI подключён через `mode="edit"`/`onSave`.

- [x] **Step 3: Потребительские docs**

- `packages/file-viewer/docs/index.md`: в «Публичная поверхность» добавить рендереры `word`/`spreadsheet` и `readBytes`; в «Freshness» — обновить; убрать строку «режим правки не проверен».
- `packages/file-viewer/docs/reference/file-viewer.md`: описать kinds `word|spreadsheet`, `readBytes`, зависимость `@silurus/ooxml` (pin, лицензия, размер), фолбэк на external.
- `packages/module-admin/docs/reference/storage.md`: в таблицу HTTP API добавить `PUT /storage/objects?key=`; из «Ограничения» убрать «Правки файлов нет».

- [x] **Step 4: Планы и контекст**

- `ref/plans/2026-09-19-storage-preview-editor.md`: в шапке и блоке «Реализовано» отметить правку и Office; при необходимости `status: superseded` с указанием на roadmap.
- `ref/plans/2026-09-29-admin-storage-roadmap.md`: отметить галочками пункты итерации 1.
- `ref/context.md`: в таблицу ключевиков добавить строку про `PUT /storage/objects`, правку текста и Office-рендереры `@silurus/ooxml`.
- `ref/README.md`: обновить статусы строк `file-viewer`/`module-admin`/планов при необходимости.

- [x] **Step 5: Commit**

```bash
git add ref packages/file-viewer/docs packages/module-admin/docs
git commit -m "docs: text editing and Office preview"
```

---

## Self-Review

- **Spec coverage:** правка текста (Task 1–2), Office docx/xlsx (Task 3–4), docs (Task 5). Плитка/Explorer-UI — вне этого плана, отдельным (итерация 2).
- **Step scan:** тесты содержат точные ассерты; шаги-реализации задают сигнатуры и значения (bodyLimit, contentType-фолбэк), тела — где алгоритм не очевиден (эффект рендерера с ref).
- **Type consistency:** `readBytes()` одинаков в контракте, `ResolvedSource`, `readSourceBytes` и рендерерах; `FileKind` расширен в одном месте и используется в `file-kind.ts`/`registry.ts`; имена тестов совпадают с командами.
- **Review Focus → tests:** 400/404/413/UTF-8 — Task 1; `.doc/.xls → other` — Task 3; Office-fallback на ошибке — Task 4 Step 6 (сценарий с валидными файлами; фолбэк проверяется тем, что битые dummy-объекты в бакете дают карточку, не краш).
- **Proportion:** код в шагах — тесты и сигнатуры; тела компонентов приведены целиком только там, где их определяет нетривиальная логика жизненного цикла (ref + cleanup).
