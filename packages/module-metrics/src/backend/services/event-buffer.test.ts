import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewMetricEventRow } from '../schemas/index.js';
import { EventBuffer } from './event-buffer.js';

function row(id: string): NewMetricEventRow {
  return { id, occurredAt: new Date(), name: 'support.thread.opened', kind: 'business', attributes: {}, measures: {} };
}

test('буфер копит и отдаёт события, вытесняя старые при переполнении', () => {
  const buffer = new EventBuffer(3);
  buffer.push(row('1'));
  buffer.push(row('2'));
  buffer.push(row('3'));
  buffer.push(row('4'));
  assert.equal(buffer.size(), 3);
  const drained = buffer.drain();
  assert.deepEqual(
    drained.map(item => item.id),
    ['2', '3', '4'],
  );
  assert.equal(buffer.size(), 0);
});
