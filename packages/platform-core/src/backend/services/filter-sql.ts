import { and, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, notIlike, notInArray, or, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  DEFAULT_FILTER_OPERATORS,
  FILTER_MAX_DEPTH,
  FILTER_MAX_IN_VALUES,
  FILTER_MAX_NODES,
  FILTER_OPERATORS_BY_TYPE,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterTree,
  type ListFieldMeta,
} from '../../contracts/documents.js';
import { normalizeFilterInput } from '../../contracts/filters.js';
import { DocumentRuntimeError } from './document-runtime-error.js';

/** Реальная колонка (per-module таблица) либо computed SQL-выражение (jsonb customFields). */
type ListColumn = PgColumn | SQL.Aliased;

export interface FilterIssue {
  /** Путь до проблемного узла в дереве, напр. `$.children[2]`. */
  path: string;
  code: string;
  message: string;
}

interface Ctx {
  columns: Record<string, ListFieldMeta>;
  selectObj: Record<string, ListColumn>;
  issues: FilterIssue[];
  nodes: number;
}

function issue(ctx: Ctx, path: string, code: string, message: string): undefined {
  ctx.issues.push({ path, code, message });
  return undefined;
}

/**
 * `\`, `%` и `_` — метасимволы LIKE. Без экранирования поиск «50%» превращается в шаблон
 * «50<что угодно>» и возвращает мусор. standard_conforming_strings=on, поэтому escape-символ
 * по умолчанию `\` и клауза ESCAPE не нужна (drizzle её и не предлагает).
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, m => `\\${m}`);
}

/**
 * `col <> 'x'`, `col NOT ILIKE ...` и `col NOT IN (...)` в SQL не матчат NULL (результат — NULL,
 * то есть «не подошло»). Пользователь ожидает, что «не равно X» включает пустые значения, и
 * legacy-продукт (как и Airtable «is not») ведёт себя именно так. Под чистым AND это редко
 * замечали, с OR — заметят сразу.
 */
function nullSafeNegative(clause: SQL, column: PgColumn): SQL {
  return or(clause, isNull(column)) as SQL;
}

