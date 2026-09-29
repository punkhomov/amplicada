import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StorageListing } from '../../../../contracts/storage.js';
import { toEntries } from './entries.js';

function listing(overrides: Partial<StorageListing> = {}): StorageListing {
  return { prefix: 'a/', prefixes: [], objects: [], ...overrides };
}

test('toEntries: папки — из prefixes, имя — последний сегмент, ключ — полный префикс', () => {
  const entries = toEntries(listing({ prefixes: ['a/pkg/', 'a/nested/deep/'] }));
  assert.deepEqual(entries, [
    { kind: 'folder', key: 'a/pkg/', name: 'pkg' },
    { kind: 'folder', key: 'a/nested/deep/', name: 'deep' },
  ]);
});

test('toEntries: файлы — из objects, имя из ключа, размер и дата переносятся', () => {
  const entries = toEntries(
    listing({
      objects: [
        { key: 'a/readme.txt', size: 12, contentType: 'text/plain', etag: 'e1', lastModified: '2026-09-29T10:00:00.000Z' },
        { key: 'a/no-date.bin', size: 0 },
      ],
    }),
  );
  assert.deepEqual(entries, [
    { kind: 'file', key: 'a/readme.txt', name: 'readme.txt', size: 12, lastModified: '2026-09-29T10:00:00.000Z' },
    { kind: 'file', key: 'a/no-date.bin', name: 'no-date.bin', size: 0, lastModified: undefined },
  ]);
});

test('toEntries: папки идут до файлов, пустой листинг — пустой список', () => {
  assert.deepEqual(toEntries(listing()), []);
  const entries = toEntries(listing({ prefixes: ['a/f/'], objects: [{ key: 'a/z.txt', size: 1 }] }));
  assert.deepEqual(
    entries.map(entry => entry.key),
    ['a/f/', 'a/z.txt'],
  );
});
