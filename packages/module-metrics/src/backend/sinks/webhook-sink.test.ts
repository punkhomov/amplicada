import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SinkConfigRow } from '../schemas/index.js';
import { isRetryableStatus, matchesEventFilter, nextAttemptDelayMs } from './sink.js';
import { createWebhookSink } from './webhook-sink.js';

function config(settings: Record<string, unknown>): SinkConfigRow {
  return {
    id: 'webhook',
    enabled: true,
    settings,
    mapping: {},
    updatedAt: new Date(),
  };
}

test('backoff растёт экспоненциально и упирается в час', () => {
  assert.equal(nextAttemptDelayMs(1), 30_000);
  assert.equal(nextAttemptDelayMs(2), 60_000);
  assert.equal(nextAttemptDelayMs(3), 120_000);
  assert.equal(nextAttemptDelayMs(10), 60 * 60 * 1000);
});

test('фильтр событий: пусто — всё, префикс и точное имя', () => {
  assert.equal(matchesEventFilter('support.thread.opened', []), true);
  assert.equal(matchesEventFilter('support.thread.opened', ['support.*']), true);
  assert.equal(matchesEventFilter('support.thread.opened', ['support.thread.opened']), true);
  assert.equal(matchesEventFilter('page.view', ['support.*']), false);
});

test('ретраятся 429 и 5xx, не ретраятся 4xx', () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
});

test('webhook подписывает тело и классифицирует ответы', async () => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body) });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;

  const sink = createWebhookSink({ getSecret: name => (name === 'metrics.webhook_secret' ? 's3cret' : undefined), fetchImpl });
  const items = [{ id: 'evt-1', kind: 'event' as const, payload: { name: 'page.view' } }];
  const result = await sink.send(items, config({ url: 'https://example.test/hook' }), new AbortController().signal);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].headers['x-metrics-signature']?.startsWith('sha256='));
  assert.deepEqual(JSON.parse(calls[0].body), { items });

  const failing = createWebhookSink({
    getSecret: () => undefined,
    fetchImpl: (async () => new Response('nope', { status: 400 })) as typeof fetch,
  });
  const failed = await failing.send(items, config({ url: 'https://example.test/hook' }), new AbortController().signal);
  assert.equal(failed.ok, false);
  assert.equal(failed.retryable, false);
  assert.equal(failed.error, 'HTTP 400');

  const noUrl = await failing.send(items, config({}), new AbortController().signal);
  assert.equal(noUrl.retryable, false);
  assert.match(noUrl.error ?? '', /url/);
});