export function coerceValue(type: string | undefined, raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  switch (type) {
    case 'checkbox':
      return raw === 'true' || raw === '1';
    case 'number': {
      const n = Number(raw);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'date':
    case 'datetime': {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
    default:
      return raw;
  }
}

function buildCondition(cond: FilterCondition, ctx: Ctx, path: string): SQL | undefined {
  // BinaryOperator (eq/gt/...) не резолвит overload по union-типу аргумента; PgColumn/SQL.Aliased
  // равнозначны для рантайма — drizzle просто встраивает left в sql-шаблон, is(Column) здесь не проверяется.
  const column = ctx.selectObj[cond.column] as PgColumn | undefined;
  const meta = ctx.columns[cond.column];
  if (!column || !meta) return issue(ctx, path, 'unknown_column', `Неизвестная колонка фильтра: '${cond.column}'`);
  if (meta.filterable === false) {
    return issue(ctx, path, 'not_filterable', `Колонка '${cond.column}' недоступна для фильтрации`);
  }

  const allowed = FILTER_OPERATORS_BY_TYPE[meta.type ?? ''] ?? DEFAULT_FILTER_OPERATORS;
  if (!allowed.includes(cond.operator)) {
    return issue(ctx, path, 'operator_not_allowed', `Оператор '${cond.operator}' недопустим для колонки '${cond.column}'`);
  }

  switch (cond.operator) {
    case 'isEmpty':
      return isNull(column);
    case 'isNotEmpty':
      return isNotNull(column);

    case 'in':
    case 'notIn': {
      const raw = cond.values;
      if (!Array.isArray(raw) || raw.length === 0) {
        return issue(ctx, path, 'values_required', `Оператор '${cond.operator}' требует непустой список значений`);
      }
      if (raw.length > FILTER_MAX_IN_VALUES) {
        return issue(ctx, path, 'too_many_values', `Не более ${FILTER_MAX_IN_VALUES} значений в списке`);
      }
      const values = raw.map(v => coerceValue(meta.type, v));
      if (values.some(v => v === undefined)) {
        return issue(ctx, path, 'bad_value', `Значение неприводимо к типу '${meta.type ?? 'text'}'`);
      }
      return cond.operator === 'in' ? inArray(column, values) : nullSafeNegative(notInArray(column, values), column);
    }

    case 'between': {
      const a = coerceValue(meta.type, cond.value);
      const b = coerceValue(meta.type, cond.value2);
      if (a === undefined || b === undefined) {
        return issue(ctx, path, 'bad_value', `Оператор 'between' требует обе границы`);
      }
      return and(gte(column, a), lte(column, b)) as SQL;
    }

    default: {
      const value = coerceValue(meta.type, cond.value);
      if (value === undefined) {
        return issue(ctx, path, 'bad_value', `Значение неприводимо к типу '${meta.type ?? 'text'}'`);
      }
      switch (cond.operator) {
        case 'eq':
          return eq(column, value);
        case 'ne':
          return nullSafeNegative(ne(column, value), column);
        // ::text — тотальный способ применить ilike к колонке любого типа. Индекс всё равно не
        // используется (ilike '%x%' не sargable), зато contains по uuid/timestamp больше не роняет запрос.
        case 'contains':
          return ilike(sql`${column}::text` as unknown as PgColumn, `%${escapeLike(String(value))}%`);
        case 'notContains':
          return nullSafeNegative(notIlike(sql`${column}::text` as unknown as PgColumn, `%${escapeLike(String(value))}%`), column);
        case 'gt':
          return gt(column, value);
        case 'gte':
          return gte(column, value);
        case 'lt':
          return lt(column, value);
        case 'lte':
          return lte(column, value);
        default: {
          // Исчерпывающая проверка: новый оператор в FilterOperator не соберётся, пока его тут не обработают.
          const unhandled: never = cond.operator;
          return issue(ctx, path, 'operator_unhandled', `Оператор '${String(unhandled)}' не реализован`);
        }
      }
    }
  }
}

function buildGroup(group: FilterGroup, ctx: Ctx, path: string, depth: number): SQL | undefined {
  const parts: SQL[] = [];
  group.children.forEach((child, i) => {
    const part = buildNode(child, ctx, `${path}.children[${i}]`, depth + 1);
    if (part) parts.push(part);
  });
  // Пустая группа не сужает и не расширяет выборку — она просто исчезает. Это единственный
  // оставшийся путь «тихого исчезновения» условия, и он возможен только по явному действию
  // пользователя (добавил группу, не заполнил). Фронт зовёт pruneEmptyGroups перед отправкой.
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return (group.combinator === 'or' ? or(...parts) : and(...parts)) as SQL;
}

function buildNode(node: FilterNode, ctx: Ctx, path: string, depth: number): SQL | undefined {
  if (depth > FILTER_MAX_DEPTH) {
    return issue(ctx, path, 'max_depth', `Превышена вложенность фильтра (максимум ${FILTER_MAX_DEPTH})`);
  }
  ctx.nodes += 1;
  if (ctx.nodes > FILTER_MAX_NODES) {
    return issue(ctx, path, 'max_nodes', `Слишком много условий в фильтре (максимум ${FILTER_MAX_NODES})`);
  }
  return node.kind === 'group' ? buildGroup(node, ctx, path, depth) : buildCondition(node, ctx, path);
}

/**
 * Компилирует дерево фильтра в WHERE-клаузу.
 *
 * Любая проблема (неизвестная колонка, недопустимый оператор, неприводимое значение) — это 400,
 * а НЕ тихий пропуск условия. Под старым чистым AND пропуск лишь расширял выборку; с OR он
 * становится семантически опасным: пропуск листа внутри OR сужает выборку, а пропуск всех
 * листьев группы убирает группу из родительского AND и расширяет её. Молчаливый 200 с
 * неправильными строками — худший вариант отказа.
 *
 * Проблемы собираются целиком и отдаются разом, чтобы пользователь чинил фильтр за один заход.
 */
export function buildFilterWhere(
  tree: FilterTree,
  columns: Record<string, ListFieldMeta>,
  selectObj: Record<string, ListColumn>,
): SQL | undefined {
  const ctx: Ctx = { columns, selectObj, issues: [], nodes: 0 };
  const clause = buildNode(tree, ctx, '$', 0);
  if (ctx.issues.length) {
    const summary = ctx.issues.map(i => i.message).join('; ');
    throw new DocumentRuntimeError(400, `Некорректный фильтр: ${summary}`, ctx.issues);
  }
  return clause;
}

/** Разбирает query-параметр `filters` (JSON) в нормализованное дерево. Битый JSON — 400, а не пустой фильтр. */
export function parseFilterParam(raw: string | undefined): FilterTree {
  if (!raw) return normalizeFilterInput(undefined);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DocumentRuntimeError(400, 'Параметр filters должен быть корректным JSON');
  }
  return normalizeFilterInput(parsed);
}
