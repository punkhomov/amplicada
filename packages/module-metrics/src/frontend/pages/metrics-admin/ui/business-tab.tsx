import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import type { MetricDefinitionSummaryDto } from '../../../../contracts/index.js';
import { type MetricsPeriod, metricsDefinitionsSummaryQueryOptions } from '../../../lib/query-options.js';
import { MetricsPeriodSelect } from './period-select.js';
import { TrendChart } from './trend-chart.js';

const CATEGORIES = ['product', 'business', 'technical', 'quality'] as const;

function SummaryCard({ summary }: { summary: MetricDefinitionSummaryDto }) {
  const { t } = useTranslation('metrics');
  const title = t(summary.definition.titleKey);
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="truncate font-mono text-[10px] text-muted-foreground">{summary.definition.key}</span>
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {summary.total}
        </Badge>
      </div>
      <TrendChart points={summary.points} label={title} />
    </div>
  );
}

export function BusinessTab({
  api,
  period,
  onPeriodChange,
}: {
  api: ApiClient;
  period: MetricsPeriod;
  onPeriodChange: (period: MetricsPeriod) => void;
}) {
  const { t } = useTranslation('metrics');
  const query = useQuery(metricsDefinitionsSummaryQueryOptions(api, period));
  const definitions = query.data?.definitions ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MetricsPeriodSelect value={period} onChange={onPeriodChange} />
        <span className="text-sm text-muted-foreground">
          {query.isFetching ? t('refreshing') : t('business_count', { count: definitions.length })}
        </span>
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {['b1', 'b2', 'b3'].map(id => (
            <Skeleton key={id} className="h-56 w-full" />
          ))}
        </div>
      ) : definitions.length === 0 ? (
        <div className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">{t('business_empty')}</div>
      ) : (
        CATEGORIES.map(category => {
          const items = definitions.filter(item => item.definition.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">{t(`category_${category}`)}</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map(item => (
                  <SummaryCard key={item.definition.key} summary={item} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
