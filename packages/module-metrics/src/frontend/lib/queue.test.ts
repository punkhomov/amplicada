import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClientEventInput } from '../../contracts/index.js';
import { chunkEvents, MetricsQueue } from './queue.js';
import { currentSessionId, type KeyValueStorage } from './session.js';

function event(id: string, payload = ''): ClientEventInput {
  return {
    id,
    name: 'page.view',
    kind: 'page',
    occurredAt: new Date().toISOString(),
    attributes: payload ? { payload } : {},
  };
}

test('очередь вытесняет старые события и очищается через drain', () => {
  const queue = new MetricsQueue();
  for (let i = 0; i < 250; i += 1) queue.push(event(`event-${i}`));
  assert.equal(queue.size(), 200);
  const drained = queue.drain();
  assert.equal(drained.length, 200);
  assert.equal(drained[0].id, 'event-50');
  assert.equal(queue.size(), 0);
});

test('chunkEvents режет по числу и по байтам', () => {
  const many = Array.from({ length: 45 }, (_, i) => event(`event-${i}`));
  const byCount = chunkEvents(many, 20);
  assert.deepEqual(
    byCount.map(chunk => chunk.length),
    [20, 20, 5],
  );

  const big = [event('event-a', 'x'.repeat(600)), event('event-b', 'y'.repeat(600))];
  const byBytes = chunkEvents(big, 20, 1024);
  assert.equal(byBytes.length, 2);
});

test('сессия живёт 30 минут неактивности и ротируется', () => {
  const store = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  };

  const start = Date.now();
  const first = currentSessionId(start, storage);
  assert.equal(currentSessionId(start + 10 * 60 * 1000, storage), first);
  assert.notEqual(currentSessionId(start + 40 * 60 * 1000, storage), first);
});
