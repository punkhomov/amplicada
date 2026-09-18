import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { sql } from 'drizzle-orm';

const PARTITION_RE = /^events_(\d{4})_(\d{2})$/;

export function partitionName(date: Date): string {
  return `events_${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Гарантирует партиции на текущий и следующие месяцы: вставка не должна падать без партиции. */
export async function ensureEventPartitions(db: BackendDbService, monthsAhead = 2): Promise<string[]> {
  const ensured: string[] = [];
  const now = new Date();
  for (let i = 0; i <= monthsAhead; i += 1) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    const name = partitionName(from);
    await db.execute(
      sql.raw(
        `create table if not exists metrics.${name} partition of metrics.events for values from ('${from.toISOString()}') to ('${to.toISOString()}')`,
      ),
    );
    ensured.push(name);
  }
  return ensured;
}

/** Удаляет партиции, полностью вышедшие за retention: `DETACH ... CONCURRENTLY` + `DROP`. */
export async function dropExpiredEventPartitions(db: BackendDbService, retentionDays: number): Promise<string[]> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoffMonth = Date.UTC(new Date(cutoff).getUTCFullYear(), new Date(cutoff).getUTCMonth(), 1);

  const result = await db.execute(sql`
    select c.relname as name
    from pg_class c
    join pg_inherits i on i.inhrelid = c.oid
    join pg_class p on p.oid = i.inhparent
    join pg_namespace n on n.oid = p.relnamespace
    where n.nspname = 'metrics' and p.relname = 'events'
  `);

  const dropped: string[] = [];
  for (const row of result.rows as { name: string }[]) {
    const match = PARTITION_RE.exec(row.name);
    if (!match) continue;
    const partitionEnd = Date.UTC(Number(match[1]), Number(match[2]), 1);
    if (partitionEnd > cutoffMonth) continue;
    await db.execute(sql.raw(`alter table metrics.events detach partition metrics.${row.name} concurrently`));
    await db.execute(sql.raw(`drop table if exists metrics.${row.name}`));
    dropped.push(row.name);
  }
  return dropped;
}
