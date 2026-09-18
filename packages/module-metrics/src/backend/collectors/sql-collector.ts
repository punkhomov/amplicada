import type { BackendRequestContextService } from '@amplicada/platform-core/contracts/backend';
import type { MeasurementBuffer } from '../services/measurement-buffer.js';
import { fingerprintSql, isMetricsInternalSql } from '../services/sql-normalize.js';
import type { CollectorConfig } from './config.js';

const INSTRUMENT = 'db.client.operation.duration';
const MAX_SLOW_PER_WINDOW = 50;
const MAX_FINGERPRINTS_PER_WINDOW = 200;

export interface SlowQueryInsert {
  at: Date;
  fingerprint: string;
  queryText: string;
  route: string | null;
  durationMs: number;
  rowCount: number | null;
  errorCode: string | null;
  requestId: string | null;
}

interface PgQueryable {
  query: (...args: unknown[]) => unknown;
}

export interface PgPoolLike extends PgQueryable {
  connect: (...args: unknown[]) => Promise<PgQueryable>;
}

export interface SqlCollectorDeps {
  pool: PgPoolLike;
  buffer: MeasurementBuffer;
  config: CollectorConfig;
  requestContext: BackendRequestContextService;
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function errorCodeOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

function rowCountOf(result: unknown): number | null {
  if (typeof result === 'object' && result !== null) {
    const rowCount = (result as { rowCount?: unknown }).rowCount;
    if (typeof rowCount === 'number') return rowCount;
  }
  return null;
}

function queryTextOf(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null) {
    const text = (first as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

/**
 * SQL-коллектор: оборачивает `pg`-пул (и клиентов из `connect`) wall-clock-замером.
 * Пишет гистограмму по fingerprint и samples медленных/ошибочных запросов; литералы
 * нормализуются, запросы самого модуля метрик пропускаются.
 */
export class SqlCollector {
  private readonly wrappedClients = new WeakSet<object>();
  private slowQueries: SlowQueryInsert[] = [];
  private fingerprints = new Map<string, string>();
  private attached = false;

  constructor(private readonly deps: SqlCollectorDeps) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.wrap(this.deps.pool);

    const originalConnect = this.deps.pool.connect;
    this.deps.pool.connect = async (...args: unknown[]) => {
      const client = await originalConnect.apply(this.deps.pool, args);
      if (typeof client === 'object' && client !== null && !this.wrappedClients.has(client)) {
        this.wrappedClients.add(client);
        this.wrap(client);
      }
      return client;
    };
  }

  drainSlowQueries(): SlowQueryInsert[] {
    const samples = this.slowQueries;
    this.slowQueries = [];
    return samples;
  }

  drainFingerprints(): { fingerprint: string; queryText: string }[] {
    const entries = [...this.fingerprints.entries()].map(([fingerprint, queryText]) => ({ fingerprint, queryText }));
    this.fingerprints.clear();
    return entries;
  }

  private wrap(target: PgQueryable): void {
    const original = target.query;
    target.query = (...args: unknown[]) => {
      const last = args[args.length - 1];
      const text = queryTextOf(args);
      // Callback-стиль pg не инструментируем: drizzle работает на промисах.
      if (typeof last === 'function' || text === '') return original.apply(target, args);

      const startedAt = process.hrtime.bigint();
      const outcome = original.apply(target, args);
      if (typeof (outcome as Promise<unknown>)?.then !== 'function') return outcome;
      return (outcome as Promise<unknown>).then(
        result => {
          this.observe(text, elapsedMs(startedAt), result, null);
          return result;
        },
        (error: unknown) => {
          this.observe(text, elapsedMs(startedAt), null, error);
          throw error;
        },
      );
    };
  }

  private observe(sqlText: string, durationMs: number, result: unknown, error: unknown): void {
    const { config } = this.deps;
    if (!config.enabled || isMetricsInternalSql(sqlText)) return;

    const { fingerprint, normalized } = fingerprintSql(sqlText);
    if (!normalized) return;
    if (this.fingerprints.size < MAX_FINGERPRINTS_PER_WINDOW) {
      this.fingerprints.set(fingerprint, normalized);
    }

    const context = this.deps.requestContext.current();
    const route = context?.route ?? '<unattributed>';
    const isError = error !== null;
    const isSlow = durationMs >= config.slowSqlThresholdMs;
    const sampled = isError || isSlow || Math.random() <= config.sampleSqlRate;

    if (sampled) {
      this.deps.buffer.record({ instrument: INSTRUMENT, kind: 'histogram', unit: 's', dims: { fingerprint, route } }, durationMs / 1000);
    }

    if ((isError || isSlow) && this.slowQueries.length < MAX_SLOW_PER_WINDOW) {
      this.slowQueries.push({
        at: new Date(),
        fingerprint,
        queryText: normalized,
        route: context?.route ?? null,
        durationMs,
        rowCount: rowCountOf(result),
        errorCode: errorCodeOf(error),
        requestId: context?.requestId ?? null,
      });
    }
  }
}
