import type { ApiClient } from '@amplicada/platform-core/frontend';
import type {
  AlertEventsDto,
  AlertInstancesDto,
  AlertRulesDto,
  ErrorIssuesDto,
  ErrorSamplesDto,
  MetricDefinition,
  MetricDefinitionsSummaryDto,
  MetricEventKind,
  MetricSeriesListDto,
  MetricsCatalogDto,
  MetricsContextDto,
  MetricsEventListDto,
  MetricsSettingsDto,
  RoutesSummaryDto,
  SinkDeliveriesDto,
  SinksDto,
  SlowQueryListDto,
  SqlSummaryListDto,
  VitalsSummaryDto,
} from '../../contracts/index.js';

export const METRICS_REFETCH_INTERVAL_MS = 15_000;

export const metricsQueryKeys = {
  context: ['metrics', 'context'] as const,
  events: (kind: string, name: string) => ['metrics', 'events', kind, name] as const,
  catalog: ['metrics', 'catalog'] as const,
  routes: (period: MetricsPeriod) => ['metrics', 'routes', period] as const,
  sql: (period: MetricsPeriod) => ['metrics', 'sql', period] as const,
  sinks: ['metrics', 'sinks'] as const,
  alertRules: ['metrics', 'alert-rules'] as const,
  alertInstances: ['metrics', 'alert-instances'] as const,
  alertEvents: ['metrics', 'alert-events'] as const,
  deliveries: (sinkId: string) => ['metrics', 'deliveries', sinkId] as const,
  errors: (period: MetricsPeriod) => ['metrics', 'errors', period] as const,
  errorSamples: (fingerprint: string) => ['metrics', 'error-samples', fingerprint] as const,
  vitals: (period: MetricsPeriod) => ['metrics', 'vitals', period] as const,
  definitions: ['metrics', 'definitions'] as const,
  definitionsSummary: (period: MetricsPeriod) => ['metrics', 'definitions-summary', period] as const,
  series: (event: string, period: MetricsPeriod) => ['metrics', 'series', event, period] as const,
  slowQueries: (period: MetricsPeriod) => ['metrics', 'slow-queries', period] as const,
  settings: ['metrics', 'settings'] as const,
};

export type MetricsPeriod = '1h' | '24h' | '7d';
export const METRICS_PERIODS: MetricsPeriod[] = ['1h', '24h', '7d'];

const PERIOD_MS: Record<MetricsPeriod, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

function periodRange(period: MetricsPeriod, now = Date.now()): { from: string; to: string } {
  return { from: new Date(now - PERIOD_MS[period]).toISOString(), to: new Date(now).toISOString() };
}

export function metricsAlertRulesQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.alertRules,
    queryFn: () => api.get<AlertRulesDto>('/metrics/admin/alert-rules'),
    refetchInterval: 30_000,
  };
}

export function metricsAlertInstancesQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.alertInstances,
    queryFn: () => api.get<AlertInstancesDto>('/metrics/admin/alerts'),
    refetchInterval: 15_000,
  };
}

export function metricsAlertEventsQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.alertEvents,
    queryFn: () => api.get<AlertEventsDto>('/metrics/admin/alert-events?limit=30'),
    refetchInterval: 30_000,
  };
}

export function metricsSinksQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.sinks,
    queryFn: () => api.get<SinksDto>('/metrics/admin/sinks'),
    refetchInterval: 30_000,
  };
}

export function metricsDeliveriesQueryOptions(api: ApiClient, sinkId?: string) {
  return {
    queryKey: metricsQueryKeys.deliveries(sinkId ?? 'all'),
    queryFn: () => api.get<SinkDeliveriesDto>(`/metrics/admin/deliveries?limit=50${sinkId ? `&sinkId=${encodeURIComponent(sinkId)}` : ''}`),
    refetchInterval: 30_000,
  };
}

export function metricsErrorsQueryOptions(api: ApiClient, period: MetricsPeriod) {
  return {
    queryKey: metricsQueryKeys.errors(period),
    queryFn: () => {
      const { from, to } = periodRange(period);
      return api.get<ErrorIssuesDto>(`/metrics/errors?from=${from}&to=${to}&limit=50`);
    },
    refetchInterval: 30_000,
  };
}

