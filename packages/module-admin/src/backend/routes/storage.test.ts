import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BackendSetupContext, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import Fastify from 'fastify';
import { createStorageRoutes, folderKey, isDescendant, moveTargetOf } from './storage.js';

interface PutCall {
  key: string;
  body: unknown;
  contentType?: string;
}

interface HeadResult {
  key: string;
  size: number;
  contentType?: string;
}

interface MoveCall {
  from: string;
  to: string;
}

interface ListCall {
  prefix: string;
  options?: { delimiter?: string; maxKeys?: number; continuationToken?: string };
}

interface FakeOptions {
  /** Переопределение ответа `headObject` (в т.ч. `null`) для любого ключа; без него смотрится бакет. */
  head?: HeadResult | null;
  /** Правка текста: env-флаг выставляется до регистрации роутов; по умолчанию в тестах включена. */
  editEnabled?: boolean;
  /** Дополнительные существующие объекты поверх набора по умолчанию — например, цель коллизии. */
  objects?: string[];
  /** Содержимое «папок»: префикс → полные ключи объектов, как их отдаёт рекурсивный листинг. */
  folderContents?: Record<string, string[]>;
  /** Дополнительные поля ответа `listObjects` поверх вычисленных: токен продолжения и подмена префиксов. */
  listing?: { nextToken?: string; prefixes?: string[] };
}

/**
 * Фейковый бакет: и `headObject`, и `listObjects` смотрят в один набор, поэтому копирование и
 * удаление видны последующим проверкам. В наборе по умолчанию — текстовый объект для PUT и
 * объект для перемещения; `head` переопределяет ответ `headObject` целиком (нужен для проверки
 * веток «объекта нет» и «нет contentType»).
 */
function appWith({ head, editEnabled = true, objects: seeded = [], folderContents = {}, listing }: FakeOptions = {}) {
  if (editEnabled) process.env.STORAGE_EDIT_ENABLED = 'true';
  else delete process.env.STORAGE_EDIT_ENABLED;
  const puts: PutCall[] = [];
  const moves: MoveCall[] = [];
  const deletes: string[][] = [];
  const listings: ListCall[] = [];
  const objects = new Map<string, HeadResult>([
    ['notes/a.json', { key: 'notes/a.json', size: 1, contentType: 'application/json' }],
    ['a/f.txt', { key: 'a/f.txt', size: 1 }],
  ]);
  for (const key of seeded) objects.set(key, { key, size: 1 });
  for (const [prefix, keys] of Object.entries(folderContents)) {
    objects.set(prefix, { key: prefix, size: 1 });
    for (const key of keys) objects.set(key, { key, size: 1 });
  }
  const storage = {
    putObject: async (key: string, body: unknown, options?: { contentType?: string }) => {
      puts.push({ key, body, contentType: options?.contentType });
      objects.set(key, { key, size: 0, contentType: options?.contentType });
    },
    headObject: async (key: string) => {
      if (head !== undefined) return head;
      return objects.get(key) ?? null;
    },
    listObjects: async (prefix = '', options?: ListCall['options']) => {
      listings.push({ prefix, options });
      const matching = [...objects.values()].filter(object => object.key.startsWith(prefix));
      if (!options?.delimiter) return { objects: matching, prefixes: [], nextToken: listing?.nextToken };
      const prefixes = new Set<string>();
      const atLevel: HeadResult[] = [];
      for (const object of matching) {
        const cut = object.key.slice(prefix.length).indexOf(options.delimiter);
        if (cut === -1) atLevel.push(object);
        else prefixes.add(object.key.slice(0, prefix.length + cut + 1));
      }
      return { objects: atLevel, prefixes: listing?.prefixes ?? [...prefixes], nextToken: listing?.nextToken };
    },
    copyObject: async (fromKey: string, toKey: string) => {
      moves.push({ from: fromKey, to: toKey });
      objects.set(toKey, { key: toKey, size: 1 });
    },
    deleteObject: async (key: string) => {
      objects.delete(key);
    },
    deleteObjects: async (keys: string[]) => {
      deletes.push(keys);
      for (const key of keys) objects.delete(key);
      return keys.length;
    },
  } as unknown as BackendStorageService;
  const context = { services: { resolve: () => storage } } as unknown as BackendSetupContext;
  const app = Fastify();
  createStorageRoutes(app, context);
  return { app, puts, moves, deletes, listings };
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

test('PUT текста почти 8 МБ сохраняется, не 413', async () => {
  const { app, puts } = appWith();
  const content = 'x'.repeat(8 * 1024 * 1024 - 1024);
  const res = await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content } });
  assert.equal(res.statusCode, 200);
  assert.equal(puts[0].body, content);
});

test('PUT подставляет text/plain, когда у объекта нет contentType', async () => {
  const { app, puts } = appWith({ head: { key: 'notes/a.json', size: 1, contentType: undefined } });
  const res = await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content: 'x' } });
  assert.equal(res.statusCode, 200);
  assert.equal(puts[0].contentType, 'text/plain; charset=utf-8');
});

