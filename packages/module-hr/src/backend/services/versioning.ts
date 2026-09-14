import { isPgErrorCode, PG_EXCLUSION_VIOLATION } from '@amplicada/platform-core/backend';
import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, eq, getTableColumns, isNull } from 'drizzle-orm';
import { VersionOverlapError } from './errors.js';
import { dayBefore, definedOnly, todayIso, versionWriteMode } from './version-mode.js';

export { dayBefore, definedOnly, todayIso, versionWriteMode } from './version-mode.js';

/**
 * Колонки, которые НЕ переносятся со старой версии на новую: ключ строки, границы интервала и штамп
 * записи. Всё остальное копируется как есть, а поверх ложатся переданные изменения.
 */
const NOT_CARRIED = new Set(['id', 'nodeId', 'validFrom', 'validTo', 'createdAt', 'createdByUserId', 'sourceDocumentId', 'comment']);

export interface VersionAudit {
  performedByUserId: string;
  sourceDocumentId?: string | null;
  comment?: string | null;
}

export interface WriteVersionParams {
  nodeId: string;
  /**
   * `null` — **коррекция записи**: мы неверно записали факт и исправляем его, интервал действия не
   * двигается. Это то, что делает карточка документа: она generic CRUD-форма без поля «действует с»,
   * то есть источником valid-time событий не является.
   *
   * Дата — **новый факт с этой даты**: текущая версия закрывается днём раньше, вставляется новая.
   * Так работают явные операции (`deactivateX`, `transferEmployee`, будущие «приказы»).
   */
  effectiveDate: string | null;
  /** Только изменившиеся поля версии; остальные переносятся с текущей. */
  values: Record<string, unknown>;
  audit: VersionAudit;
}

/**
 * Единственная точка записи в `hr_*_version`. Раньше здесь был `closeCurrentAndInsertVersion(close,
 * insert)` — он ничего не знал о данных, поэтому сборка значений дублировалась во всех девяти
 * вызывающих, а решение «коррекция или новый интервал» принять было негде.
 *
 * Ключевая развилка — две оси времени. `valid_from`/`valid_to` отвечают на вопрос «когда факт был
 * верен в реальности», а исправление опечатки — событие другой оси, «когда мы это записали».
 * Модель уни-темпоральная (второй оси нет), поэтому коррекция выражается правкой текущей версии
 * на месте. Подробности и отвергнутые варианты — ref/plans/2026-08-05-document-model/05-hr-versioning.md.
 */
export async function writeVersion<T>(
  db: BackendDbService,
  // biome-ignore lint/suspicious/noExplicitAny: runtime Drizzle table — динамически не типизируется
  table: any,
  { nodeId, effectiveDate, values, audit }: WriteVersionParams,
): Promise<T> {
  const columns = getTableColumns(table);
  const [current] = await db
    .select()
    .from(table)
    .where(and(eq(columns.nodeId, nodeId), isNull(columns.validTo)))
    .limit(1);

  const stamp = {
    createdByUserId: audit.performedByUserId,
    sourceDocumentId: audit.sourceDocumentId ?? null,
    comment: audit.comment ?? null,
  };
  const changes = definedOnly(values);
  const currentValidFrom = current ? String((current as Record<string, unknown>).validFrom) : undefined;

  if (versionWriteMode(currentValidFrom, effectiveDate) === 'correction') {
    const [row] = await db
      .update(table)
      .set({ ...changes, ...stamp })
      .where(eq(columns.id, (current as Record<string, unknown>).id))
      .returning();
    return row as T;
  }

  const validFrom = effectiveDate ?? todayIso();
  if (current) {
    await db
      .update(table)
      .set({ validTo: dayBefore(validFrom) })
      .where(and(eq(columns.nodeId, nodeId), isNull(columns.validTo)));
  }

  const carried: Record<string, unknown> = {};
  if (current) {
    for (const key of Object.keys(columns)) {
      if (!NOT_CARRIED.has(key)) carried[key] = (current as Record<string, unknown>)[key];
    }
  }

  try {
    // biome-ignore lint/suspicious/noExplicitAny: schema any → PgInsert не типизируется динамически
    const [row] = await (db.insert(table) as any).values({ ...carried, ...changes, nodeId, validFrom, ...stamp }).returning();
    return row as T;
  } catch (err) {
    // Exclusion-констрейнт на `_version`-таблицах — последняя линия обороны от пересечения дат.
    // Код драйвера ищется по цепочке `cause`: drizzle оборачивает ошибку запроса в DrizzleQueryError.
    if (isPgErrorCode(err, PG_EXCLUSION_VIOLATION)) throw new VersionOverlapError();
    throw err;
  }
}
