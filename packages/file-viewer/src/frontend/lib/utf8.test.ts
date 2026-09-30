import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utf8CompletePrefix } from './utf8.js';

const bytes = (...values: number[]) => new Uint8Array(values);

test('чистый ASCII считается целиком', () => {
  assert.equal(utf8CompletePrefix(bytes(0x48, 0x65, 0x6c, 0x6c, 0x6f)), 5);
});

test('пустой буфер — нулевой префикс', () => {
  assert.equal(utf8CompletePrefix(bytes()), 0);
});

test('хвост из одного байта 3-байтного символа отбрасывается', () => {
  // 'A' + первый байт '€' (E2 82 AC)
  assert.equal(utf8CompletePrefix(bytes(0x41, 0xe2)), 1);
});

test('хвост из двух байт 3-байтного символа отбрасывается', () => {
  assert.equal(utf8CompletePrefix(bytes(0x41, 0xe2, 0x82)), 1);
});

test('3-байтный символ целиком считается', () => {
  assert.equal(utf8CompletePrefix(bytes(0x41, 0xe2, 0x82, 0xac)), 4);
});

test('4-байтный эмодзи целиком считается', () => {
  // '😀' = F0 9F 98 80
  assert.equal(utf8CompletePrefix(bytes(0xf0, 0x9f, 0x98, 0x80)), 4);
});

test('хвост из трёх байт 4-байтного символа отбрасывается', () => {
  assert.equal(utf8CompletePrefix(bytes(0x41, 0xf0, 0x9f, 0x98)), 1);
});

test('строка, оканчивающаяся ровно на границе, не теряет ничего', () => {
  assert.equal(utf8CompletePrefix(bytes(0xe2, 0x82, 0xac, 0x41)), 4);
});

test('невалидный лид-байт 0xFF останавливает префикс', () => {
  assert.equal(utf8CompletePrefix(bytes(0x41, 0xff, 0x42)), 1);
});

test('висячий continuation-байт 0x80 останавливает префикс', () => {
  assert.equal(utf8CompletePrefix(bytes(0x41, 0x80, 0x42)), 1);
});

test('невалидный continuation внутри последовательности останавливает префикс', () => {
  // E2 ждёт два 10xxxxxx, а на месте первого — 0x42.
  assert.equal(utf8CompletePrefix(bytes(0x41, 0xe2, 0x42, 0x43)), 1);
});

test('в начале окна невалидный байт — префикс нулевой', () => {
  assert.equal(utf8CompletePrefix(bytes(0xff, 0x41)), 0);
});
