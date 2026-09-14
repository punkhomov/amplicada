import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayBefore, versionWriteMode } from './version-mode.js';

test('dayBefore не спотыкается о границы месяца и года', () => {
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(dayBefore('2026-01-01'), '2025-12-31');
  assert.equal(dayBefore('2024-03-01'), '2024-02-29');
});

test('правка без даты — коррекция записи: карточка не двигает время действия', () => {
  assert.equal(versionWriteMode('2026-01-01', null), 'correction');
});

test('дата, совпадающая с началом текущей версии, — тоже коррекция', () => {
  // Прежний код закрыл бы версию датой 2026-08-05 при valid_from 2026-08-06 — инвертированный
  // интервал, который отвергал exclusion-констрейнт. Это и было падение при правке в день создания.
  assert.equal(versionWriteMode('2026-08-06', '2026-08-06'), 'correction');
});

test('ретроспективная дата не двигает начало версии назад — тоже коррекция', () => {
  assert.equal(versionWriteMode('2026-08-06', '2026-01-01'), 'correction');
});

test('дата позже начала текущей версии — новый интервал', () => {
  assert.equal(versionWriteMode('2026-01-01', '2026-08-06'), 'new-interval');
});

test('текущей версии нет — вставляем первую', () => {
  assert.equal(versionWriteMode(undefined, null), 'new-interval');
  assert.equal(versionWriteMode(undefined, '2026-08-06'), 'new-interval');
});
