import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folderTrail, isInside, moveTarget, parentPrefix, renameTarget } from './paths.js';

test('parentPrefix: родитель папки, у верхнего уровня — корень', () => {
  assert.equal(parentPrefix('a/b/'), 'a/');
  assert.equal(parentPrefix('a/b/c/'), 'a/b/');
  assert.equal(parentPrefix('a/'), '');
  assert.equal(parentPrefix(''), '');
});

test('moveTarget: файл переносится с тем же именем, папка — со слэшем', () => {
  assert.equal(moveTarget('a/f.txt', 'b/'), 'b/f.txt');
  assert.equal(moveTarget('a/f.txt', ''), 'f.txt');
  assert.equal(moveTarget('a/pkg/', 'b/'), 'b/pkg/');
  assert.equal(moveTarget('a/pkg/', ''), 'pkg/');
});

test('moveTarget: destination без слэша и корневой / нормализуются', () => {
  assert.equal(moveTarget('a/f.txt', 'b'), 'b/f.txt');
  assert.equal(moveTarget('a/pkg/', 'b'), 'b/pkg/');
  assert.equal(moveTarget('a/f.txt', '/'), 'f.txt');
});

test('renameTarget: файл остаётся в своей папке под новым именем', () => {
  assert.equal(renameTarget('a/b/f.txt', 'g.txt'), 'a/b/g.txt');
  assert.equal(renameTarget('f.txt', 'g.txt'), 'g.txt');
});

test('renameTarget: папка получает слэш на конце, лишний слэш в имени не дублируется', () => {
  assert.equal(renameTarget('a/pkg/', 'lib'), 'a/lib/');
  assert.equal(renameTarget('pkg/', 'lib'), 'lib/');
  assert.equal(renameTarget('a/pkg/', 'lib/'), 'a/lib/');
});

test('isInside: кандидат под префиксом, включая сам префикс', () => {
  assert.equal(isInside('a/', 'a/b/c.txt'), true);
  assert.equal(isInside('a/', 'a/b/'), true);
  assert.equal(isInside('a/', 'a/'), true);
  assert.equal(isInside('', 'a/b'), true);
});

test('isInside: совпадение строки без границы сегмента вложенностью не считается', () => {
  assert.equal(isInside('a/', 'ab/c.txt'), false);
  assert.equal(isInside('a/', 'b/a.txt'), false);
  assert.equal(isInside('a', 'a/b'), true);
  assert.equal(isInside('a', 'ab'), false);
});

test('folderTrail: сегменты префикса с накопленным путём', () => {
  assert.deepEqual(folderTrail('a/b/'), [
    { name: 'a', prefix: 'a/' },
    { name: 'b', prefix: 'a/b/' },
  ]);
});

test('folderTrail: корень — пустой список, хвостовой слэш не создаёт пустой сегмент', () => {
  assert.deepEqual(folderTrail(''), []);
  assert.deepEqual(folderTrail('/'), []);
  assert.deepEqual(folderTrail('a/b'), [
    { name: 'a', prefix: 'a/' },
    { name: 'b', prefix: 'a/b/' },
  ]);
});
