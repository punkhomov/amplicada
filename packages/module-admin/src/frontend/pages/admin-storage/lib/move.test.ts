import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveBlockReason } from './move.js';

test('moveBlockReason: папку нельзя переместить в себя', () => {
  assert.equal(moveBlockReason(['a/pkg/'], 'a/pkg/'), 'inside');
});

test('moveBlockReason: папку нельзя переместить в своего потомка', () => {
  assert.equal(moveBlockReason(['a/pkg/'], 'a/pkg/sub/'), 'inside');
  assert.equal(moveBlockReason(['pkg/'], 'pkg/'), 'inside');
});

test('moveBlockReason: папку можно переместить в соседнюю папку или корень', () => {
  assert.equal(moveBlockReason(['a/pkg/'], 'a/other/'), null);
  assert.equal(moveBlockReason(['a/pkg/'], ''), null);
});

test('moveBlockReason: совпадение имени без границы сегмента потомком не считается', () => {
  assert.equal(moveBlockReason(['a/pkg/'], 'a/pkg2/'), null);
});

test('moveBlockReason: перемещение в свою же папку — no-op', () => {
  assert.equal(moveBlockReason(['a/f.txt'], 'a/'), 'noop');
  assert.equal(moveBlockReason(['a/pkg/'], 'a/'), 'noop');
});

test('moveBlockReason: no-op только когда ни один ключ не сменит место', () => {
  assert.equal(moveBlockReason(['a/f.txt', 'b/g.txt'], 'a/'), null);
  assert.equal(moveBlockReason(['f.txt'], '/'), 'noop');
});

test('moveBlockReason: запрет папки в себя сильнее no-op остальных', () => {
  assert.equal(moveBlockReason(['a/f.txt', 'a/pkg/'], 'a/pkg/'), 'inside');
});

test('moveBlockReason: пустой выбор не блокирует', () => {
  assert.equal(moveBlockReason([], 'a/'), null);
});
