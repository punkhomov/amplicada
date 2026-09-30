import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageDragId, storageDropId, storageKeyFromDragId, storagePrefixFromDropId } from './storage-dnd.js';

test('storageDropId: id цели не пересекается с id перетаскиваемого элемента', () => {
  assert.notEqual(storageDropId('a/pkg/'), storageDragId('a/pkg/'));
});

test('storagePrefixFromDropId: разбирает id цели и отвергает чужое', () => {
  assert.equal(storagePrefixFromDropId(storageDropId('a/pkg/')), 'a/pkg/');
  assert.equal(storagePrefixFromDropId(storageDropId('')), '');
  assert.equal(storagePrefixFromDropId(storageDragId('a.txt')), null);
  assert.equal(storagePrefixFromDropId('a/'), null);
  assert.equal(storagePrefixFromDropId(42), null);
  assert.equal(storagePrefixFromDropId(undefined), null);
});

test('storagePrefixFromDropId: снимает экземплярный суффикс droppable', () => {
  // Один префикс рисуется несколькими узлами (дерево, строка, крошка) — id разводятся суффиксом `useId`.
  assert.equal(storagePrefixFromDropId(`${storageDropId('a/pkg/')}|:r7:`), 'a/pkg/');
  assert.equal(storagePrefixFromDropId(`${storageDropId('a/')}|b|:r7:`), 'a/|b');
  assert.equal(storagePrefixFromDropId(`${storageDropId('a/|x')}|:r7:`), 'a/|x');
});

test('storageKeyFromDragId: разбирает id строки и отвергает чужое', () => {
  assert.equal(storageKeyFromDragId(storageDragId('dnd/a.txt')), 'dnd/a.txt');
  assert.equal(storageKeyFromDragId(storageDropId('a/')), null);
  assert.equal(storageKeyFromDragId(null), null);
});
