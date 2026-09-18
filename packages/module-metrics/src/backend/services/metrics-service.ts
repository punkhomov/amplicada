import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import type {
  ClientEventInput,
  CollectResponse,
  MetricCatalogEntryDto,
  MetricEventDto,
  MetricsContextDto,
  MetricsSettingsDto,
  MetricsSettingsPatch,
  RouteSummaryDto,
  SlowQueryDto,
  SqlSummaryDto,
} from '../../contracts/index.js';
import type { CollectorConfig } from '../collectors/config.js';
import type { SlowQueryInsert } from '../collectors/sql-collector.js';
import type { MetricEventRow, MetricsSettingsRow } from '../schemas/index.js';
import type { AggregatedMeasurement } from './measurement-buffer.js';
import { createPostgresMetricsStore, type EventListFilter } from './metrics-store.js';
import { dropExpiredPartitions, ensurePartitions } from './partitions.js';
import type { Pseudonymizer } from './pseudonym.js';
import type { IngestRateLimiter, RateLimitDecision } from './rate-limiter.js';
import { DEFAULT_EVENT_LIMITS, validateBatch } from './validation.js';

const SLOW_QUERIES_RETENTION_DAYS = 7;

export class MetricsSettingsError extends Error {}

export interface MetricsActor {
  userId?: string;
}

export interface MetricsService {
  collect(rawBody: unknown, actor?: MetricsActor): Promise<CollectResponse>;
  listEvents(filter?: EventListFilter): Promise<MetricEventDto[]>;
  listCatalog(): Promise<MetricCatalogEntryDto[]>;
  routesSummary(from: Date, to: Date): Promise<RouteSummaryDto[]>;
  sqlSummary(from: Date, to: Date, limit?: number): Promise<SqlSummaryDto[]>;
  slowQueries(from: Date, to: Date, limit?: number): Promise<SlowQueryDto[]>;
  writeMeasurements(points: AggregatedMeasurement[]): Promise<void>;
  upsertSqlFingerprints(entries: { fingerprint: string; queryText: string }[]): Promise<void>;
  insertSlowQueries(rows: SlowQueryInsert[]): Promise<void>;
  getCollectorConfig(): Promise<CollectorConfig>;
  /** Минутный лимит приёма по ключу (хеш сессии/пользователя/IP) — вызывается до `collect`. */
  checkIngestRate(key: string, cost: number): Promise<RateLimitDecision>;
  getSettings(): Promise<MetricsSettingsDto>;
  updateSettings(patch: MetricsSettingsPatch): Promise<MetricsSettingsDto>;
  getContext(): Promise<MetricsContextDto>;
  ensurePartitions(): Promise<string[]>;
  prune(): Promise<string[]>;
}

function toSettingsDto(row: MetricsSettingsRow): MetricsSettingsDto {
  return {
    enabled: row.enabled,
    retentionEventsDays: row.retentionEventsDays,
    samplePageviewRate: row.samplePageviewRate,
    sampleClickRate: row.sampleClickRate,
    ingestEventsPerMinute: row.ingestEventsPerMinute,
    retentionPointsDays: row.retentionPointsDays,
    slowSqlThresholdMs: row.slowSqlThresholdMs,
    sampleSqlRate: row.sampleSqlRate,
    storeRawUrls: row.storeRawUrls,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEventDto(row: MetricEventRow): MetricEventDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    name: row.name,
    kind: row.kind,
    module: row.module,
    actorKind: row.actorKind,
    actorHash: row.actorHash,
    sessionHash: row.sessionHash,
    route: row.route,
    url: row.url,
    referrer: row.referrer,
    release: row.release,
    attributes: row.attributes,
    measures: row.measures,
    samplingRate: row.samplingRate,
  };
}

function clampRate(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new MetricsSettingsError(`${field} must be between 0 and 1`);
  }
  return value;
}

