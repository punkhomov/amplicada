import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ApiError, createApiClient } from './api-client.js';

/**
 * Текст серверной ошибки на клиенте.
 *
 * Проверяется здесь, а не на глаз, потому что от этого зависят все обработчики платформы разом:
 * они отвечают `{ error: '…' }`, а клиент раньше читал только `message` — и человек видел
 * «Request failed with status 409» вместо причины отказа.
 */

function respondWith(status: number, body: unknown, contentType = 'application/json'): void {
  mock.method(globalThis, 'fetch', async () => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(payload, { status, headers: { 'content-type': contentType } });
  });
}

async function failureOf(status: number, body: unknown, contentType?: string): Promise<ApiError> {
  respondWith(status, body, contentType);
  try {
    await createApiClient({ baseUrl: '/api' }).get('/anything');
  } catch (error) {
    assert.ok(error instanceof ApiError);
    return error;
  } finally {
    mock.restoreAll();
  }
  throw new Error('запрос должен был отказать');
}

test('текст из { error } наших роутов доезжает до клиента', async () => {
  const error = await failureOf(409, { error: 'По этому пакету есть попытки прохождения — удалить его нельзя' });

  assert.equal(error.status, 409);
  assert.equal(error.message, 'По этому пакету есть попытки прохождения — удалить его нельзя');
});

test('у ошибки Fastify берётся message, а не название статуса из error', async () => {
  // Fastify кладёт в `error` название статуса, а суть — в `message`. Предпочти мы `error`, человек
  // читал бы «Not Found» вместо того, какой именно маршрут не найден.
  const error = await failureOf(404, { statusCode: 404, error: 'Not Found', message: 'Route GET:/api/nope not found' });

  assert.equal(error.message, 'Route GET:/api/nope not found');
});

test('без внятного текста остаётся статус, а не пустая строка', async () => {
  for (const body of [{}, { error: '   ' }, { error: 42 }]) {
    const error = await failureOf(500, body);
    assert.equal(error.message, 'Request failed with status 500', JSON.stringify(body));
  }
});

test('не-JSON ответ не роняет разбор', async () => {
  const error = await failureOf(502, '<html>Bad Gateway</html>', 'text/html');

  assert.equal(error.message, 'Request failed with status 502');
  assert.equal(error.data, '<html>Bad Gateway</html>');
});

test('успешный ответ разбирается как раньше', async () => {
  respondWith(200, { packages: [] });
  try {
    assert.deepEqual(await createApiClient({ baseUrl: '/api' }).get('/learning/courses/x/packages'), { packages: [] });
  } finally {
    mock.restoreAll();
  }
});
