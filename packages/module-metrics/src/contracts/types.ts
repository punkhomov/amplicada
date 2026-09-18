/** Контракты модуля метрик. Хранилище шире этой версии: события — первый слой (см. plans/2026-09-18-metrics-module). */

export type MetricEventKind = 'page' | 'ui' | 'error' | 'web_vital' | 'business' | 'system';

export const METRIC_EVENT_KINDS: readonly MetricEventKind[] = ['page', 'ui', 'error', 'web_vital', 'business', 'system'];

export type MetricAttrValue = string | number | boolean;

export interface ClientEventContext {
  /** Шаблон маршрута (`/support/:id`), никогда не сырой URL. */
  route?: string;
  /** Сырой путь; сохраняется только при `store_raw_urls`. */
  url?: string;
  referrer?: string;
}

/** Событие, как его присылает клиентский трекер. */
export interface ClientEventInput {
  id: string;
  name: string;
  kind: MetricEventKind;
  occurredAt: string;
  sessionId?: string;
  context?: ClientEventContext;
  attributes?: Record<string, MetricAttrValue>;
  measures?: Record<string, number>;
  sampling?: { rate: number; reason?: string };
}

export interface CollectRequest {
  events: ClientEventInput[];
}

export interface CollectResponse {
  accepted: number;
  duplicates: number;
  overflow: number;
  rejected: { index: number; reason: string }[];
  /** Сбор выключен настройками: батч принят, но не записан. */
  disabled?: boolean;
}

/** Bootstrap-конфиг трекера: включён ли сбор, с какой вероятностью, какие лимиты. */
export interface MetricsContextDto {
  enabled: boolean;
  sampleRates: { pageview: number; ui: number };
  limits: {
    maxBatchEvents: number;
    maxEventBytes: number;
    maxAttributes: number;
    maxStringLength: number;
  };
}

export interface MetricsSettingsDto {
  enabled: boolean;
  retentionEventsDays: number;
  samplePageviewRate: number;
  sampleClickRate: number;
  ingestEventsPerMinute: number;
  storeRawUrls: boolean;
  updatedAt: string;
}

export interface MetricsSettingsPatch {
  enabled?: boolean;
  retentionEventsDays?: number;
  samplePageviewRate?: number;
  sampleClickRate?: number;
  ingestEventsPerMinute?: number;
  storeRawUrls?: boolean;
}

/** Ответ приёма при превышении минутного лимита событий (HTTP 429). */
export interface MetricsRateLimitedDto {
  error: 'rate_limited';
  retryAfter: number;
}

export interface MetricCatalogEntryDto {
  name: string;
  kind: MetricEventKind;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface MetricsCatalogDto {
  entries: MetricCatalogEntryDto[];
}

export interface MetricEventDto {
  id: string;
  occurredAt: string;
  receivedAt: string;
  name: string;
  kind: MetricEventKind;
  module: string | null;
  actorKind: string | null;
  actorHash: string | null;
  sessionHash: string | null;
  route: string | null;
  url: string | null;
  referrer: string | null;
  release: string | null;
  attributes: Record<string, unknown>;
  measures: Record<string, unknown>;
  samplingRate: number | null;
}

export interface MetricsEventListDto {
  events: MetricEventDto[];
}
