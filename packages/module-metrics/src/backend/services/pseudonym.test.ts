import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pseudonymizer } from './pseudonym.js';

test('псевдоним детерминирован и зависит от секрета', () => {
  const a = new Pseudonymizer('secret-a-very-long-enough');
  const b = new Pseudonymizer('secret-b-very-long-enough');
  assert.equal(a.forUser('user-1'), a.forUser('user-1'));
  assert.notEqual(a.forUser('user-1'), a.forUser('user-2'));
  assert.notEqual(a.forUser('user-1'), b.forUser('user-1'));
});

test('назначения разделены: аналитика и ошибки не сшиваются', () => {
  const p = new Pseudonymizer('secret-a-very-long-enough');
  assert.notEqual(p.forUser('user-1', 'analytics'), p.forUser('user-1', 'errors'));
  assert.notEqual(p.forUser('user-1'), p.forSession('user-1'));
});

test('секрет короче 16 символов отвергается', () => {
  assert.throws(() => new Pseudonymizer('short'), /at least 16/);
});
