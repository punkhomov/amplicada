import type { ApiClient } from '@amplicada/platform-core/frontend';
import type { MetricEventKind, MetricsContextDto, MetricsEventListDto, MetricsSettingsDto } from '../../contracts/index.js';

export const METRICS_REFETCH_INTERVAL_MS = 15_000;

export const metricsQueryKeys = {
  context: ['metrics', 'context'] as const,
  events: (kind: string, name: string) => ['metrics', 'events', kind, name] as const,
  settings: ['metrics', 'settings'] as const,
};

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

export function metricsSettingsQueryOptions(api: ApiClient) {
  return {
    queryKey: metricsQueryKeys.settings,
    queryFn: () => api.get<MetricsSettingsDto>('/metrics/admin/settings'),
  };
}
