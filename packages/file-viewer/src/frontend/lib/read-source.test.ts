import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSourceBytes, readSourceText } from './read-source.js';

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

test('окно URL запрашивается Range с offset и limit', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(new Uint8Array([0x41, 0x42, 0x43]), {
      status: 206,
      headers: { 'content-range': 'bytes 2048-2050/100000' },
    });
  }) as typeof fetch;
  try {
    const result = await readSourceText({ type: 'url', url: '/api/x', size: 100000 }, { limitBytes: 3, offsetBytes: 2048 });
    assert.equal(calls[0].init?.headers && (calls[0].init.headers as Record<string, string>).Range, 'bytes=2048-2050');
    assert.equal(result.text, 'ABC');
    assert.equal(result.truncated, true);
    assert.equal(result.nextOffsetBytes, 2051);
  } finally {
    globalThis.fetch = original;
  }
});

test('окно URL обрезается по целой кодовой точке, nextOffset возвращает стык', async () => {
  const original = globalThis.fetch;
  // Окно: 'A' + первые два байта '€' (E2 82 AC) — символ разрезан границей окна.
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([0x41, 0xe2, 0x82]), {
      status: 206,
      headers: { 'content-range': 'bytes 0-2/10' },
    })) as typeof fetch;
  try {
    const result = await readSourceText({ type: 'url', url: '/api/x' }, { limitBytes: 3, offsetBytes: 0 });
    assert.equal(result.text, 'A');
    assert.equal(result.truncated, true);
    assert.equal(result.nextOffsetBytes, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('окно URL на конце файла не выставляет nextOffset', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([0x41, 0x42, 0x43]), {
      status: 206,
      headers: { 'content-range': 'bytes 0-2/3' },
    })) as typeof fetch;
  try {
    const result = await readSourceText({ type: 'url', url: '/api/x' }, { limitBytes: 3, offsetBytes: 0 });
    assert.equal(result.text, 'ABC');
    assert.equal(result.truncated, false);
    assert.equal(result.nextOffsetBytes, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test('окно URL без content-range и size: сообщает о возможном продолжении по полному окну', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new Uint8Array([0x41, 0x42, 0x43]), { status: 206 })) as typeof fetch;
  try {
    const result = await readSourceText({ type: 'url', url: '/api/x' }, { limitBytes: 3, offsetBytes: 0 });
    assert.equal(result.truncated, true);
    assert.equal(result.nextOffsetBytes, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('окно URL с невалидного байта в начале не застревает: nextOffset строго растёт', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([0xff, 0x41]), {
      status: 206,
      headers: { 'content-range': 'bytes 0-1/100' },
    })) as typeof fetch;
  try {
    const result = await readSourceText({ type: 'url', url: '/api/x' }, { limitBytes: 2, offsetBytes: 5 });
    assert.equal(result.truncated, true);
    assert.equal(result.nextOffsetBytes, 6);
  } finally {
    globalThis.fetch = original;
  }
});

test('blob читается окном через slice с тем же UTF-8-безопасным стыком', async () => {
  // 'A€B' = 41 E2 82 AC 42.
  const blob = new Blob([new Uint8Array([0x41, 0xe2, 0x82, 0xac, 0x42])]);
  const first = await readSourceText({ type: 'blob', blob, name: 't.txt' }, { limitBytes: 2, offsetBytes: 0 });
  assert.equal(first.text, 'A');
  assert.equal(first.truncated, true);
  assert.equal(first.nextOffsetBytes, 1);
  const second = await readSourceText({ type: 'blob', blob, name: 't.txt' }, { limitBytes: 3, offsetBytes: 1 });
  assert.equal(second.text, '€');
  assert.equal(second.truncated, true);
  assert.equal(second.nextOffsetBytes, 4);
  const third = await readSourceText({ type: 'blob', blob, name: 't.txt' }, { limitBytes: 3, offsetBytes: 4 });
  assert.equal(third.text, 'B');
  assert.equal(third.truncated, false);
  assert.equal(third.nextOffsetBytes, undefined);
});
