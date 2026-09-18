import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, count, desc, eq, ilike, max, min, type SQL } from 'drizzle-orm';
import type { MetricCatalogEntryDto, MetricEventKind } from '../../contracts/index.js';
import { type MetricEventRow, type MetricsSettingsRow, metricsEvents, metricsSettings, type NewMetricEventRow } from '../schemas/index.js';

export interface EventListFilter {
  kind?: MetricEventKind;
  name?: string;
  limit?: number;
}

export type MetricsSettingsPatchRow = Partial<
  Pick<
    MetricsSettingsRow,
    'enabled' | 'retentionEventsDays' | 'samplePageviewRate' | 'sampleClickRate' | 'ingestEventsPerMinute' | 'storeRawUrls'
  >
>;

export function createPostgresMetricsStore(db: BackendDbService) {
  return {
    async insertEvents(rows: NewMetricEventRow[]): Promise<{ inserted: number; duplicates: number }> {
      if (rows.length === 0) return { inserted: 0, duplicates: 0 };
      const inserted = await db.insert(metricsEvents).values(rows).onConflictDoNothing().returning({ id: metricsEvents.id });
      return { inserted: inserted.length, duplicates: rows.length - inserted.length };
    },

    async listEvents(filter: EventListFilter = {}): Promise<MetricEventRow[]> {
      const conditions: SQL[] = [];
      if (filter.kind) conditions.push(eq(metricsEvents.kind, filter.kind));
      if (filter.name) conditions.push(ilike(metricsEvents.name, `%${filter.name}%`));
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
      return db
        .select()
        .from(metricsEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(metricsEvents.occurredAt))
        .limit(limit);
    },

    /** Что уже приходило: имя, вид, объём, первое/последнее появление — витрина для админки. */
    async catalog(limit = 200): Promise<MetricCatalogEntryDto[]> {
      const eventCount = count();
      const rows = await db
        .select({
          name: metricsEvents.name,
          kind: metricsEvents.kind,
          eventCount,
          firstSeen: min(metricsEvents.occurredAt),
          lastSeen: max(metricsEvents.occurredAt),
        })
        .from(metricsEvents)
        .groupBy(metricsEvents.name, metricsEvents.kind)
        .orderBy(desc(eventCount))
        .limit(Math.min(Math.max(limit, 1), 500));

      return rows.map(row => ({
        name: row.name,
        kind: row.kind,
        eventCount: row.eventCount,
        firstSeen: (row.firstSeen ?? new Date()).toISOString(),
        lastSeen: (row.lastSeen ?? new Date()).toISOString(),
      }));
    },

    async getSettingsRow(): Promise<MetricsSettingsRow | undefined> {
      const [row] = await db.select().from(metricsSettings).where(eq(metricsSettings.id, 'default')).limit(1);
      return row;
    },

    async updateSettingsRow(patch: MetricsSettingsPatchRow): Promise<MetricsSettingsRow | undefined> {
      const [row] = await db
        .update(metricsSettings)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(metricsSettings.id, 'default'))
        .returning();
      return row;
    },
  };
}

export type PostgresMetricsStore = ReturnType<typeof createPostgresMetricsStore>;
