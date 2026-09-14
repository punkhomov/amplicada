import { FILTER_MAX_IN_VALUES, type FilterCondition, type FilterNode, type FilterOperator, type FilterTree } from './documents.js';

/**
 * Чистые утилиты работы с деревом фильтра — без drizzle и без React, поэтому импортируются
 * и бэкендом (filter-sql.ts), и фронтендом (диалог фильтров, list-query, route loader).
 *
 * NB: это НЕ тот же формат, что JSONLogic-условия в module-workflow/src/backend/conditions.ts.
 * Там условия вычисляются в JS поверх payload'а, здесь — компилируются в SQL: нужны ilike,
 * between, isEmpty и слот «колонка» в фиксированной позиции, чего у JSONLogic нет.
 * Форматы намеренно раздельные, объединять их не следует.
 */

export const EMPTY_FILTER: FilterTree = { kind: 'group', combinator: 'and', children: [] };

function normalizeCondition(rec: Record<string, unknown>): FilterCondition | null {
  if (typeof rec.column !== 'string' || typeof rec.operator !== 'string') return null;
  const cond: FilterCondition = {
    kind: 'condition',
    column: rec.column,
    // Оператор пропускается как есть — допустимость для конкретной колонки проверяет
    // buildFilterWhere на бэкенде, который на нарушение отвечает 400.
    operator: rec.operator as FilterOperator,
  };
  if (typeof rec.value === 'string') cond.value = rec.value;
  if (typeof rec.value2 === 'string') cond.value2 = rec.value2;
  if (Array.isArray(rec.values)) {
    cond.values = rec.values.filter((v): v is string => typeof v === 'string').slice(0, FILTER_MAX_IN_VALUES);
  }
  return cond;
}

function normalizeNode(input: unknown): FilterNode | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;

  if (Array.isArray(rec.children)) {
    return {
      kind: 'group',
      combinator: rec.combinator === 'or' ? 'or' : 'and',
      children: rec.children.map(normalizeNode).filter((n): n is FilterNode => n !== null),
    };
  }
  return normalizeCondition(rec);
}

/**
 * Приводит ЛЮБОЕ исторически валидное представление фильтра к FilterTree:
 * undefined | null | '' | FilterCondition[] (legacy, неявный AND) | FilterNode | FilterTree.
 * Никогда не бросает — мусор молча отбрасывает. Семантику (существование колонки, допустимость
 * оператора) не проверяет, это делает бэкенд.
 *
 * ИДЕМПОТЕНТНА и ДЕТЕРМИНИРОВАНА — на этом держится совпадение queryKey между route loader'ом
 * и компонентом списка. Никаких randomUUID/Date.now внутри.
 */
export function normalizeFilterInput(input: unknown): FilterTree {
  if (input === undefined || input === null || input === '') return EMPTY_FILTER;

  // Legacy-формат: плоский массив условий, склеенных неявным AND.
  if (Array.isArray(input)) {
    return {
      kind: 'group',
      combinator: 'and',
      children: input.map(normalizeNode).filter((n): n is FilterNode => n !== null),
    };
  }

  const node = normalizeNode(input);
  if (!node) return EMPTY_FILTER;
  // Корень всегда группа: одиночное условие заворачивается.
  return node.kind === 'group' ? node : { kind: 'group', combinator: 'and', children: [node] };
}

/** Число ЛИСТЬЕВ (условий) в дереве — для бейджа тулбара и проверки «фильтр пуст?». */
export function countFilterConditions(node: FilterNode): number {
  if (node.kind === 'condition') return 1;
  let total = 0;
  for (const child of node.children) total += countFilterConditions(child);
  return total;
}

/**
 * Убирает группы, не содержащие ни одного условия. Фронт зовёт перед отправкой, чтобы пустая
 * группа (пользователь добавил, но не заполнил) не уходила на бэкенд: пустая группа не сужает
 * и не расширяет выборку — она просто исчезает, и это единственный оставшийся путь «тихого
 * исчезновения» условия.
 */
export function pruneEmptyGroups(tree: FilterTree): FilterTree {
  const prune = (node: FilterNode): FilterNode | null => {
    if (node.kind === 'condition') return node;
    const children = node.children.map(prune).filter((n): n is FilterNode => n !== null);
    return children.length ? { ...node, children } : null;
  };
  return { ...tree, children: tree.children.map(prune).filter((n): n is FilterNode => n !== null) };
}

/** Глубина дерева: корневая группа — 0, её прямые дети-условия — 1. */
export function filterDepth(node: FilterNode): number {
  if (node.kind === 'condition') return 0;
  let max = 0;
  for (const child of node.children) max = Math.max(max, filterDepth(child) + 1);
  return max;
}
