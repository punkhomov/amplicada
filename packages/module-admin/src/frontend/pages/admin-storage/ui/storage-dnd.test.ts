import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isStorageDragBlocked,
  STORAGE_DRAG_BLOCKERS,
  STORAGE_DRAG_SURFACE_ATTR,
  storageDragId,
  storageDropId,
  storageKeyFromDragId,
  storagePrefixFromDropId,
} from './storage-dnd.js';

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

test('isStorageDragBlocked: интерактивная цель блокирует drag', () => {
  const blocker = {};
  // Фейковый target: `closest` отвечает только на тот селектор, который передаст предикат.
  const fakeTarget = (hits: Record<string, unknown | null>) =>
    ({
      closest: (selector: string) => hits[selector] ?? null,
    }) as unknown as EventTarget;
  assert.equal(isStorageDragBlocked(fakeTarget({ [STORAGE_DRAG_BLOCKERS]: blocker })), true);
  assert.equal(isStorageDragBlocked(fakeTarget({ [STORAGE_DRAG_BLOCKERS]: null })), false);
  assert.equal(isStorageDragBlocked(null), false);
  // Без DOM-узла (`closest` нет) предикат обязан не падать, а пропускать цель.
  assert.equal(isStorageDragBlocked({} as EventTarget), false);
});

test('isStorageDragBlocked: помеченная поверхность плитки — не блокер', () => {
  const surfaceBlock = {};
  const fakeTarget = {
    closest: (selector: string) =>
      selector === STORAGE_DRAG_BLOCKERS || selector === `[${STORAGE_DRAG_SURFACE_ATTR}]` ? surfaceBlock : null,
  } as unknown as EventTarget;
  assert.equal(isStorageDragBlocked(fakeTarget), false);
});

test('STORAGE_DRAG_BLOCKERS: покрывает контролы строки, меню и sentinel', () => {
  for (const token of [
    'input',
    'textarea',
    'select',
    'option',
    'contenteditable',
    'button',
    'a',
    '[role="checkbox"]',
    '[role="menu"]',
    '[data-slot="storage-load-more"]',
  ]) {
    assert.ok(STORAGE_DRAG_BLOCKERS.includes(token), `селектор без ${token}`);
  }
});
