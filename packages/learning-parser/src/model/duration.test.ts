import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDurationSeconds } from './duration.js';

test('часы-минуты-секунды SCORM 1.2 приводятся к секундам', () => {
  assert.equal(parseDurationSeconds('01:30:00'), 5400);
  assert.equal(parseDurationSeconds('00:00:45'), 45);
  // Часов до четырёх знаков: ограничение на попытку бывает и в сотнях часов.
  assert.equal(parseDurationSeconds('9999:00:00'), 35_996_400);
  assert.equal(parseDurationSeconds('00:00:01.50'), 1.5);
});

test('ISO 8601 SCORM 2004 и cmi5 приводится к секундам', () => {
  assert.equal(parseDurationSeconds('PT2H30M'), 9000);
  assert.equal(parseDurationSeconds('PT45S'), 45);
  assert.equal(parseDurationSeconds('P1DT1H'), 90_000);
  assert.equal(parseDurationSeconds('P2W'), 1_209_600);
});

test('`M` до T — месяцы, после T — минуты', () => {
  // Перепутать их значит ошибиться в 43 000 раз, поэтому месяцы отвергаются, а не считаются.
  assert.equal(parseDurationSeconds('PT5M'), 300);
  assert.equal(parseDurationSeconds('P5M'), null, 'месяц не имеет фиксированной длины');
  assert.equal(parseDurationSeconds('P1Y'), null);
});

test('мусор и пустое дают null, а не NaN и не ноль', () => {
  // Ноль означал бы «времени не отведено» — это другое утверждение, чем «не сказано».
  assert.equal(parseDurationSeconds(null), null);
  assert.equal(parseDurationSeconds(''), null);
  assert.equal(parseDurationSeconds('  '), null);
  assert.equal(parseDurationSeconds('позже'), null);
  assert.equal(parseDurationSeconds('P'), null, 'пустая длительность ничего не объявляет');
  assert.equal(parseDurationSeconds('01:70:00'), null, 'минут больше 59 не бывает — это опечатка');
});
