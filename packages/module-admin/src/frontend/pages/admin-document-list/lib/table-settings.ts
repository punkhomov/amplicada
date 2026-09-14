import { DEFAULT_EXTENSION_KEY, type FilterTree } from '@amplicada/platform-core/contracts';
import type { VisibilityState } from '@tanstack/react-table';

export interface TableSettings {
  paginationMode: 'infinite' | 'pages';
  pageSize: number;
  columnOrders: Record<string, string[]>;
  stickyColumns: Record<string, { left: string[]; right: string[] }>;
  columnSizing: Record<string, Record<string, number>>;
  columnVisibility: Record<string, VisibilityState>;
  /** Читается ТОЛЬКО через filtersForType() — там нормализация legacy-блобов (плоский FilterCondition[]). */
  filters: Record<string, FilterTree>;
}

export const DEFAULT_SETTINGS: TableSettings = {
  paginationMode: 'infinite',
  pageSize: 50,
  columnOrders: {},
  stickyColumns: {},
  columnSizing: {},
  columnVisibility: {},
  filters: {},
};

export const ADMIN_TABLE_SETTINGS_KEY = 'admin-table-settings';

/**
 * Синхронное, не-хуковое чтение тех же настроек, что useLocalStorage(ADMIN_TABLE_SETTINGS_KEY, ...)
 * отдаёт компоненту (тот же ключ, та же логика parse-or-default) — источник истины один, используется
 * и компонентом, и route loader'ом (module-admin/index.tsx), где хуки недоступны.
 *
 * Блоб намеренно не мигрируется целиком: устаревшая форма фильтров для ОДНОГО типа документа не
 * должна обнулять настройки всех остальных. Нормализация — точечная, в filtersForType().
 */
export function readAdminTableSettings(): TableSettings {
  try {
    const raw = localStorage.getItem(ADMIN_TABLE_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as TableSettings) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Ключ колонки стал трёхсегментным (`module:key:field`) — модуль может зарегистрировать несколько
 * extension'ов на одном документе (см. `DocumentExtension.key`). В старых блобах localStorage лежат
 * двухсегментные ключи; достраиваем их дефолтным ключом extension'а, иначе у пользователя молча
 * слетают ширины/порядок/видимость колонок и сохранённые фильтры.
 */
export function migrateColumnKey(key: string): string {
  const parts = key.split(':');
  return parts.length === 2 ? `${parts[0]}:${DEFAULT_EXTENSION_KEY}:${parts[1]}` : key;
}

function migrateKeysOf<T>(rec: Record<string, T> | undefined): Record<string, T> {
  return Object.fromEntries(Object.entries(rec ?? {}).map(([key, value]) => [migrateColumnKey(key), value]));
}

// Точечные аксессоры per-type (как filtersForType для фильтров): единственные места чтения
// сохранённых ключей колонок, поэтому нормализация legacy-формата живёт ровно здесь.

export function columnOrderForType(settings: TableSettings, type: string): string[] {
  return (settings.columnOrders?.[type] ?? []).map(migrateColumnKey);
}

export function columnSizingForType(settings: TableSettings, type: string): Record<string, number> {
  return migrateKeysOf(settings.columnSizing?.[type]);
}

export function columnVisibilityForType(settings: TableSettings, type: string): VisibilityState {
  return migrateKeysOf(settings.columnVisibility?.[type]);
}

export function stickyColumnsForType(settings: TableSettings, type: string): { left: string[]; right: string[] } {
  const sticky = settings.stickyColumns?.[type];
  return { left: (sticky?.left ?? []).map(migrateColumnKey), right: (sticky?.right ?? []).map(migrateColumnKey) };
}
