export type {
  ClientEventInput,
  CollectResponse,
  MetricEventDto,
  MetricEventKind,
  MetricsContextDto,
  MetricsSettingsDto,
  MetricsSettingsPatch,
} from '../contracts/index.js';
export { METRIC_EVENT_KINDS } from '../contracts/index.js';
export { MetricsTracker } from './features/metrics-tracker/index.js';
export { extractClickAttributes } from './lib/clicks.js';
export { detectMetricsOptOut, isMetricsOptedOut, METRICS_OPT_OUT_KEY } from './lib/optout.js';
export {
  metricsContextQueryOptions,
  metricsEventsQueryOptions,
  metricsQueryKeys,
  metricsSettingsQueryOptions,
} from './lib/query-options.js';
export { chunkEvents, MetricsQueue } from './lib/queue.js';
export { normalizeRoute } from './lib/route.js';
export { currentSessionId } from './lib/session.js';
export { MetricsAdminPage } from './pages/metrics-admin/index.js';
export { metricsFrontendModule as module } from './setup.js';
