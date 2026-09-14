import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDuration,
  normalizeCmi,
  normalizeLessonStatus,
  normalizeScorm2004Status,
  parseIso8601Duration,
  parseScore,
  parseScormTimespan,
  readCmiPath,
} from './cmi-normalize.js';

test('lesson_status раскладывается на прохождение и результат', () => {
  assert.deepEqual(normalizeLessonStatus('passed'), { completion: 'completed', success: 'passed' });
  assert.deepEqual(normalizeLessonStatus('completed'), { completion: 'completed', success: null });
  assert.deepEqual(normalizeLessonStatus('incomplete'), { completion: 'in_progress', success: null });
  assert.deepEqual(normalizeLessonStatus('browsed'), { completion: 'in_progress', success: null });
  assert.deepEqual(normalizeLessonStatus('not attempted'), { completion: 'not_started', success: null });
});

test('failed — это завершённая попытка с отрицательным результатом, а не «в процессе»', () => {
  assert.deepEqual(normalizeLessonStatus('failed'), { completion: 'completed', success: 'failed' });
});

test('регистр и пробелы курса не должны ломать статус', () => {
  assert.deepEqual(normalizeLessonStatus('  PASSED '), { completion: 'completed', success: 'passed' });
});

test('незнакомый и отсутствующий статус трактуются как «не начато»', () => {
  assert.deepEqual(normalizeLessonStatus('какая-то чушь'), { completion: 'not_started', success: null });
  assert.deepEqual(normalizeLessonStatus(undefined), { completion: 'not_started', success: null });
  assert.deepEqual(normalizeLessonStatus(''), { completion: 'not_started', success: null });
});

test('CMITimespan разбирается, включая сотые и часы больше 99', () => {
  assert.equal(parseScormTimespan('00:00:00'), 0);
  assert.equal(parseScormTimespan('00:01:30'), 90);
  assert.equal(parseScormTimespan('01:00:00'), 3600);
  assert.equal(parseScormTimespan('00:00:01.50'), 1.5);
  assert.equal(parseScormTimespan('0100:00:00'), 360000, 'часов может быть до четырёх знаков');
});

test('мусорное время не роняет разбор, а даёт null', () => {
  for (const junk of ['', 'abc', '1:2:3', '00:99:00', '00:00:99', undefined, null, '00:00']) {
    assert.equal(parseScormTimespan(junk), null, `"${junk}" должно давать null`);
  }
});

test('score разбирается терпимо и не ограничивается шкалой 0–100', () => {
  assert.equal(parseScore('85'), 85);
  assert.equal(parseScore('85.5'), 85.5);
  assert.equal(parseScore('-3'), -3);
  assert.equal(parseScore('250'), 250, 'SCORM 1.2 не обязывает шкалу быть 0–100');
  assert.equal(parseScore(''), null);
  assert.equal(parseScore('n/a'), null);
  assert.equal(parseScore(undefined), null);
});

test('cmi читается и вложенным объектом, и плоской картой с точками', () => {
  const nested = { core: { lesson_status: 'passed', score: { raw: '90' } } };
  assert.equal(readCmiPath(nested, 'core.lesson_status'), 'passed');
  assert.equal(readCmiPath(nested, 'core.score.raw'), '90');

  const flat = { 'cmi.core.lesson_status': 'failed', 'core.score.raw': '10' };
  assert.equal(readCmiPath(flat, 'core.lesson_status'), 'failed');
  assert.equal(readCmiPath(flat, 'core.score.raw'), '10');
});

test('чтение несуществующего пути не бросает', () => {
  assert.equal(readCmiPath({}, 'core.lesson_status'), undefined);
  assert.equal(readCmiPath({ core: null }, 'core.lesson_status'), undefined);
  assert.equal(readCmiPath({ core: 'строка' }, 'core.lesson_status'), undefined);
});

test('normalizeCmi собирает всё вместе', () => {
  const result = normalizeCmi({ core: { lesson_status: 'passed', score: { raw: '92.5' }, total_time: '00:12:30' } }, 'scorm12');
  assert.deepEqual(result, { completion: 'completed', success: 'passed', score: 92.5, totalTimeSeconds: 750 });
});

