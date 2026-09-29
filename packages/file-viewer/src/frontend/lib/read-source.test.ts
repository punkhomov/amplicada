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

test('URL с ошибочным статусом бросает с адресом', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
  try {
    await assert.rejects(() => readSourceBytes({ type: 'url', url: '/api/missing' }), /HTTP 404 \/api\/missing/);
  } finally {
    globalThis.fetch = original;
  }
});

test('blob читается без fetch', async () => {
  const bytes = await readSourceBytes({ type: 'blob', blob: new Blob([new Uint8Array([7, 8])]), name: 'b' });
  assert.deepEqual([...new Uint8Array(bytes)], [7, 8]);
});

test('file читается через arrayBuffer', async () => {
  const bytes = await readSourceBytes({ type: 'file', file: new File([new Uint8Array([9, 10, 11])], 'f.bin') });
  assert.deepEqual([...new Uint8Array(bytes)], [9, 10, 11]);
});
