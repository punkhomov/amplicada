import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import type { MetricPanel } from '../../../../contracts/index.js';
import { metricsPanelsService } from '../../../lib/panel-registry.js';
import { type MetricsPeriod, metricsSeriesQueryOptions } from '../../../lib/query-options.js';
import { MetricsPeriodSelect } from './period-select.js';
import { TrendChart } from './trend-chart.js';

function PanelCard({ api, panel, period }: { api: ApiClient; panel: MetricPanel; period: MetricsPeriod }) {
  const { t } = useTranslation('metrics');
  const query = useQuery(metricsSeriesQueryOptions(api, panel.event, period));
  const title = t(panel.titleKey);
  const points = (query.data?.series ?? []).flatMap(series => series.points);

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{panel.event}</span>
      </div>
      {query.isLoading ? <Skeleton className="h-32 w-full" /> : <TrendChart points={points} label={title} />}
    </div>
  );
}

/** Дашборд из панелей, объявленных модулями (сервис `metrics:panels`). */
export function PanelsTab({
  api,
  period,
  onPeriodChange,
}: {
  api: ApiClient;
  period: MetricsPeriod;
  onPeriodChange: (period: MetricsPeriod) => void;
}) {
  const { t } = useTranslation('metrics');
  const panels = metricsPanelsService.getAll();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MetricsPeriodSelect value={period} onChange={onPeriodChange} />
        <span className="text-sm text-muted-foreground">{t('panels_count', { count: panels.length })}</span>
      </div>

      {panels.length === 0 ? (
        <div className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">{t('panels_empty')}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {panels.map(panel => (
            <PanelCard key={panel.id} api={api} panel={panel} period={period} />
          ))}
        </div>
      )}
    </div>
  );
}
