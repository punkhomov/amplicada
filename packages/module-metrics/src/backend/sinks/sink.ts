import type { SinkConfigRow } from '../schemas/index.js';

export type SinkItemKind = 'event' | 'measurement';

export interface SinkItem {
  id: string;
  kind: SinkItemKind;
  payload: Record<string, unknown>;
}

export interface SinkSendResult {
  ok: boolean;
  /** `true` — повторить с backoff; `false` — в DLQ без повторов (4xx и т.п.). */
  retryable: boolean;
  error?: string;
}

/** Максимум попыток доставки: дальше — DLQ. */
export const MAX_OUTBOX_ATTEMPTS = 6;

/** Выход наружу: адаптер, включённый по конфигу `metrics.sink_configs`. */
export interface MetricSink {
  id: string;
  titleKey: string;
  accepts: SinkItemKind[];
  maxEvents: number;
  /** Отбор событий по настройке `events` (точные имена или префиксы с `*`). */
  matches?(payload: Record<string, unknown>, config: SinkConfigRow): boolean;
  /** Whitelist настроек выхода: всё лишнее отбрасывается до записи в БД. */
  sanitizeSettings?(input: Record<string, unknown>): Record<string, unknown>;
  send(items: SinkItem[], config: SinkConfigRow, signal: AbortSignal): Promise<SinkSendResult>;
}

export interface SinkRegistry {
  register(sink: MetricSink): void;
  get(id: string): MetricSink | undefined;
  getAll(): MetricSink[];
}

export function createSinkRegistry(): SinkRegistry {
  const sinks = new Map<string, MetricSink>();
  return {
    register(sink) {
      sinks.set(sink.id, sink);
    },
    get: id => sinks.get(id),
    getAll: () => [...sinks.values()],
  };
}

/** Фильтр `settings.events`: пустой — всё; `support.*` — префикс; иначе точное имя. */
export function matchesEventFilter(name: string, filter: unknown): boolean {
  if (!Array.isArray(filter) || filter.length === 0) return true;
  return filter.some(entry => {
    if (typeof entry !== 'string' || entry.length === 0) return false;
    return entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : name === entry;
  });
}

/** Экспоненциальный backoff после `attempts`-й неудачи: 30 с → 1 мин → … → 1 ч. */
export function nextAttemptDelayMs(attempts: number): number {
  const exponent = Math.max(attempts - 1, 0);
  return Math.min(30_000 * 2 ** exponent, 60 * 60 * 1000);
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