export function createMetricsService({
  db,
  pseudonymizer,
  limiter,
}: {
  db: BackendDbService;
  pseudonymizer: Pseudonymizer;
  limiter: IngestRateLimiter;
}): MetricsService {
  const store = createPostgresMetricsStore(db);

  async function settingsOrThrow(): Promise<MetricsSettingsRow> {
    const row = await store.getSettingsRow();
    if (!row) throw new MetricsSettingsError('Metrics settings row is missing — migrations not applied?');
    return row;
  }

  return {
    async collect(rawBody, actor) {
      const batch = validateBatch(rawBody, DEFAULT_EVENT_LIMITS);
      const settings = await settingsOrThrow();
      if (!settings.enabled) {
        return { accepted: 0, duplicates: 0, overflow: batch.overflow, rejected: batch.rejected, disabled: true };
      }

      const rows = batch.accepted.map(event => {
        const occurredAt = new Date(event.occurredAt);
        return {
          id: event.id,
          occurredAt,
          name: event.name,
          kind: event.kind,
          module: null,
          actorKind: actor?.userId ? 'user' : 'anonymous',
          actorHash: actor?.userId ? pseudonymizer.forUser(actor.userId) : null,
          sessionHash: event.sessionId ? pseudonymizer.forSession(event.sessionId) : null,
          route: event.context?.route ?? null,
          url: event.context?.url ?? null,
          referrer: event.context?.referrer ?? null,
          release: null,
          instance: null,
          attributes: event.attributes ?? {},
          measures: event.measures ?? {},
          samplingRate: event.sampling?.rate ?? null,
          schemaVersion: 1,
        };
      });

      const { inserted, duplicates } = await store.insertEvents(rows);
      return { accepted: inserted, duplicates, overflow: batch.overflow, rejected: batch.rejected };
    },

    async listEvents(filter = {}) {
      const rows = await store.listEvents(filter);
      return rows.map(toEventDto);
    },

    async listCatalog() {
      return store.catalog();
    },

    async routesSummary(from, to) {
      return store.routesSummary(from, to);
    },

    async sqlSummary(from, to, limit) {
      return store.sqlSummary(from, to, limit);
    },

    async slowQueries(from, to, limit) {
      const rows = await store.listSlowQueries(from, to, limit);
      return rows.map(row => ({
        at: row.at.toISOString(),
        fingerprint: row.fingerprint,
        queryText: row.queryText,
        route: row.route,
        durationMs: row.durationMs,
        rowCount: row.rowCount,
        errorCode: row.errorCode,
        requestId: row.requestId,
      }));
    },

    async writeMeasurements(points) {
      await store.writeMeasurements(points);
    },

    async upsertSqlFingerprints(entries) {
      await store.upsertSqlFingerprints(entries);
    },

    async insertSlowQueries(rows) {
      await store.insertSlowQueries(rows);
    },

    async getCollectorConfig() {
      const settings = await settingsOrThrow();
      return {
        enabled: settings.enabled,
        sampleSqlRate: settings.sampleSqlRate,
        slowSqlThresholdMs: settings.slowSqlThresholdMs,
      };
    },

    async checkIngestRate(key, cost) {
      const settings = await settingsOrThrow();
      return limiter.consume(key, cost, settings.ingestEventsPerMinute);
    },

    async getSettings() {
      return toSettingsDto(await settingsOrThrow());
    },

    async updateSettings(patch) {
      const values: Parameters<typeof store.updateSettingsRow>[0] = {};
      if (patch.enabled !== undefined) values.enabled = Boolean(patch.enabled);
      if (patch.retentionEventsDays !== undefined) {
        if (!Number.isInteger(patch.retentionEventsDays) || patch.retentionEventsDays < 1 || patch.retentionEventsDays > 3650) {
          throw new MetricsSettingsError('retentionEventsDays must be an integer between 1 and 3650');
        }
        values.retentionEventsDays = patch.retentionEventsDays;
      }
      if (patch.retentionPointsDays !== undefined) {
        if (!Number.isInteger(patch.retentionPointsDays) || patch.retentionPointsDays < 1 || patch.retentionPointsDays > 3650) {
          throw new MetricsSettingsError('retentionPointsDays must be an integer between 1 and 3650');
        }
        values.retentionPointsDays = patch.retentionPointsDays;
      }
      if (patch.slowSqlThresholdMs !== undefined) {
        if (!Number.isInteger(patch.slowSqlThresholdMs) || patch.slowSqlThresholdMs < 1 || patch.slowSqlThresholdMs > 600_000) {
          throw new MetricsSettingsError('slowSqlThresholdMs must be an integer between 1 and 600000');
        }
        values.slowSqlThresholdMs = patch.slowSqlThresholdMs;
      }
      if (patch.sampleSqlRate !== undefined) values.sampleSqlRate = clampRate(patch.sampleSqlRate, 'sampleSqlRate');
      if (patch.samplePageviewRate !== undefined) values.samplePageviewRate = clampRate(patch.samplePageviewRate, 'samplePageviewRate');
      if (patch.sampleClickRate !== undefined) values.sampleClickRate = clampRate(patch.sampleClickRate, 'sampleClickRate');
      if (patch.ingestEventsPerMinute !== undefined) {
        if (!Number.isInteger(patch.ingestEventsPerMinute) || patch.ingestEventsPerMinute < 1 || patch.ingestEventsPerMinute > 100_000) {
          throw new MetricsSettingsError('ingestEventsPerMinute must be an integer between 1 and 100000');
        }
        values.ingestEventsPerMinute = patch.ingestEventsPerMinute;
      }
      if (patch.storeRawUrls !== undefined) values.storeRawUrls = Boolean(patch.storeRawUrls);

      const row = await store.updateSettingsRow(values);
      if (!row) throw new MetricsSettingsError('Metrics settings row is missing — migrations not applied?');
      return toSettingsDto(row);
    },

    async getContext() {
      const settings = await settingsOrThrow();
      return {
        enabled: settings.enabled,
        sampleRates: { pageview: settings.samplePageviewRate, ui: settings.sampleClickRate },
        limits: {
          maxBatchEvents: DEFAULT_EVENT_LIMITS.maxEventsPerBatch,
          maxEventBytes: DEFAULT_EVENT_LIMITS.maxEventBytes,
          maxAttributes: DEFAULT_EVENT_LIMITS.maxAttributes,
          maxStringLength: DEFAULT_EVENT_LIMITS.maxStringLength,
        },
      };
    },

    async ensurePartitions() {
      return [
        ...(await ensurePartitions(db, 'events')),
        ...(await ensurePartitions(db, 'points')),
        ...(await ensurePartitions(db, 'slow_queries')),
      ];
    },

    async prune() {
      const settings = await settingsOrThrow();
      return [
        ...(await dropExpiredPartitions(db, 'events', settings.retentionEventsDays)),
        ...(await dropExpiredPartitions(db, 'points', settings.retentionPointsDays)),
        ...(await dropExpiredPartitions(db, 'slow_queries', SLOW_QUERIES_RETENTION_DAYS)),
      ];
    },
  };
}

export type { ClientEventInput };
