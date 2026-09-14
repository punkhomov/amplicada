import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ValidationIssue } from '../issue.js';
import { evaluatePrerequisites, type Prerequisite, parsePrerequisites, prerequisiteIdentifiers } from './prerequisite.js';

/** Разбор без находок: то, что должно читаться, читается молча. */
function parse(source: string): Prerequisite | null {
  const issues: ValidationIssue[] = [];
  const expression = parsePrerequisites(source, issues, 'course.crs#A1');
  assert.deepEqual(issues, [], `неожиданные находки: ${issues.map(issue => issue.code).join(', ')}`);
  return expression;
}

function rejected(source: string): ValidationIssue {
  const issues: ValidationIssue[] = [];
  assert.equal(parsePrerequisites(source, issues, 'course.crs#A1'), null);
  assert.equal(issues.length, 1, `ожидалась одна находка, а не ${issues.length}`);
  return issues[0];
}

const item = (identifier: string): Prerequisite => ({ kind: 'item', identifier });

test('один идентификатор — это лист, без обёртки в "и"', () => {
  assert.deepEqual(parse('CHAPTER1'), item('CHAPTER1'));
});

test('однородные операторы складываются в один узел, а не в лесенку', () => {
  // `a&b&c` — это одно «и» с тремя операндами. Лесенка из вложенных пар дала бы то же значение,
  // но сравнивать деревья и показывать их стало бы больно.
  assert.deepEqual(parse('a&b&c'), { kind: 'and', operands: [item('a'), item('b'), item('c')] });
  assert.deepEqual(parse('a|b|c'), { kind: 'or', operands: [item('a'), item('b'), item('c')] });
});

test('двойное отрицание разбирается, а не обрывает выражение', () => {
  assert.deepEqual(parse('~~a'), { kind: 'not', operand: { kind: 'not', operand: item('a') } });
});

test('лишние скобки не меняют дерево', () => {
  assert.deepEqual(parse('((a))'), item('a'));
});

test('подчёркивание — часть идентификатора', () => {
  assert.deepEqual(parse('chapter_1'), item('chapter_1'));
});

test('оператор без второго операнда — находка', () => {
  for (const broken of ['a&', 'a|', '~', '()']) {
    assert.equal(rejected(broken).code, 'common.prerequisite-unparsable', broken);
  }
});

test('"и" связывает крепче, чем "или": a&b|c это (a&b)|c', () => {
  assert.deepEqual(parse('a&b|c'), {
    kind: 'or',
    operands: [{ kind: 'and', operands: [item('a'), item('b')] }, item('c')],
  });
});

test('скобки меняют приоритет: a&(b|c)', () => {
  assert.deepEqual(parse('a&(b|c)'), {
    kind: 'and',
    operands: [item('a'), { kind: 'or', operands: [item('b'), item('c')] }],
  });
});

test('отрицание связывает только свой атом: ~a&b это (~a)&b', () => {
  assert.deepEqual(parse('~a&b'), {
    kind: 'and',
    operands: [{ kind: 'not', operand: item('a') }, item('b')],
  });
});

test('отрицание применяется к скобке целиком', () => {
  assert.deepEqual(parse('~(a|b)'), { kind: 'not', operand: { kind: 'or', operands: [item('a'), item('b')] } });
});

test('пробелы внутри выражения значения не несут', () => {
  assert.deepEqual(parse('  a &  ~ b '), parse('a&~b'));
});

test('точка и дефис — часть идентификатора, а не операторы', () => {
  assert.deepEqual(parse('lesson-1.2'), item('lesson-1.2'));
});

test('пустая строка — это отсутствие условия, а не изъян', () => {
  const issues: ValidationIssue[] = [];
  assert.equal(parsePrerequisites('   ', issues, 'course.crs#A1'), null);
  assert.equal(parsePrerequisites(null, issues, 'course.crs#A1'), null);
  assert.deepEqual(issues, []);
});

test('мусор даёт находку, а не исключение', () => {
  const issue = rejected('a & & b');
  assert.equal(issue.code, 'common.prerequisite-unparsable');
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.location, 'course.crs#A1');
});

test('незакрытая скобка и хвост после выражения тоже находки', () => {
  assert.equal(rejected('(a&b').code, 'common.prerequisite-unparsable');
  assert.match(rejected('a b').message, /лишнее после выражения/);
});

test('словесные операторы не читаются как первое условие', () => {
  // `A AND B` — не наш язык. Прочитать из него `A` значило бы открыть пункт раньше времени.
  assert.equal(rejected('A AND B').code, 'common.prerequisite-unparsable');
});

test('конструкции полного AICC-скрипта отличаются от мусора', () => {
  assert.equal(rejected('{2}(a,b,c)').code, 'common.prerequisite-unsupported');
  assert.equal(rejected('a*b').code, 'common.prerequisite-unsupported');
});

test('вычисление: и, или, не', () => {
  const expression = parse('a&(b|~c)');
  assert.ok(expression);
  assert.equal(evaluatePrerequisites(expression, new Set(['a', 'b'])), true);
  // `a` пройден, `b` нет, `c` пройден — значит и `~c` ложно.
  assert.equal(evaluatePrerequisites(expression, new Set(['a', 'c'])), false);
  // `a` пройден, ни `b`, ни `c` — `~c` истинно.
  assert.equal(evaluatePrerequisites(expression, new Set(['a'])), true);
  assert.equal(evaluatePrerequisites(expression, new Set(['b'])), false);
});

test('вычисление сравнивает точно: регистр приводит потребитель, а не библиотека', () => {
  const expression = parse('A1');
  assert.ok(expression);
  assert.equal(evaluatePrerequisites(expression, new Set(['a1'])), false);
  assert.equal(evaluatePrerequisites(expression, new Set(['A1'])), true);
});

test('перечень ссылок отдаётся без повторов, в порядке появления', () => {
  const expression = parse('b&(a|~b)');
  assert.ok(expression);
  assert.deepEqual(prerequisiteIdentifiers(expression), ['b', 'a']);
});
