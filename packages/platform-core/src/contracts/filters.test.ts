import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FilterTree } from './documents.js';
import { countFilterConditions, EMPTY_FILTER, filterDepth, normalizeFilterInput, pruneEmptyGroups } from './filters.js';

const cond = (column: string, operator = 'eq') => ({ kind: 'condition' as const, column, operator: operator as 'eq' });

test('normalizeFilterInput: пустые входы дают пустой фильтр', () => {
  for (const input of [undefined, null, '', 0, false, 'garbage', { nonsense: true }, [{ bogus: 1 }]]) {
    assert.deepEqual(normalizeFilterInput(input), EMPTY_FILTER, `вход: ${JSON.stringify(input)}`);
  }
});

test('normalizeFilterInput: legacy-массив становится AND-группой с теми же листьями', () => {
  const legacy = [
    { column: 'hr:name', operator: 'contains', value: 'иван' },
    { column: 'hr:isActive', operator: 'eq', value: 'true' },
  ];
  const tree = normalizeFilterInput(legacy);
  assert.equal(tree.kind, 'group');
  assert.equal(tree.combinator, 'and', 'legacy-семантика — неявный AND');
  assert.equal(tree.children.length, 2);
  assert.deepEqual(tree.children[0], { kind: 'condition', column: 'hr:name', operator: 'contains', value: 'иван' });
});

test('normalizeFilterInput: одиночное условие заворачивается в корневую группу', () => {
  const tree = normalizeFilterInput({ column: 'hr:code', operator: 'eq', value: 'X' });
  assert.equal(tree.kind, 'group');
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].kind, 'condition');
});

test('normalizeFilterInput: вложенные группы сохраняются, combinator по умолчанию and', () => {
  const tree = normalizeFilterInput({
    children: [cond('a'), { combinator: 'or', children: [cond('b'), cond('c')] }],
  });
  assert.equal(tree.combinator, 'and', 'отсутствующий combinator → and');
  assert.equal(tree.children.length, 2);
  const group = tree.children[1];
  assert.equal(group.kind, 'group');
  if (group.kind === 'group') {
    assert.equal(group.combinator, 'or');
    assert.equal(group.children.length, 2);
  }
});

test('normalizeFilterInput: идемпотентна — от этого зависит совпадение queryKey у loader и компонента', () => {
  const inputs: unknown[] = [
    undefined,
    [{ column: 'a', operator: 'eq', value: '1' }],
    { combinator: 'or', children: [cond('a'), { combinator: 'and', children: [cond('b')] }] },
    { column: 'solo', operator: 'ne', value: 'x' },
  ];
  for (const input of inputs) {
    const once = normalizeFilterInput(input);
    const twice = normalizeFilterInput(once);
    assert.equal(JSON.stringify(once), JSON.stringify(twice), `не идемпотентно для ${JSON.stringify(input)}`);
  }
});

test('normalizeFilterInput: values фильтруются до строк и обрезаются по лимиту', () => {
  const tree = normalizeFilterInput([{ column: 'a', operator: 'in', values: ['x', 5, null, 'y'] }]);
  const leaf = tree.children[0];
  assert.equal(leaf.kind, 'condition');
  if (leaf.kind === 'condition') assert.deepEqual(leaf.values, ['x', 'y']);
});

test('countFilterConditions считает листья, а не элементы верхнего уровня', () => {
  const tree: FilterTree = {
    kind: 'group',
    combinator: 'and',
    children: [cond('a'), { kind: 'group', combinator: 'or', children: [cond('b'), cond('c'), cond('d')] }],
  };
  // Бейдж тулбара обязан показать 4, а не 2 — иначе группа из трёх условий выглядит как одно.
  assert.equal(countFilterConditions(tree), 4);
  assert.equal(countFilterConditions(EMPTY_FILTER), 0);
});

test('pruneEmptyGroups убирает пустые группы на всех уровнях', () => {
  const tree: FilterTree = {
    kind: 'group',
    combinator: 'and',
    children: [
      cond('a'),
      { kind: 'group', combinator: 'or', children: [] },
      { kind: 'group', combinator: 'or', children: [{ kind: 'group', combinator: 'and', children: [] }] },
    ],
  };
  const pruned = pruneEmptyGroups(tree);
  assert.equal(pruned.children.length, 1, 'обе пустые ветки должны исчезнуть');
  assert.equal(countFilterConditions(pruned), 1);
});

test('filterDepth: корень 0, условие в группе 1, во вложенной группе 2', () => {
  assert.equal(filterDepth(EMPTY_FILTER), 0);
  assert.equal(filterDepth({ kind: 'group', combinator: 'and', children: [cond('a')] }), 1);
  assert.equal(
    filterDepth({
      kind: 'group',
      combinator: 'and',
      children: [{ kind: 'group', combinator: 'or', children: [cond('a')] }],
    }),
    2,
  );
});
