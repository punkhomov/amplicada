import type {
  FilterCombinator,
  FilterCondition,
  FilterNode,
  FilterOperator,
  FilterTree,
  ListFieldMeta,
} from '@amplicada/platform-core/contracts';
import { DEFAULT_FILTER_OPERATORS, FILTER_OPERATORS_BY_TYPE } from '@amplicada/platform-core/contracts';

export type ColumnEntry = [string, ListFieldMeta];

export const OPERATOR_LABEL_KEYS: Record<FilterOperator, string> = {
  eq: 'admin_filter_op_eq',
  ne: 'admin_filter_op_ne',
  contains: 'admin_filter_op_contains',
  notContains: 'admin_filter_op_not_contains',
  in: 'admin_filter_op_in',
  notIn: 'admin_filter_op_not_in',
  isEmpty: 'admin_filter_op_is_empty',
  isNotEmpty: 'admin_filter_op_is_not_empty',
  gt: 'admin_filter_op_gt',
  gte: 'admin_filter_op_gte',
  lt: 'admin_filter_op_lt',
  lte: 'admin_filter_op_lte',
  between: 'admin_filter_op_between',
};

export function operatorsFor(meta: ListFieldMeta | undefined): FilterOperator[] {
  return FILTER_OPERATORS_BY_TYPE[meta?.type ?? ''] ?? DEFAULT_FILTER_OPERATORS;
}

export function valueInputType(type: string | undefined): string {
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime-local';
  return 'text';
}

/** Оператору не нужно значение вовсе. */
export function operatorNeedsNoValue(op: FilterOperator): boolean {
  return op === 'isEmpty' || op === 'isNotEmpty';
}

/** Оператор работает со списком значений (values), а не с одиночным value. */
export function operatorIsMultiValue(op: FilterOperator): boolean {
  return op === 'in' || op === 'notIn';
}

/**
 * Драфт диалога. Держит стабильные id для ключей React: индексные ключи ломаются на
 * удалении/реордере строк (фокус прыгает не в тот инпут). id НИКОГДА не попадает в FilterTree —
 * дерево уходит в queryKey, и любой randomUUID внутри давал бы рефетч при каждом открытии диалога.
 *
 * Тип драфта заодно и есть ограничение глубины: дети группы — DraftCondition, не DraftItem,
 * поэтому вложить группу в группу через UI структурно невозможно.
 */
export interface DraftCondition {
  id: string;
  condition: FilterCondition;
}

export type DraftItem =
  | { id: string; kind: 'condition'; condition: FilterCondition }
  | { id: string; kind: 'group'; combinator: FilterCombinator; children: DraftCondition[] };

export interface DraftState {
  combinator: FilterCombinator;
  items: DraftItem[];
}

export function makeCondition(columns: ColumnEntry[]): FilterCondition {
  const [firstKey, firstMeta] = columns[0] ?? ['', undefined];
  return { kind: 'condition', column: firstKey, operator: operatorsFor(firstMeta)[0] ?? 'eq' };
}

export function makeDraftCondition(columns: ColumnEntry[]): DraftCondition {
  return { id: crypto.randomUUID(), condition: makeCondition(columns) };
}

export function draftToTree(draft: DraftState): FilterTree {
  return {
    kind: 'group',
    combinator: draft.combinator,
    children: draft.items.flatMap<FilterNode>(item => {
      if (item.kind === 'condition') return [item.condition];
      // Пустые группы отсекаются здесь же — на бэкенд они не уходят.
      return item.children.length ? [{ kind: 'group', combinator: item.combinator, children: item.children.map(c => c.condition) }] : [];
    }),
  };
}

export interface TreeToDraftResult {
  draft: DraftState;
  /**
   * true, если дерево было глубже, чем умеет показать UI (создано через API или более поздней
   * версией интерфейса), и при редактировании будет упрощено. Диалог обязан предупредить.
   */
  flattened: boolean;
}

/** Собирает все листья поддерева в плоский список — для схлопывания слишком глубоких веток. */
function collectConditions(node: FilterNode, out: FilterCondition[]): void {
  if (node.kind === 'condition') {
    out.push(node);
    return;
  }
  for (const child of node.children) collectConditions(child, out);
}

export function treeToDraft(tree: FilterTree): TreeToDraftResult {
  let flattened = false;
  const items: DraftItem[] = tree.children.map(child => {
    if (child.kind === 'condition') return { id: crypto.randomUUID(), kind: 'condition', condition: child };
    // Группа второго уровня: её собственные вложенные группы UI показать не может — схлопываем
    // их листья в эту же группу и сообщаем наверх, что дерево упрощено.
    const leaves: FilterCondition[] = [];
    for (const grandchild of child.children) {
      if (grandchild.kind === 'group') flattened = true;
      collectConditions(grandchild, leaves);
    }
    return {
      id: crypto.randomUUID(),
      kind: 'group',
      combinator: child.combinator,
      children: leaves.map(condition => ({ id: crypto.randomUUID(), condition })),
    };
  });
  return { draft: { combinator: tree.combinator, items }, flattened };
}
