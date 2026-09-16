import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerModules } from './module-registration.js';

test('invalid module composition causes no partial registrations', () => {
  const calls: string[] = [];
  const registry = {
    register(mod: { id: string }) {
      calls.push(mod.id);
    },
  };
  for (const input of [
    [{ id: 'valid' }, { id: 'broken', dependencies: ['missing'] }],
    [{ id: 'duplicate' }, { id: 'duplicate' }],
    [{ id: 'cycle', dependencies: ['cycle'] }],
  ]) {
    assert.throws(() =>
      registerModules(
        input.map(mod => ({ ...mod, name: mod.id, version: '1' })),
        registry,
      ),
    );
    assert.deepEqual(calls, []);
  }
});

test('all metadata is available to the first setup and executable module objects are preserved', () => {
  const registered: string[] = [];
  const calls: string[] = [];
  const registry = {
    register(mod: { id: string }) {
      registered.push(mod.id);
    },
  };
  const provider = {
    id: 'provider',
    name: 'Provider',
    version: '1',
    setup() {
      assert.deepEqual(registered, ['provider', 'consumer']);
      calls.push('provider');
    },
  };
  const consumer = {
    id: 'consumer',
    name: 'Consumer',
    version: '1',
    dependencies: ['provider'],
    setup() {
      calls.push('consumer');
    },
  };
  const ordered = registerModules([consumer, provider], registry);
  assert.equal(ordered[0], provider);
  for (const mod of ordered) mod.setup();
  assert.deepEqual(calls, ['provider', 'consumer']);
});
