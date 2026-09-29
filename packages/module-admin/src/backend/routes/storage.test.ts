import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BackendSetupContext, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import Fastify from 'fastify';
import { createStorageRoutes } from './storage.js';

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

/**
 * `head` — переопределение ответа `headObject` (в т.ч. `null`); без него `notes/a.json` существует,
 * остальное нет. `editEnabled` выставляет env-флаг до регистрации роутов: по умолчанию в тестах
 * правка включена, чтобы проверять сам роут, а поведение «выключено» проверяется отдельным тестом.
 */
function appWith(head?: HeadResult | null, editEnabled = true) {
  if (editEnabled) process.env.STORAGE_EDIT_ENABLED = 'true';
  else delete process.env.STORAGE_EDIT_ENABLED;
  const puts: PutCall[] = [];
  const storage = {
    putObject: async (key: string, body: unknown, options?: { contentType?: string }) => {
      puts.push({ key, body, contentType: options?.contentType });
    },
    headObject: async (key: string) => {
      if (head !== undefined) return head;
      return key === 'notes/a.json' ? { key, size: 1, contentType: 'application/json' } : null;
    },
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

test('PUT текста почти 8 МБ сохраняется, не 413', async () => {
  const { app, puts } = appWith();
  const content = 'x'.repeat(8 * 1024 * 1024 - 1024);
  const res = await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content } });
  assert.equal(res.statusCode, 200);
  assert.equal(puts[0].body, content);
});

test('PUT подставляет text/plain, когда у объекта нет contentType', async () => {
  const { app, puts } = appWith({ key: 'notes/a.json', size: 1, contentType: undefined });
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
  const { app, puts } = appWith(undefined, false);
  const put = await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content: 'x' } });
  assert.equal(put.statusCode, 404);
  assert.equal(puts.length, 0);
  const config = await app.inject({ method: 'GET', url: '/storage/config' });
  assert.equal(config.statusCode, 200);
  assert.deepEqual(config.json(), { editEnabled: false });
});

test('с STORAGE_EDIT_ENABLED=true PUT зарегистрирован, config.editEnabled=true', async () => {
  const { app } = appWith(undefined, true);
  const config = await app.inject({ method: 'GET', url: '/storage/config' });
  assert.equal(config.statusCode, 200);
  assert.deepEqual(config.json(), { editEnabled: true });
  const put = await app.inject({ method: 'PUT', url: '/storage/objects?key=notes/a.json', payload: { content: 'x' } });
  assert.equal(put.statusCode, 200);
});
