import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_EVENT_LIMITS, validateBatch, validateClientEvent } from './validation.js';

function pageView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '2f1c4c1e-9f0e-4b7a-8c3d-1234567890ab',
    name: 'page.view',
    kind: 'page',
    occurredAt: new Date().toISOString(),
    sessionId: 'session-1',
    context: { route: '/support/:id', url: '/support/2f1c', referrer: 'https://example.test' },
    attributes: { title: 'Обращение' },
    ...overrides,
  };
}

test('валидный page.view проходит, url вырезается без storeRawUrls', () => {
  const result = validateClientEvent(pageView());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.event.name, 'page.view');
  assert.equal(result.value.event.context?.route, '/support/:id');
  assert.equal(result.value.event.context?.url, undefined);
  assert.equal(result.value.overflow, 0);
});

test('url сохраняется при storeRawUrls', () => {
  const result = validateClientEvent(pageView(), { ...DEFAULT_EVENT_LIMITS, storeRawUrls: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.event.context?.url, '/support/2f1c');
});

test('битые поля отвергаются с причиной', () => {
  for (const [patch, reason] of [
    [{ id: 'short' }, 'invalid_id'],
    [{ name: 'bad name' }, 'invalid_name'],
    [{ name: 'singleword' }, 'invalid_name'],
    [{ kind: 'unknown' }, 'invalid_kind'],
    [{ occurredAt: 'not-a-date' }, 'invalid_occurred_at'],
    [{ occurredAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString() }, 'too_old'],
  ] as const) {
    const result = validateClientEvent(pageView(patch as Record<string, unknown>));
    assert.equal(result.ok, false, `ожидали отказ для ${String(Object.keys(patch)[0])}`);
    if (!result.ok) assert.equal(result.reason, reason);
  }
});

test('точечные ключи атрибутов сохраняются (error.type)', () => {
  const result = validateClientEvent(pageView({ attributes: { 'error.type': 'TypeError', simple: 'ok' } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.event.attributes, { 'error.type': 'TypeError', simple: 'ok' });
});

test('атрибуты: мусор отбрасывается, лишние уходят в overflow, строки обрезаются', () => {
  const attributes: Record<string, unknown> = { ok: 'x'.repeat(500) };
  for (let i = 0; i < 40; i += 1) attributes[`key_${i}`] = i;
  attributes['Bad-Key'] = 'no';
  const result = validateClientEvent(pageView({ attributes }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const attrs = result.value.event.attributes ?? {};
  const okValue = attrs.ok;
  assert.equal(typeof okValue === 'string' ? okValue.length : 0, DEFAULT_EVENT_LIMITS.maxStringLength);
  assert.equal(Object.keys(attrs).length, DEFAULT_EVENT_LIMITS.maxAttributes);
  assert.equal(attrs['Bad-Key'], undefined);
  assert.ok(result.value.overflow > 0);
});

test('батч: валидные принимаются, невалидные получают индекс и причину, лишние режутся', () => {
  const result = validateBatch({ events: [pageView(), { id: 'bad' }, pageView({ id: '2f1c4c1e-9f0e-4b7a-8c3d-1234567890ac' })] });
  assert.equal(result.accepted.length, 2);
  assert.deepEqual(result.rejected, [{ index: 1, reason: 'invalid_id' }]);
});

test('батч не-массив — invalid_body', () => {
  assert.deepEqual(validateBatch({}), { accepted: [], rejected: [{ index: 0, reason: 'invalid_body' }], overflow: 0 });
});
