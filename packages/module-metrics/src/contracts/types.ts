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

/** Вход бизнес-события от модулей (emit): id и время сервер проставит сам. */
export interface MetricEventInput {
  name: string;
  kind?: MetricEventKind;
  occurredAt?: string;
  module?: string;
  actor?: { kind: 'user' | 'anonymous' | 'system' | 'service'; userId?: string };
  sessionId?: string;
  context?: ClientEventContext;
  attributes?: Record<string, MetricAttrValue>;
  measures?: Record<string, number>;
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
  retentionPointsDays: number;
  samplePageviewRate: number;
  sampleClickRate: number;
  ingestEventsPerMinute: number;
  slowSqlThresholdMs: number;
  sampleSqlRate: number;
  storeRawUrls: boolean;
  updatedAt: string;
}

export interface MetricsSettingsPatch {
  enabled?: boolean;
  retentionEventsDays?: number;
  retentionPointsDays?: number;
  samplePageviewRate?: number;
  sampleClickRate?: number;
  ingestEventsPerMinute?: number;
  slowSqlThresholdMs?: number;
  sampleSqlRate?: number;
  storeRawUrls?: boolean;
}

export interface MetricDefinitionDimension {
  key: string;
  titleKey: string;
  type: 'string' | 'number' | 'boolean' | 'datetime';
  highCardinality?: boolean;
}

/** Определение бизнес-метрики: что означает и куда смотреть модулю-потребителю. */
export interface MetricDefinition {
  key: string;
  module: string;
  titleKey: string;
  descriptionKey?: string;
  category: 'product' | 'business' | 'technical' | 'quality';
  source: { events?: string[]; eventPrefix?: string; instrument?: string };
  unit?: string;
  aggregation?: 'count' | 'sum' | 'avg';
  dimensions?: MetricDefinitionDimension[];
  docsUrl?: string;
}

export interface MetricSeriesPointDto {
  t: string;
  v: number;
}

export interface MetricSeriesDto {
  key: string;
  points: MetricSeriesPointDto[];
}

export interface MetricSeriesListDto {
  series: MetricSeriesDto[];
  stepSeconds: number;
}

export interface MetricDefinitionSummaryDto {
  definition: MetricDefinition;
  total: number;
  points: MetricSeriesPointDto[];
}

export interface MetricDefinitionsSummaryDto {
  definitions: MetricDefinitionSummaryDto[];
  stepSeconds: number;
}

/** Панель дашборда, объявляемая модулем (frontend service `metrics:panels`). */
export interface MetricPanel {
  id: string;
  titleKey: string;
  kind: 'timeseries';
  event: string;
  aggregate?: 'count';
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

/** Что мониторит правило: событие или измерение (роут/SQL/задача/витал). */
export interface AlertTarget {
  kind: 'event' | 'measurement';
  key: string;
  metric?: 'count' | 'avg' | 'p95';
  /** Фильтры: `route`, `module`, `actor_kind`, `status_class` (измерения) или `attributes.<key>`. */
  filters?: Record<string, string>;
}

export type AlertCondition =
  | { kind: 'threshold'; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number; forMs?: number }
  | { kind: 'absence'; forMs?: number };

export interface AlertRuleDto {
  id: string;
  name: string;
  enabled: boolean;
  severity: AlertSeverity;
  target: AlertTarget;
  windowMs: number;
  condition: AlertCondition;
  delivery: { eventBus?: boolean };
  labels: Record<string, string>;
  annotations: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleInput {
  name: string;
  enabled?: boolean;
  severity?: AlertSeverity;
  target: AlertTarget;
  windowMs: number;
  condition: AlertCondition;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface AlertRulesDto {
  rules: AlertRuleDto[];
}

export interface AlertInstanceDto {
  ruleId: string;
  ruleName: string;
  state: 'pending' | 'firing';
  value: number | null;
  activeAt: string;
  lastEvalAt: string;
}

export interface AlertInstancesDto {
  instances: AlertInstanceDto[];
}

export interface AlertEventDto {
  id: number;
  ruleId: string;
  ruleName: string;
  state: 'firing' | 'resolved';
  severity: AlertSeverity;
  value: number | null;
  message: string | null;
  at: string;
}

export interface AlertEventsDto {
  events: AlertEventDto[];
}

export interface AlertEvaluationResultDto {
  evaluated: number;
  firing: number;
  resolved: number;
}

export interface SinkConfigDto {
  id: string;
  /** i18n-ключ заголовка выхода (из реестра sink'ов). */
  titleKey: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  mapping: Record<string, unknown>;
  updatedAt: string;
  /** Состояние очереди доставки этого выхода. */
  pending: number;
  dead: number;
}

export interface SinkConfigPatch {
  enabled?: boolean;
  settings?: Record<string, unknown>;
  mapping?: Record<string, unknown>;
}

export interface SinksDto {
  sinks: SinkConfigDto[];
}

export interface SinkDeliveryDto {
  id: number;
  sinkId: string;
  itemId: string;
  status: 'sent' | 'failed' | 'dead';
  attempts: number;
  error: string | null;
  at: string;
}

export interface SinkDeliveriesDto {
  deliveries: SinkDeliveryDto[];
}

export interface SinkTestResultDto {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface OutboxDispatchResultDto {
  sent: number;
  failed: number;
  dead: number;
}

/** Сгруппированная ошибка (issue): fingerprint + агрегаты. */
export interface ErrorIssueDto {
  fingerprint: string;
  errorType: string;
  messageTemplate: string;
  route: string | null;
  issueCount: number;
  periodCount: number;
  affectedActors: number;
  firstSeen: string;
  lastSeen: string;
  firstRelease: string | null;
  lastRelease: string | null;
}

export interface ErrorIssuesDto {
  issues: ErrorIssueDto[];
}

export interface ErrorSamplesDto {
  samples: MetricEventDto[];
}

export interface VitalSummaryDto {
  instrument: string;
  unit: string;
  calls: number;
  p75: number;
  p95: number;
  good: number;
  needsImprovement: number;
  poor: number;
}

export interface VitalsSummaryDto {
  vitals: VitalSummaryDto[];
}

export interface MetricsPanelsService {
  register(panel: MetricPanel): void;
  getAll(): MetricPanel[];
}

export const METRICS_PANELS_TOKEN = 'metrics:panels';

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

/** Сводка по роутам: rate/errors/duration (RED). */
export interface RouteSummaryDto {
  route: string;
  calls: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface RoutesSummaryDto {
  routes: RouteSummaryDto[];
}

/** Топ SQL по суммарному времени. */
export interface SqlSummaryDto {
  fingerprint: string;
  queryText: string;
  calls: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  lastSeen: string | null;
}

export interface SqlSummaryListDto {
  queries: SqlSummaryDto[];
}

export interface SlowQueryDto {
  at: string;
  fingerprint: string;
  queryText: string;
  route: string | null;
  durationMs: number;
  rowCount: number | null;
  errorCode: string | null;
  requestId: string | null;
}

export interface SlowQueryListDto {
  samples: SlowQueryDto[];
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
