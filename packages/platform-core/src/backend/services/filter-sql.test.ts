import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { FilterCondition, FilterTree, ListFieldMeta } from '../../contracts/documents.js';
import { DocumentRuntimeError } from './document-runtime-error.js';
import { buildFilterWhere, parseFilterParam } from './filter-sql.js';

/**
 * Drizzle рендерит SQL офлайн: .toSQL() не открывает соединение, поэтому весь компилятор фильтров
 * проверяется без БД. Пул ниже никогда не используется для запросов.
 */
const probe = pgTable('probe', {
  id: uuid('id').primaryKey(),
  name: text('name'),
  qty: integer('qty'),
  active: boolean('active'),
  createdAt: timestamp('created_at', { withTimezone: true }),
});

// biome-ignore lint/suspicious/noExplicitAny: драйвер не используется — нужен только рендер SQL
const db = drizzle({ client: {} as any });

const columns: Record<string, ListFieldMeta> = {
  'm:name': { label: 'Name', type: 'text' },
  'm:qty': { label: 'Qty', type: 'number' },
  'm:active': { label: 'Active', type: 'checkbox' },
  'm:createdAt': { label: 'Created', type: 'datetime' },
  'm:locked': { label: 'Locked', type: 'text', filterable: false },
  'm:untyped': { label: 'Untyped' },
};

const selectObj = {
  'm:name': probe.name,
  'm:qty': probe.qty,
  'm:active': probe.active,
  'm:createdAt': probe.createdAt,
  'm:locked': probe.name,
  'm:untyped': probe.id,
};

function render(tree: FilterTree): { sql: string; params: unknown[] } {
  const clause = buildFilterWhere(tree, columns, selectObj);
  const query = clause ? db.select().from(probe).where(clause) : db.select().from(probe);
  const { sql, params } = query.toSQL();
  return { sql, params };
}

const cond = (partial: Omit<FilterCondition, 'kind'>): FilterCondition => ({ kind: 'condition', ...partial });
const group = (combinator: 'and' | 'or', ...children: FilterTree['children']): FilterTree => ({ kind: 'group', combinator, children });

function expectIssues(tree: FilterTree, expectedCode: string): void {
  assert.throws(
    () => buildFilterWhere(tree, columns, selectObj),
    (err: unknown) => {
      assert.ok(err instanceof DocumentRuntimeError, 'должен быть DocumentRuntimeError');
      assert.equal(err.status, 400);
      const issues = err.details as { code: string }[];
      assert.ok(Array.isArray(issues), 'details должен быть списком проблем');
      assert.ok(
        issues.some(i => i.code === expectedCode),
        `ожидался код '${expectedCode}', получено: ${issues.map(i => i.code).join(', ')}`,
      );
      return true;
    },
  );
}

test('пустой фильтр не добавляет WHERE', () => {
  const { sql } = render(group('and'));
  assert.ok(!sql.includes('where'), sql);
});

test('OR внутри корневого AND — главный сценарий фичи', () => {
  const { sql, params } = render(
    group(
      'and',
      cond({ column: 'm:active', operator: 'eq', value: 'true' }),
      group('or', cond({ column: 'm:name', operator: 'eq', value: 'a' }), cond({ column: 'm:name', operator: 'eq', value: 'b' })),
    ),
  );
  assert.match(sql, /where .*"active" = .* and \(.*"name" = .* or .*"name" = .*\)/i, sql);
  assert.deepEqual(params, [true, 'a', 'b']);
});

test('группа из одного ребёнка не оборачивается лишними скобками', () => {
  const { sql } = render(group('and', group('or', cond({ column: 'm:qty', operator: 'gt', value: '5' }))));
  assert.ok(!sql.includes(' or '), `одиночный ребёнок не должен давать OR: ${sql}`);
  assert.match(sql, /"qty" >/i, sql);
});

test('пустая группа исчезает, не влияя на выборку', () => {
  const { sql, params } = render(group('and', cond({ column: 'm:qty', operator: 'eq', value: '1' }), group('or')));
  assert.ok(!sql.includes(' or '), sql);
  assert.deepEqual(params, [1]);
});

