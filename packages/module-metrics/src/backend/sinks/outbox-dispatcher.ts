import type { OutboxRow, SinkConfigRow } from '../schemas/index.js';
import { MAX_OUTBOX_ATTEMPTS, nextAttemptDelayMs, type SinkItemKind, type SinkRegistry } from './sink.js';

export interface OutboxDeliveryInput {
  sinkId: string;
  itemId: string;
  status: 'sent' | 'failed' | 'dead';
  attempts: number;
  error: string | null;
}

export interface OutboxStore {
  listDueOutbox(limit: number): Promise<OutboxRow[]>;
  listSinkConfigs(): Promise<SinkConfigRow[]>;
  markOutboxSent(ids: number[]): Promise<void>;
  markOutboxDead(id: number, error: string): Promise<void>;
  markOutboxRetry(id: number, attempts: number, nextAttemptAt: Date, error: string): Promise<void>;
  insertDeliveries(rows: OutboxDeliveryInput[]): Promise<void>;
}

export interface OutboxLogger {
  error(obj: Record<string, unknown>, message: string): void;
}

export interface DispatchStats {
  sent: number;
  failed: number;
  dead: number;
}

/**
 * Диспетчер очереди выходов: раз в интервал забирает due-строки `metrics.outbox`,
 * группирует по sink'ам и шлёт батчами. 4xx без 429 → DLQ, 5xx/429/сеть → backoff
 * (максимум 6 попыток). Всё пишется в журнал доставки.
 */
export class OutboxDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastDispatchAtValue: Date | null = null;

  constructor(
    private readonly deps: {
      store: OutboxStore;
      registry: SinkRegistry;
      logger: OutboxLogger;
      intervalMs?: number;
      batchSize?: number;
    },
  ) {}

  get stats(): { lastDispatchAt: Date | null } {
    return { lastDispatchAt: this.lastDispatchAtValue };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.dispatch(), this.deps.intervalMs ?? 15_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispatch(): Promise<DispatchStats> {
    const stats: DispatchStats = { sent: 0, failed: 0, dead: 0 };
    if (this.running) return stats;
    this.running = true;
    try {
      const rows = await this.deps.store.listDueOutbox(this.deps.batchSize ?? 200);
      if (rows.length === 0) return stats;

      const configs = new Map((await this.deps.store.listSinkConfigs()).map(config => [config.id, config]));
      const bySink = new Map<string, OutboxRow[]>();
      for (const row of rows) {
        const list = bySink.get(row.sinkId) ?? [];
        list.push(row);
        bySink.set(row.sinkId, list);
      }

      for (const [sinkId, sinkRows] of bySink) {
        const config = configs.get(sinkId);
        const sink = this.deps.registry.get(sinkId);
        // Выключенный или неизвестный sink не теряем: строки ждут своей очереди.
        if (!config?.enabled || !sink) continue;

        const items = sinkRows.map(row => ({
          id: row.itemId,
          kind: row.itemKind as SinkItemKind,
          payload: row.payload,
        }));

        let result: { ok: boolean; retryable: boolean; error?: string };
        try {
          result = await sink.send(items, config, new AbortController().signal);
        } catch (error) {
          result = { ok: false, retryable: true, error: error instanceof Error ? error.message : 'sink threw' };
        }

        const deliveries: OutboxDeliveryInput[] = [];
        if (result.ok) {
          await this.deps.store.markOutboxSent(sinkRows.map(row => row.id));
          for (const row of sinkRows) {
            deliveries.push({ sinkId, itemId: row.itemId, status: 'sent', attempts: row.attempts + 1, error: null });
          }
          stats.sent += sinkRows.length;
        } else {
          for (const row of sinkRows) {
            const attempts = row.attempts + 1;
            const error = result.error ?? 'delivery failed';
            if (!result.retryable || attempts >= MAX_OUTBOX_ATTEMPTS) {
              await this.deps.store.markOutboxDead(row.id, error);
              deliveries.push({ sinkId, itemId: row.itemId, status: 'dead', attempts, error });
              stats.dead += 1;
            } else {
              await this.deps.store.markOutboxRetry(row.id, attempts, new Date(Date.now() + nextAttemptDelayMs(attempts)), error);
              deliveries.push({ sinkId, itemId: row.itemId, status: 'failed', attempts, error });
              stats.failed += 1;
            }
          }
        }
        await this.deps.store.insertDeliveries(deliveries);
      }
      this.lastDispatchAtValue = new Date();
      return stats;
    } catch (error) {
      this.deps.logger.error({ err: error }, 'Metrics outbox dispatch failed');
      return stats;
    } finally {
      this.running = false;
    }
  }
}
