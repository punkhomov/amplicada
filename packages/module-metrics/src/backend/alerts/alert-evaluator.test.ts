import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AlertCondition } from '../../contracts/index.js';
import { decideAlertState, isBreaching } from './alert-evaluator.js';

function threshold(op: 'gt' | 'gte' | 'lt' | 'lte', value: number): AlertCondition {
  return { kind: 'threshold', op, value };
}

test('isBreaching сравнивает значение с условием', () => {
  assert.equal(isBreaching(6, threshold('gt', 5)), true);
  assert.equal(isBreaching(5, threshold('gt', 5)), false);
  assert.equal(isBreaching(5, threshold('gte', 5)), true);
  assert.equal(isBreaching(4, threshold('lt', 5)), true);
  assert.equal(isBreaching(5, threshold('lte', 5)), true);
});

test('без forMs условие сразу даёт firing, спокойствие ничего не создаёт', () => {
  const now = 1_000_000;
  assert.deepEqual(decideAlertState(null, false, 0, now), { state: 'pending', emit: null, remove: true });
  assert.deepEqual(decideAlertState(null, true, 0, now), { state: 'firing', emit: 'alert', remove: false });
});

test('pending держится forMs, затем становится firing', () => {
  const now = 1_000_000;
  const first = decideAlertState(null, true, 60_000, now);
  assert.equal(first.state, 'pending');
  assert.equal(first.emit, null);

  const early = decideAlertState({ state: 'pending', activeAt: new Date(now), value: 1 }, true, 60_000, now + 30_000);
  assert.equal(early.state, 'pending');

  const late = decideAlertState({ state: 'pending', activeAt: new Date(now), value: 1 }, true, 60_000, now + 60_000);
  assert.equal(late.state, 'firing');
  assert.equal(late.emit, 'alert');
});

test('pending снимается без firing, firing резолвится при спокойствии', () => {
  const now = 1_000_000;
  const cancelled = decideAlertState({ state: 'pending', activeAt: new Date(now), value: 1 }, false, 60_000, now + 10_000);
  assert.deepEqual(cancelled, { state: 'pending', emit: null, remove: true });

  const resolved = decideAlertState({ state: 'firing', activeAt: new Date(now), value: 1 }, false, 0, now + 10_000);
  assert.equal(resolved.state, 'resolved');
  assert.equal(resolved.emit, 'resolved');

  const stillFiring = decideAlertState({ state: 'firing', activeAt: new Date(now), value: 1 }, true, 0, now + 10_000);
  assert.equal(stillFiring.state, 'firing');
  assert.equal(stillFiring.emit, null);
});
