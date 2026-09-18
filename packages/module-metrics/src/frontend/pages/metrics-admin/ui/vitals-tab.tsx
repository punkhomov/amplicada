import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import type { VitalSummaryDto } from '../../../../contracts/index.js';
import { type MetricsPeriod, metricsVitalsQueryOptions } from '../../../lib/query-options.js';
import { formatMs } from './format.js';
import { MetricsPeriodSelect } from './period-select.js';

const VITAL_LABELS: Record<string, string> = {
  'web_vital.lcp': 'LCP',
  'web_vital.inp': 'INP',
  'web_vital.cls': 'CLS',
  'web_vital.fcp': 'FCP',
  'web_vital.ttfb': 'TTFB',
};

function formatVital(vital: VitalSummaryDto, value: number): string {
  return vital.unit === 'ms' ? formatMs(value) : value.toFixed(3);
}

function VitalCard({ vital }: { vital: VitalSummaryDto }) {
  const { t } = useTranslation('metrics');
  const label = VITAL_LABELS[vital.instrument] ?? vital.instrument;
  const total = vital.good + vital.needsImprovement + vital.poor;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{t('vitals_calls', { count: vital.calls })}</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{formatVital(vital, vital.p75)}</span>
        <span className="text-xs text-muted-foreground">{t('vitals_p75')}</span>
      </div>

      {total > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            {t('vitals_good')}: {vital.good}
          </Badge>
          <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400">
            {t('vitals_needs_improvement')}: {vital.needsImprovement}
          </Badge>
          <Badge variant="destructive">
            {t('vitals_poor')}: {vital.poor}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}

export function VitalsTab({
  api,
  period,
  onPeriodChange,
}: {
  api: ApiClient;
  period: MetricsPeriod;
  onPeriodChange: (period: MetricsPeriod) => void;
}) {
  const { t } = useTranslation('metrics');
  const query = useQuery(metricsVitalsQueryOptions(api, period));
  const vitals = query.data?.vitals ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MetricsPeriodSelect value={period} onChange={onPeriodChange} />
        <span className="text-sm text-muted-foreground">
          {query.isFetching ? t('refreshing') : t('vitals_count', { count: vitals.length })}
        </span>
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {['v1', 'v2', 'v3'].map(id => (
            <Skeleton key={id} className="h-40 w-full" />
          ))}
        </div>
      ) : vitals.length === 0 ? (
        <div className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">{t('vitals_empty')}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vitals.map(vital => (
            <VitalCard key={vital.instrument} vital={vital} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('vitals_hint')}</p>
    </div>
  );
}
