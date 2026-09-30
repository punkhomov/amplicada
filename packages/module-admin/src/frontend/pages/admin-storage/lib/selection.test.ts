import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type SelectionState, selectionReducer } from './selection.js';

const visible = ['a/', 'b/', 'c/', 'd/'];

function state(overrides: Partial<SelectionState> = {}): SelectionState {
  return { keys: [], anchor: null, ...overrides };
}

test('click без модификаторов — одиночный выбор, якорь на клике', () => {
  const next = selectionReducer(state({ keys: ['a/', 'b/'], anchor: 'a/' }), {
    type: 'click',
    key: 'c/',
    additive: false,
    range: false,
    visible,
  });
  assert.deepEqual(next, { keys: ['c/'], anchor: 'c/' });
});

test('click с additive — toggle: добавляет ключ, повторный клик убирает', () => {
  const added = selectionReducer(state({ keys: ['a/'], anchor: 'a/' }), {
    type: 'click',
    key: 'c/',
    additive: true,
    range: false,
    visible,
  });
  assert.deepEqual(added, { keys: ['a/', 'c/'], anchor: 'c/' });

  const removed = selectionReducer(added, { type: 'click', key: 'c/', additive: true, range: false, visible });
  assert.deepEqual(removed, { keys: ['a/'], anchor: 'c/' });
});

test('click с range — от якоря до ключа по visible, якорь не двигается', () => {
  const forward = selectionReducer(state({ anchor: 'b/' }), { type: 'click', key: 'd/', additive: false, range: true, visible });
  assert.deepEqual(forward, { keys: ['b/', 'c/', 'd/'], anchor: 'b/' });

  const backward = selectionReducer(state({ anchor: 'd/' }), { type: 'click', key: 'b/', additive: false, range: true, visible });
  assert.deepEqual(backward, { keys: ['b/', 'c/', 'd/'], anchor: 'd/' });
});

test('click с range без видимого якоря — как одиночный выбор', () => {
  const noAnchor = selectionReducer(state({ keys: ['d/'] }), { type: 'click', key: 'b/', additive: false, range: true, visible });
  assert.deepEqual(noAnchor, { keys: ['b/'], anchor: 'b/' });

  const hiddenAnchor = selectionReducer(state({ keys: ['hidden/'], anchor: 'hidden/' }), {
    type: 'click',
    key: 'b/',
    additive: false,
    range: true,
    visible,
  });
  assert.deepEqual(hiddenAnchor, { keys: ['b/'], anchor: 'b/' });
});

test('click с range и additive — объединяет прежний выбор с диапазоном', () => {
  const next = selectionReducer(state({ keys: ['a/'], anchor: 'b/' }), {
    type: 'click',
    key: 'c/',
    additive: true,
    range: true,
    visible,
  });
  assert.deepEqual(next, { keys: ['a/', 'b/', 'c/'], anchor: 'b/' });
});

test('check: ставит и снимает галочку без дубликатов', () => {
  const checked = selectionReducer(state(), { type: 'check', key: 'b/', checked: true });
  assert.deepEqual(checked, { keys: ['b/'], anchor: 'b/' });

  const repeated = selectionReducer(checked, { type: 'check', key: 'b/', checked: true });
  assert.deepEqual(repeated, checked);

  const unchecked = selectionReducer(repeated, { type: 'check', key: 'b/', checked: false });
  assert.deepEqual(unchecked, { keys: [], anchor: 'b/' });
});

test('checkAll: добавляет и убирает переданные ключи, не трогая остальные', () => {
  const all = selectionReducer(state({ keys: ['a/'] }), { type: 'checkAll', keys: ['a/', 'b/', 'c/'], checked: true });
  assert.deepEqual(all, { keys: ['a/', 'b/', 'c/'], anchor: null });

  const none = selectionReducer(all, { type: 'checkAll', keys: ['a/', 'c/'], checked: false });
  assert.deepEqual(none, { keys: ['b/'], anchor: null });
});

test('clear: пустое состояние без якоря', () => {
  assert.deepEqual(selectionReducer(state({ keys: ['a/'], anchor: 'a/' }), { type: 'clear' }), { keys: [], anchor: null });
});

test('sync: убирает ключи вне visible и сбрасывает невидимый якорь', () => {
  const next = selectionReducer(state({ keys: ['a/', 'hidden/'], anchor: 'hidden/' }), { type: 'sync', visible: ['a/', 'b/'] });
  assert.deepEqual(next, { keys: ['a/'], anchor: null });
});

test('sync: видимый якорь переживает синхронизацию', () => {
  const next = selectionReducer(state({ keys: ['a/', 'z/'], anchor: 'a/' }), { type: 'sync', visible: ['a/', 'b/'] });
  assert.deepEqual(next, { keys: ['a/'], anchor: 'a/' });
});

test('sync без изменений возвращает то же состояние по ссылке', () => {
  const current = state({ keys: ['a/'], anchor: 'a/' });
  assert.equal(selectionReducer(current, { type: 'sync', visible: ['a/', 'b/'] }), current);
});
