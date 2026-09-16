import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { ListFieldMeta } from '../../contracts/documents.js';
import { DocumentRuntimeError } from './document-runtime-error.js';

type ListColumn = PgColumn | SQL.Aliased;

/** Первый поисковый адаптер: PostgreSQL FTS поверх текстовых полей зарегистрированного списка. */
export function postgresListSearchWhere(
  rawSearch: string | undefined,
  columns: Record<string, ListFieldMeta>,
  selectObj: Record<string, ListColumn>,
): SQL | undefined {
  if (rawSearch === undefined) return undefined;
  const search = rawSearch.trim();
  if (search.length > 200) throw new DocumentRuntimeError(400, 'Поисковый запрос не длиннее 200 символов');
  if (!search) return undefined;

  const searchable = Object.entries(columns)
    .filter(
      ([key, meta]) =>
        !!selectObj[key] &&
        meta.searchable !== false &&
        (meta.searchable === true || meta.type === undefined || meta.type === 'text' || meta.type === 'select'),
    )
    .map(([key]) => selectObj[key]);
  if (!searchable.length) return sql`false`;

  const parts = searchable.map(column => sql`coalesce((${'sql' in column ? column.sql : column})::text, '')`);
  const body = sql`concat_ws(' ', ${sql.join(parts, sql`, `)})`;
  return sql`to_tsvector('russian', ${body}) @@ websearch_to_tsquery('russian', ${search})`;
}