test('PUT сохраняет кириллицу без искажений', async () => {
  const { app, puts } = appWith();
  await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content: 'привет' } });
  assert.equal(puts[0].body, 'привет');
  assert.equal((puts[0].body as string).length, 6);
  assert.equal(Buffer.byteLength(puts[0].body as string, 'utf8'), 12);
});

test('по умолчанию правка выключена: PUT не зарегистрирован, config.editEnabled=false', async () => {
  const { app, puts } = appWith({ editEnabled: false });
  const put = await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content: 'x' } });
  assert.equal(put.statusCode, 404);
  assert.equal(puts.length, 0);
  const config = await app.inject({ method: 'GET', url: '/storage/config' });
  assert.equal(config.statusCode, 200);
  assert.deepEqual(config.json(), { editEnabled: false });
});

test('с STORAGE_EDIT_ENABLED=true PUT зарегистрирован, config.editEnabled=true', async () => {
  const { app } = appWith({ editEnabled: true });
  const config = await app.inject({ method: 'GET', url: '/storage/config' });
  assert.equal(config.statusCode, 200);
  assert.deepEqual(config.json(), { editEnabled: true });
  const put = await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content: 'x' } });
  assert.equal(put.statusCode, 200);
});

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

test('POST /storage/folder на существующий префикс — 409 без записи', async () => {
  const { app, puts } = appWith({ objects: ['a/docs/'] });
  const res = await app.inject({ method: 'POST', url: '/storage/folder?prefix=a/', payload: { name: 'docs' } });
  assert.equal(res.statusCode, 409);
  assert.equal(puts.length, 0);
});

test('POST /storage/folder считает существующей папку с объектами, но без маркера', async () => {
  const { app, puts } = appWith({ objects: ['a/docs/readme.txt'] });
  const res = await app.inject({ method: 'POST', url: '/storage/folder?prefix=a/', payload: { name: 'docs' } });
  assert.equal(res.statusCode, 409);
  assert.equal(puts.length, 0);
});

test('POST /storage/move на существующую цель — 409 без копирования', async () => {
  const { app, moves } = appWith({ objects: ['b/f.txt'] });
  const res = await app.inject({ method: 'POST', url: '/storage/move', payload: { keys: ['a/f.txt'], destination: 'b' } });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(moves, []);
});