test('in биндит каждое значение отдельным параметром', () => {
  const { sql, params } = render(group('and', cond({ column: 'm:qty', operator: 'in', values: ['1', '2', '3'] })));
  assert.match(sql, /"qty" in \(/i, sql);
  assert.deepEqual(params, [1, 2, 3]);
});

test('notIn матчит NULL — иначе «не входит в список» молча теряет пустые строки', () => {
  const { sql } = render(group('and', cond({ column: 'm:name', operator: 'notIn', values: ['x'] })));
  assert.match(sql, /not in .* or .*"name" is null/i, sql);
});

test('ne матчит NULL', () => {
  const { sql } = render(group('and', cond({ column: 'm:name', operator: 'ne', value: 'x' })));
  assert.match(sql, /<> .* or .*"name" is null/i, sql);
});

test('contains кастует к ::text и экранирует метасимволы LIKE', () => {
  const { sql, params } = render(group('and', cond({ column: 'm:name', operator: 'contains', value: '50%_x' })));
  assert.match(sql, /::text ilike/i, sql);
  // Без экранирования «50%» превратилось бы в шаблон и вернуло мусор.
  assert.deepEqual(params, ['%50\\%\\_x%']);
});

test('between разворачивается в пару границ', () => {
  const { sql, params } = render(group('and', cond({ column: 'm:qty', operator: 'between', value: '1', value2: '9' })));
  assert.match(sql, /"qty" >= .* and .*"qty" <=/i, sql);
  assert.deepEqual(params, [1, 9]);
});

test('isEmpty/isNotEmpty не требуют значения', () => {
  assert.match(render(group('and', cond({ column: 'm:name', operator: 'isEmpty' }))).sql, /"name" is null/i);
  assert.match(render(group('and', cond({ column: 'm:name', operator: 'isNotEmpty' }))).sql, /"name" is not null/i);
});

test('400: неизвестная колонка', () => {
  expectIssues(group('and', cond({ column: 'm:nope', operator: 'eq', value: 'x' })), 'unknown_column');
});

test('400: колонка с filterable: false', () => {
  expectIssues(group('and', cond({ column: 'm:locked', operator: 'eq', value: 'x' })), 'not_filterable');
});

test('400: оператор недопустим для типа колонки', () => {
  // checkbox не поддерживает contains
  expectIssues(group('and', cond({ column: 'm:active', operator: 'contains', value: 'x' })), 'operator_not_allowed');
});

test('400: contains недоступен для колонки без type — иначе ilike роняет запрос на uuid', () => {
  expectIssues(group('and', cond({ column: 'm:untyped', operator: 'contains', value: 'x' })), 'operator_not_allowed');
});

test('400: неприводимое значение', () => {
  expectIssues(group('and', cond({ column: 'm:qty', operator: 'eq', value: 'не число' })), 'bad_value');
});

test('400: in с пустым списком значений', () => {
  expectIssues(group('and', cond({ column: 'm:qty', operator: 'in', values: [] })), 'values_required');
});

test('400: превышение глубины вложенности', () => {
  let node: FilterTree = group('and', cond({ column: 'm:qty', operator: 'eq', value: '1' }));
  for (let i = 0; i < 8; i++) node = group('and', node);
  expectIssues(node, 'max_depth');
});

test('400: превышение числа узлов', () => {
  const many = Array.from({ length: 120 }, () => cond({ column: 'm:qty', operator: 'eq', value: '1' }));
  expectIssues(group('and', ...many), 'max_nodes');
});

test('400 собирает ВСЕ проблемы разом, а не только первую', () => {
  assert.throws(
    () =>
      buildFilterWhere(
        group('and', cond({ column: 'm:nope', operator: 'eq', value: 'x' }), cond({ column: 'm:qty', operator: 'eq', value: 'nan' })),
        columns,
        selectObj,
      ),
    (err: unknown) => {
      const issues = (err as DocumentRuntimeError).details as unknown[];
      assert.equal(issues.length, 2, 'пользователь должен починить фильтр за один заход');
      return true;
    },
  );
});

test('parseFilterParam принимает legacy-массив — старый фронт продолжает работать', () => {
  const tree = parseFilterParam(JSON.stringify([{ column: 'm:name', operator: 'eq', value: 'x' }]));
  assert.equal(tree.combinator, 'and');
  assert.equal(tree.children.length, 1);
  const { params } = render(tree);
  assert.deepEqual(params, ['x']);
});

test('parseFilterParam: битый JSON — это 400, а не молча пустой фильтр', () => {
  assert.throws(
    () => parseFilterParam('{не json'),
    (err: unknown) => {
      assert.ok(err instanceof DocumentRuntimeError);
      assert.equal(err.status, 400);
      return true;
    },
  );
});

test('parseFilterParam: отсутствующий параметр — пустой фильтр', () => {
  assert.equal(parseFilterParam(undefined).children.length, 0);
});
