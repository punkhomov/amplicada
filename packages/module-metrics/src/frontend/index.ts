export type {
  ClientEventInput,
  CollectResponse,
  ErrorIssueDto,
  ErrorIssuesDto,
  ErrorSamplesDto,
  MetricDefinition,
  MetricEventDto,
  MetricEventKind,
  MetricPanel,
  MetricsContextDto,
  MetricsPanelsService,
  MetricsSettingsDto,
  MetricsSettingsPatch,
  VitalSummaryDto,
  VitalsSummaryDto,
} from '../contracts/index.js';
export { METRIC_EVENT_KINDS, METRICS_PANELS_TOKEN } from '../contracts/index.js';
export { MetricsTracker } from './features/metrics-tracker/index.js';
export { extractClickAttributes } from './lib/clicks.js';
export { errorEventFromUnknown, normalizeClientErrorText, normalizeClientStack } from './lib/error-capture.js';
export { detectMetricsOptOut, isMetricsOptedOut, METRICS_OPT_OUT_KEY } from './lib/optout.js';
export { metricsPanelsService } from './lib/panel-registry.js';
export type { MetricsPeriod } from './lib/query-options.js';
export {
  METRICS_PERIODS,
  metricsAlertEventsQueryOptions,
  metricsAlertInstancesQueryOptions,
  metricsAlertRulesQueryOptions,
  metricsCatalogQueryOptions,
  metricsContextQueryOptions,
  metricsDefinitionsQueryOptions,
  metricsDefinitionsSummaryQueryOptions,
  metricsDeliveriesQueryOptions,
  metricsErrorSamplesQueryOptions,
  metricsErrorsQueryOptions,
  metricsEventsQueryOptions,
  metricsQueryKeys,
  metricsRoutesQueryOptions,
  metricsSeriesQueryOptions,
  metricsSettingsQueryOptions,
  metricsSinksQueryOptions,
  metricsSlowQueriesQueryOptions,
  metricsSqlQueryOptions,
  metricsVitalsQueryOptions,
} from './lib/query-options.js';
export { chunkEvents, MetricsQueue } from './lib/queue.js';
export { normalizeRoute } from './lib/route.js';
export { currentSessionId } from './lib/session.js';
export { observeWebVitals } from './lib/vitals.js';
export { MetricsAdminPage } from './pages/metrics-admin/index.js';
export { metricsFrontendModule as module } from './setup.js';