test('normalizeCmi на пустом состоянии даёт «не начато» без падений', () => {
  assert.deepEqual(normalizeCmi({}, 'scorm12'), { completion: 'not_started', success: null, score: null, totalTimeSeconds: null });
  assert.deepEqual(normalizeCmi({}, 'scorm2004'), { completion: 'not_started', success: null, score: null, totalTimeSeconds: null });
});

test('SCORM 2004 держит завершение и результат раздельно', () => {
  assert.deepEqual(normalizeScorm2004Status('completed', 'failed', true), { completion: 'completed', success: 'failed' });
  assert.deepEqual(normalizeScorm2004Status('incomplete', 'unknown', true), { completion: 'in_progress', success: null });
  assert.deepEqual(normalizeScorm2004Status('not attempted', 'unknown', false), { completion: 'not_started', success: null });
});

test('2004: вердикт без объявленного completion — всё равно завершение', () => {
  assert.deepEqual(normalizeScorm2004Status('unknown', 'passed', true), { completion: 'completed', success: 'passed' });
});

test('2004: unknown отличает «не открывал» от «идёт полным ходом»', () => {
  assert.deepEqual(normalizeScorm2004Status('unknown', 'unknown', false), { completion: 'not_started', success: null });
  assert.deepEqual(normalizeScorm2004Status('unknown', 'unknown', true), { completion: 'in_progress', success: null });
});

test('признаком работы для 2004 служит любое из состояний курса, а не только статус', () => {
  const suspended = normalizeCmi({ completion_status: 'unknown', suspend_data: 'slide=7' }, 'scorm2004');
  assert.equal(suspended.completion, 'in_progress');
  assert.equal(normalizeCmi({ completion_status: 'unknown' }, 'scorm2004').completion, 'not_started');
});

test('2004: при отсутствии score.raw балл берётся из scaled и переводится в проценты', () => {
  assert.equal(normalizeCmi({ score: { raw: '85', scaled: '0.5' } }, 'scorm2004').score, 85, 'raw главнее');
  assert.equal(normalizeCmi({ score: { scaled: '0.855' } }, 'scorm2004').score, 85.5);
  assert.equal(normalizeCmi({ score: { scaled: '-1' } }, 'scorm2004').score, -100, 'отрицательный scaled законен');
});

test('длительность ISO 8601 разбирается', () => {
  assert.equal(parseIso8601Duration('PT0S'), 0);
  assert.equal(parseIso8601Duration('PT1H30M'), 5400);
  assert.equal(parseIso8601Duration('PT12M30S'), 750);
  assert.equal(parseIso8601Duration('P1DT2H'), 93600);
  assert.equal(parseIso8601Duration('PT1.5S'), 1.5);
});

test('годы и месяцы в длительности отвергаются целиком, а не считаются приблизительно', () => {
  for (const junk of ['P1Y', 'P2M', '', '00:12:30', 'PT', 'P', 'abc', undefined]) {
    assert.equal(parseIso8601Duration(junk), null, `"${junk}" должно давать null`);
  }
});

test('время форматируется обратно в тот вид, который ждёт рантайм', () => {
  assert.equal(formatDuration('scorm12', 0), '00:00:00');
  assert.equal(formatDuration('scorm12', 750), '00:12:30');
  assert.equal(formatDuration('scorm12', 360000), '100:00:00');
  assert.equal(formatDuration('scorm2004', 750), 'PT0H12M30S');
  assert.equal(formatDuration('scorm2004', 5400), 'PT1H30M0S');
});

test('накопленное время читается из total_time, а не из session_time', () => {
  // Курс присылает время сессии целиком, а не дельту: сложение с итогом на каждом автокоммите
  // задвоило бы его в разы. Накопление делает рантайм, здесь только чтение готового итога.
  const scorm12 = normalizeCmi({ core: { total_time: '01:00:00', session_time: '00:10:00' } }, 'scorm12');
  assert.equal(scorm12.totalTimeSeconds, 3600);

  const scorm2004 = normalizeCmi({ total_time: 'PT1H', session_time: 'PT10M' }, 'scorm2004');
  assert.equal(scorm2004.totalTimeSeconds, 3600);
});
