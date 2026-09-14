import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectEdition } from './edition.js';

test('редакция читается из всех ходовых написаний schemaversion', () => {
  assert.equal(detectEdition('2004 2nd Edition'), '2nd');
  assert.equal(detectEdition('2004 3rd Edition'), '3rd');
  assert.equal(detectEdition('2004 4th Edition'), '4th');
  // Регистр сборщики соблюдают через раз.
  assert.equal(detectEdition('2004 3rd edition'), '3rd');
  assert.equal(detectEdition('CAM 1.3 4th Edition'), '4th');
});

test('редакция без номера — не догадка, а null', () => {
  // `2004` без уточнения встречается, и подставлять сюда 4-ю значило бы объявить поддержку
  // `rollupConsiderations` в пакете, где их нет.
  assert.equal(detectEdition('2004'), null);
  assert.equal(detectEdition('1.2'), null);
  assert.equal(detectEdition(null), null);
});
