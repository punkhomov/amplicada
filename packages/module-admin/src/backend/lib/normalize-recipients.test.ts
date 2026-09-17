import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUuid, normalizeRecipients } from './normalize-recipients.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

test('normalizeRecipients оставляет только непустые строки без дублей', () => {
  assert.deepEqual(normalizeRecipients([A, A, '', '  ', null, 42, B]), [A, B]);
});

test('normalizeRecipients обрезает пробелы и сохраняет порядок', () => {
  assert.deepEqual(normalizeRecipients([` ${B} `, A]), [B, A]);
});

test('normalizeRecipients отбрасывает не-uuid до SQL', () => {
  assert.deepEqual(normalizeRecipients([A, 'not-a-uuid', '']), [A]);
});

test('normalizeRecipients не массив — пусто', () => {
  assert.deepEqual(normalizeRecipients(undefined), []);
  assert.deepEqual(normalizeRecipients('not-an-array'), []);
});

test('normalizeRecipients уважает потолок получателей', () => {
  assert.deepEqual(normalizeRecipients([A, B, C], 2), [A, B]);
});

test('isUuid отсекает невалидные id до SQL', () => {
  assert.equal(isUuid(A), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(''), false);
});
