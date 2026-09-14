import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { eq, getTableColumns } from 'drizzle-orm';

/**
 * Заводит (или правит) строку узла Node+Version-документа.
 *
 * Раньше её вставлял generic `create()` из «базовой таблицы типа». С этапа 3 плана 06 базовой
 * таблицы у типа документа нет вовсе: id рождается в `document_index`, а все данные пишут
 * расширения — значит узел обязан завести сам `save` расширения.
 *
 * UPDATE-then-INSERT, а не `ON CONFLICT DO UPDATE`: у узлов есть NOT NULL-колонки, которых карточка
 * при частичном сохранении не присылает, а Postgres проверяет NOT NULL при формировании кортежа —
 * до разрешения конфликта. Лишний запрос платится только при первом сохранении документа.
 *
 * `values` без ключей (правка, не задевшая колонок узла) — не повод пропускать проверку: строки
 * может ещё не быть, и тогда версия ниже упала бы на внешнем ключе.
 */
export async function ensureNodeRow(
  db: BackendDbService,
  // biome-ignore lint/suspicious/noExplicitAny: runtime Drizzle table
  table: any,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const idCol = getTableColumns(table).id;

  if (Object.keys(values).length) {
    const touched = await db.update(table).set(values).where(eq(idCol, id)).returning({ id: idCol });
    if (touched.length) return;
  } else {
    const [found] = await db.select({ id: idCol }).from(table).where(eq(idCol, id)).limit(1);
    if (found) return;
  }

  // biome-ignore lint/suspicious/noExplicitAny: schema any → PgInsert не типизируется динамически
  await (db.insert(table) as any).values({ id, ...values });
}
