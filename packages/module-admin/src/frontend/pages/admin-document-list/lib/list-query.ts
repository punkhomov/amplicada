import type { FilterNode, FilterTree } from '@amplicada/platform-core/contracts';
import { countFilterConditions, normalizeFilterInput, pruneEmptyGroups } from '@amplicada/platform-core/contracts';
import type { SortingState } from '@tanstack/react-table';
import { migrateColumnKey, type TableSettings } from './table-settings.js';

/** Ключи колонок внутри сохранённого дерева — того же legacy-формата, что и в остальных настройках таблицы. */
function migrateFilterColumns(node: FilterNode): FilterNode {
  return node.kind === 'group'
    ? { ...node, children: node.children.map(migrateFilterColumns) }
    : { ...node, column: migrateColumnKey(node.column) };
}

/**
 * Единственная точка чтения сохранённых фильтров. Прогоняет через normalizeFilterInput, поэтому
 * старые блобы localStorage (плоский FilterCondition[]) продолжают работать без миграции.
 * Компонент списка и route loader обязаны звать именно её — иначе queryKey у них разъедутся.
 */
export function filtersForType(settings: TableSettings, type: string): FilterTree {
  return migrateFilterColumns(normalizeFilterInput(settings.filters?.[type])) as FilterTree;
}

/** Пустое дерево не должно превращаться в `filters=...` — иначе бэкенд получает шум, а queryKey рвётся. */
export function serializeFilters(tree: FilterTree): string | undefined {
  return countFilterConditions(tree) ? JSON.stringify(pruneEmptyGroups(tree)) : undefined;
}

export interface ListQueryArgs {
  filters: FilterTree;
  sorting?: SortingState;
  /** 1-based, как ждёт бэкенд. Не передаётся для export-view — он стримит всё. */
  page?: number;
  pageSize?: number;
  columns?: string[];
  format?: 'csv' | 'json';
}

/**
 * Единственное место, где параметры списка превращаются в query-строку: infinite-запрос,
 * pages-запрос и export-view. Раньше эта логика была продублирована в трёх местах и расходилась.
 */
export function buildListQuery({ filters, sorting, page, pageSize, columns, format }: ListQueryArgs): Record<string, string> {
  const query: Record<string, string> = {};
  if (page !== undefined) query.page = String(page);
  if (pageSize !== undefined) query.pageSize = String(pageSize);
  if (sorting?.[0]) {
    query.sortBy = sorting[0].id;
    query.sortDir = sorting[0].desc ? 'desc' : 'asc';
  }
  const serialized = serializeFilters(filters);
  if (serialized) query.filters = serialized;
  if (columns?.length) query.columns = columns.join(',');
  if (format) query.format = format;
  return query;
}
