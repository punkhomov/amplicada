import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortModules } from './module-graph.js';

test('sorts dependencies before consumers without mutating input or replacing modules', () => {
  const consumer = { id: 'requests', dependencies: ['workflow'] };
  const provider = { id: 'workflow' };
  const independent = { id: 'auth' };
  const input = [consumer, independent, provider];
  assert.deepEqual(sortModules(input), [provider, consumer, independent]);
  assert.deepEqual(input, [consumer, independent, provider]);
  assert.equal(sortModules(input)[0], provider);
  assert.deepEqual(sortModules([]), []);
});

test('all permutations respect a transitive diamond dependency', () => {
  const modules = [
    { id: 'a', dependencies: ['b', 'c'] },
    { id: 'b', dependencies: ['d'] },
    { id: 'c', dependencies: ['d'] },
    { id: 'd', dependencies: [] },
  ];
  function permutations<T>(items: T[]): T[][] {
    return items.length
      ? items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest]))
      : [[]];
  }
  for (const input of permutations(modules)) {
    const ids = sortModules(input).map(mod => mod.id);
    assert.equal(new Set(ids).size, 4);
    for (const mod of modules) for (const dep of mod.dependencies) assert.ok(ids.indexOf(dep) < ids.indexOf(mod.id));
  }
});

test('rejects duplicates, missing transitive dependencies and cycles with diagnostics', () => {
  assert.throws(() => sortModules([{ id: 'a' }, { id: 'a' }]), /Duplicate module "a"/);
  assert.throws(
    () =>
      sortModules([
        { id: 'a', dependencies: ['b'] },
        { id: 'b', dependencies: ['c'] },
      ]),
    /a -> b -> c/,
  );
  assert.throws(
    () =>
      sortModules([
        { id: 'a', dependencies: ['b'] },
        { id: 'b', dependencies: ['a'] },
      ]),
    /cycle: a -> b -> a/,
  );
  assert.throws(() => sortModules([{ id: 'a', dependencies: ['a'] }]), /cycle: a -> a/);
  assert.throws(() => sortModules([{ id: '' }]), /non-empty/);
});
