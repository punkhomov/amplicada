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