test('POST /storage/move несуществующего источника — 400 без копирования', async () => {
  const { app, moves } = appWith();
  const res = await app.inject({ method: 'POST', url: '/storage/move', payload: { keys: ['missing.txt'], destination: 'b' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(moves, []);
});

test('POST /storage/move отвергает пустой список, пустое назначение и «..»', async () => {
  const { app, moves } = appWith();
  const bodies = [
    { keys: [], destination: 'b' },
    { keys: ['a/f.txt'], destination: '' },
    { keys: ['a/f.txt'], destination: '   ' },
    { keys: ['a/f.txt'], destination: '../b' },
    { keys: ['../a/f.txt'], destination: 'b' },
  ];
  for (const payload of bodies) {
    const res = await app.inject({ method: 'POST', url: '/storage/move', payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(moves, []);
});

test('POST /storage/move c destination=/ переносит в корень бакета', async () => {
  const { app, moves } = appWith();
  const res = await app.inject({ method: 'POST', url: '/storage/move', payload: { keys: ['a/f.txt'], destination: '/' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(moves, [{ from: 'a/f.txt', to: 'f.txt' }]);
});

test('DELETE /storage/objects с пустым списком — 400 без удаления', async () => {
  const { app, deletes } = appWith();
  for (const payload of [{ keys: [] }, {}, { keys: [42] }]) {
    const res = await app.inject({ method: 'DELETE', url: '/storage/objects', payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(deletes.length, 0);
});

test('folderKey собирает ключ-маркер папки', () => {
  assert.equal(folderKey('a/', 'docs'), 'a/docs/');
  assert.equal(folderKey('', 'docs'), 'docs/');
});

test('moveTargetOf переносит имя элемента в папку назначения', () => {
  assert.equal(moveTargetOf('a/f.txt', 'b/'), 'b/f.txt');
  assert.equal(moveTargetOf('a/pkg/', 'b/'), 'b/pkg/');
  assert.equal(moveTargetOf('a/f.txt', ''), 'f.txt');
});

test('moveTargetOf с name заменяет хвост ключа (переименование)', () => {
  assert.equal(moveTargetOf('a/f.txt', 'a/', 'g.txt'), 'a/g.txt');
  assert.equal(moveTargetOf('a/pkg/', 'b/', 'lib'), 'b/lib/');
});

test('POST /storage/move c name переименовывает файл', async () => {
  const { app, moves } = appWith();
  const res = await app.inject({
    method: 'POST',
    url: '/storage/move',
    payload: { keys: ['a/f.txt'], destination: 'a/', name: 'g.txt' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { moved: 1 });
  assert.deepEqual(moves, [{ from: 'a/f.txt', to: 'a/g.txt' }]);
});

test('POST /storage/move c name переименовывает папку вместе с поддеревом', async () => {
  const { app, moves, deletes } = appWith({ folderContents: { 'a/pkg/': ['a/pkg/i.html', 'a/pkg/sub/j.txt'] } });
  const res = await app.inject({
    method: 'POST',
    url: '/storage/move',
    payload: { keys: ['a/pkg/'], destination: 'b/', name: 'lib' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(moves, [
    { from: 'a/pkg/i.html', to: 'b/lib/i.html' },
    { from: 'a/pkg/sub/j.txt', to: 'b/lib/sub/j.txt' },
  ]);
  assert.deepEqual(deletes, [['a/pkg/i.html', 'a/pkg/sub/j.txt']]);
});

test('POST /storage/move с name и несколькими ключами — 400 без копирования', async () => {
  const { app, moves } = appWith();
  const res = await app.inject({
    method: 'POST',
    url: '/storage/move',
    payload: { keys: ['a/f.txt', 'notes/a.json'], destination: 'c/', name: 'g.txt' },
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(moves, []);
});

test('POST /storage/move отвергает невалидное name', async () => {
  const { app, moves } = appWith();
  for (const name of ['', '..', 'x/y', 'x'.repeat(256)]) {
    const res = await app.inject({
      method: 'POST',
      url: '/storage/move',
      payload: { keys: ['a/f.txt'], destination: 'a/', name },
    });
    assert.equal(res.statusCode, 400, name);
  }
  assert.deepEqual(moves, []);
});

test('isDescendant отличает потомка от соседа и самой папки', () => {
  assert.equal(isDescendant('a/pkg/sub/j.txt', 'a/pkg/'), true);
  assert.equal(isDescendant('a/pkg/', 'a/pkg/'), false);
  assert.equal(isDescendant('a/pkg-old/', 'a/pkg/'), false);
  assert.equal(isDescendant('b/pkg/', 'a/pkg/'), false);
});

test('POST /storage/move дедуплицирует ключи', async () => {
  const { app, moves } = appWith();
  const res = await app.inject({
    method: 'POST',
    url: '/storage/move',
    payload: { keys: ['a/f.txt', 'a/f.txt'], destination: 'b' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { moved: 1 });
  assert.deepEqual(moves, [{ from: 'a/f.txt', to: 'b/f.txt' }]);
});

test('POST /storage/move отвергает два источника в один целевой ключ', async () => {
  const { app, moves } = appWith({ objects: ['x/f.txt', 'y/f.txt'] });
  const res = await app.inject({
    method: 'POST',
    url: '/storage/move',
    payload: { keys: ['x/f.txt', 'y/f.txt'], destination: 'z/' },
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(moves, []);
});

test('GET /storage/objects отдаёт страницу: limit уходит в core, nextToken возвращается', async () => {
  const { app, listings } = appWith({ listing: { nextToken: 'tok-2' }, folderContents: { 'a/sub/': ['a/sub/i.txt'] } });
  const res = await app.inject({ method: 'GET', url: '/storage/objects?prefix=a/&limit=2' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(listings, [{ prefix: 'a/', options: { delimiter: '/', maxKeys: 2, continuationToken: undefined } }]);
  assert.deepEqual(res.json(), {
    prefix: 'a/',
    prefixes: ['a/sub/'],
    objects: [{ key: 'a/f.txt', size: 1 }],
    nextToken: 'tok-2',
  });
});

test('GET /storage/objects передаёт cursor в core как continuationToken', async () => {
  const { app, listings } = appWith();
  const res = await app.inject({ method: 'GET', url: '/storage/objects?cursor=tok-2' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(listings, [{ prefix: '', options: { delimiter: '/', maxKeys: 200, continuationToken: 'tok-2' } }]);
});

test('GET /storage/objects с невалидным limit — 400 без вызова core', async () => {
  const { app, listings } = appWith();
  for (const limit of ['0', '1001', 'abc', '-1', '2.5', '']) {
    const res = await app.inject({ method: 'GET', url: `/storage/objects?limit=${limit}` });
    assert.equal(res.statusCode, 400, `limit=${limit}`);
    assert.ok(res.json().error);
  }
  assert.equal(listings.length, 0);
});

test('GET /storage/objects с пустым cursor — 400 без вызова core', async () => {
  const { app, listings } = appWith();
  const res = await app.inject({ method: 'GET', url: '/storage/objects?cursor=' });
  assert.equal(res.statusCode, 400);
  assert.equal(listings.length, 0);
});

test('GET /storage/objects без limit просит у core первую страницу по умолчанию (200)', async () => {
  const { app, listings } = appWith();
  const res = await app.inject({ method: 'GET', url: '/storage/objects?prefix=a/' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(listings, [{ prefix: 'a/', options: { delimiter: '/', maxKeys: 200, continuationToken: undefined } }]);
});
