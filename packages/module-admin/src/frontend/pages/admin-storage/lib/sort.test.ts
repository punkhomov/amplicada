import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StorageEntry } from './entries.js';
import { type StorageSort, sortEntries } from './sort.js';

function file(name: string, overrides: Partial<StorageEntry> = {}): StorageEntry {
  return { kind: 'file', key: `a/${name}`, name, ...overrides };
}

function folder(name: string): StorageEntry {
  return { kind: 'folder', key: `a/${name}/`, name };
}

test('name: направление переворачивает порядок имён, папки остаются выше файлов', () => {
  const entries = [file('beta.txt'), folder('zeta'), file('alpha.txt'), folder('yankee')];

  const asc = sortEntries(entries, { key: 'name', direction: 'asc' });
  assert.deepEqual(
    asc.map(entry => entry.name),
    ['yankee', 'zeta', 'alpha.txt', 'beta.txt'],
  );

  const desc = sortEntries(entries, { key: 'name', direction: 'desc' });
  assert.deepEqual(
    desc.map(entry => entry.name),
    ['zeta', 'yankee', 'beta.txt', 'alpha.txt'],
  );
});

test('size: сортирует по размеру, при равенстве — по имени в обоих направлениях', () => {
  const entries = [file('b.txt', { size: 10 }), file('a.txt', { size: 10 }), file('c.txt', { size: 5 })];

  const asc = sortEntries(entries, { key: 'size', direction: 'asc' });
  assert.deepEqual(
    asc.map(entry => entry.name),
    ['c.txt', 'a.txt', 'b.txt'],
  );

  const desc = sortEntries(entries, { key: 'size', direction: 'desc' });
  assert.deepEqual(
    desc.map(entry => entry.name),
    ['a.txt', 'b.txt', 'c.txt'],
  );
});

test('modified: сортирует по ISO-дате, объект без даты — как пустая строка', () => {
  const entries = [
    file('new.txt', { lastModified: '2026-09-29T10:00:00.000Z' }),
    file('old.txt', { lastModified: '2020-01-01T00:00:00.000Z' }),
    file('none.txt'),
  ];

  const asc = sortEntries(entries, { key: 'modified', direction: 'asc' });
  assert.deepEqual(
    asc.map(entry => entry.name),
    ['none.txt', 'old.txt', 'new.txt'],
  );

  const desc = sortEntries(entries, { key: 'modified', direction: 'desc' });
  assert.deepEqual(
    desc.map(entry => entry.name),
    ['new.txt', 'old.txt', 'none.txt'],
  );
});

test('type: сортирует по расширению имени, у папок расширения нет', () => {
  const entries = [file('notes.md'), file('photo.png'), file('readme.txt'), file('no-ext'), folder('manual')];

  const asc = sortEntries(entries, { key: 'type', direction: 'asc' });
  assert.deepEqual(
    asc.map(entry => entry.name),
    ['manual', 'no-ext', 'notes.md', 'photo.png', 'readme.txt'],
  );
});

test('папки выше файлов при любой колонке и направлении', () => {
  const entries = [file('a.txt', { size: 100, lastModified: '2026-01-01T00:00:00.000Z' }), folder('z')];

  for (const key of ['name', 'size', 'modified', 'type'] as const) {
    for (const direction of ['asc', 'desc'] as const) {
      const sorted = sortEntries(entries, { key, direction } satisfies StorageSort);
      assert.equal(sorted[0].kind, 'folder', `${key} ${direction}`);
    }
  }
});

test('sortEntries не мутирует исходный массив', () => {
  const entries = [file('b.txt'), file('a.txt')];
  sortEntries(entries, { key: 'name', direction: 'asc' });
  assert.deepEqual(
    entries.map(entry => entry.name),
    ['b.txt', 'a.txt'],
  );
});