export function metricsErrorSamplesQueryOptions(api: ApiClient, fingerprint: string) {
  return {
    queryKey: metricsQueryKeys.errorSamples(fingerprint),
    queryFn: () => api.get<ErrorSamplesDto>(`/metrics/errors/${fingerprint}/samples?limit=20`),
    enabled: fingerprint.length > 0,
  };
}

export function metricsVitalsQueryOptions(api: ApiClient, period: MetricsPeriod) {
  return {
    queryKey: metricsQueryKeys.vitals(period),
    queryFn: () => {
      const { from, to } = periodRange(period);
      return api.get<VitalsSummaryDto>(`/metrics/vitals?from=${from}&to=${to}`);
    },
    refetchInterval: 60_000,
  };
}

export function metricsDefinitionsQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.definitions,
    queryFn: () => api.get<{ definitions: MetricDefinition[] }>('/metrics/definitions'),
    staleTime: 5 * 60_000,
  };
}

/** Сводка по определениям: всего и тренд по периодам. */
export function metricsDefinitionsSummaryQueryOptions(api: ApiClient, period: MetricsPeriod) {
  return {
    queryKey: metricsQueryKeys.definitionsSummary(period),
    queryFn: () => {
      const { from, to } = periodRange(period);
      return api.get<MetricDefinitionsSummaryDto>(`/metrics/definitions/summary?from=${from}&to=${to}`);
    },
    refetchInterval: 60_000,
  };
}

/** Серия событий для панели модуля. */
export function metricsSeriesQueryOptions(api: ApiClient, event: string, period: MetricsPeriod) {
  return {
    queryKey: metricsQueryKeys.series(event, period),
    queryFn: () => {
      const { from, to } = periodRange(period);
      return api.get<MetricSeriesListDto>(`/metrics/series?name=${encodeURIComponent(event)}&from=${from}&to=${to}`);
    },
    refetchInterval: 60_000,
  };
}

/** Сводка по роутам за выбранный период (RED). */
export function metricsRoutesQueryOptions(api: ApiClient, period: MetricsPeriod) {
  return {
    queryKey: metricsQueryKeys.routes(period),
    queryFn: () => {
      const { from, to } = periodRange(period);
      return api.get<RoutesSummaryDto>(`/metrics/routes?from=${from}&to=${to}`);
    },
    refetchInterval: 30_000,
  };
}

/** Топ SQL по суммарному времени. */
export function metricsSqlQueryOptions(api: ApiClient, period: MetricsPeriod) {
  return {
    queryKey: metricsQueryKeys.sql(period),
    queryFn: () => {
      const { from, to } = periodRange(period);
      return api.get<SqlSummaryListDto>(`/metrics/sql?from=${from}&to=${to}&limit=50`);
    },
    refetchInterval: 30_000,
  };
}

/** Выборочные медленные/ошибочные запросы. */
export function metricsSlowQueriesQueryOptions(api: ApiClient, period: MetricsPeriod) {
  return {
    queryKey: metricsQueryKeys.slowQueries(period),
    queryFn: () => {
      const { from, to } = periodRange(period);
      return api.get<SlowQueryListDto>(`/metrics/slow-queries?from=${from}&to=${to}&limit=50`);
    },
    refetchInterval: 30_000,
  };
}

/** Bootstrap-конфиг трекера: меняется редко, повторные запросы не нужны. */
export function metricsContextQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.context,
    queryFn: () => api.get<MetricsContextDto>('/metrics/context'),
    staleTime: 5 * 60_000,
    retry: false,
  };
}

export function metricsEventsQueryOptions(api: ApiClient, filters: { kind?: MetricEventKind; name?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.name) params.set('name', filters.name);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return {
    queryKey: metricsQueryKeys.events(filters.kind ?? 'all', filters.name ?? ''),
    queryFn: () => api.get<MetricsEventListDto>(`/metrics/events${query ? `?${query}` : ''}`),
    refetchInterval: METRICS_REFETCH_INTERVAL_MS,
  };
}

export function metricsCatalogQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.catalog,
    queryFn: () => api.get<MetricsCatalogDto>('/metrics/catalog'),
    refetchInterval: METRICS_REFETCH_INTERVAL_MS * 4,
  };
}

export function metricsSettingsQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.settings,
    queryFn: () => api.get<MetricsSettingsDto>('/metrics/admin/settings'),
  };
}
