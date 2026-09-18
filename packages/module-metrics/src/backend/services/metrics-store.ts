import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, desc, eq, ilike, type SQL } from 'drizzle-orm';
import type { MetricEventKind } from '../../contracts/index.js';
import { type MetricEventRow, type MetricsSettingsRow, metricsEvents, metricsSettings, type NewMetricEventRow } from '../schemas/index.js';

export interface EventListFilter {
  kind?: MetricEventKind;
  name?: string;
  limit?: number;
}

export type MetricsSettingsPatchRow = Partial<
  Pick<MetricsSettingsRow, 'enabled' | 'retentionEventsDays' | 'samplePageviewRate' | 'sampleClickRate' | 'storeRawUrls'>
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
