import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { createMetricsService } from './metrics-service.js';
import { Pseudonymizer } from './pseudonym.js';
import type { IngestRateLimiter } from './rate-limiter.js';

function service() {
  return createMetricsService({
    db: {} as BackendDbService,
    pseudonymizer: new Pseudonymizer('test-secret-at-least-16-chars'),
    limiter: {} as IngestRateLimiter,
    getDefinitions: () => [],
  });
}

test('emit складывает бизнес-событие с псевдонимом актора и модулем', () => {
  const metrics = service();
  metrics.emit({
    name: 'support.thread.opened',
    module: 'support-chat',
    actor: { kind: 'user', userId: 'user-1' },
    attributes: { kind: 'question' },
  });
  metrics.emitBatch([{ name: 'support.message.sent', module: 'support-chat', attributes: { role: 'user' } }]);

  const rows = metrics.drainEmittedEvents();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'support.thread.opened');
  assert.equal(rows[0].kind, 'business');
  assert.equal(rows[0].module, 'support-chat');
  assert.equal(rows[0].actorKind, 'user');
  assert.ok(rows[0].actorHash);
  assert.deepEqual(rows[0].attributes, { kind: 'question' });

  // Без актора событие системное, псевдонима нет.
  assert.equal(rows[1].actorKind, 'system');
  assert.equal(rows[1].actorHash, null);
});

test('emit молча отбрасывает невалидные имена и kinds', () => {
  const metrics = service();
  metrics.emit({ name: 'Bad Name' });
  metrics.emit({ name: 'singleword' });
  metrics.emit({ name: 'support.ok', kind: 'nope' as never });
  assert.equal(metrics.drainEmittedEvents().length, 0);
});
