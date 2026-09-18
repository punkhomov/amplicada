import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { type MetricsPeriod, metricsRoutesQueryOptions } from '../../../lib/query-options.js';
import { formatMs, formatPercent } from './format.js';
import { MetricsPeriodSelect } from './period-select.js';

const SKELETON_IDS = ['r1', 'r2', 'r3', 'r4', 'r5'];

export function RoutesTab({
  api,
  period,
  onPeriodChange,
}: {
  api: ApiClient;
  period: MetricsPeriod;
  onPeriodChange: (period: MetricsPeriod) => void;
}) {
  const { t } = useTranslation('metrics');
  const query = useQuery(metricsRoutesQueryOptions(api, period));
  const routes = query.data?.routes ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MetricsPeriodSelect value={period} onChange={onPeriodChange} />
        <span className="text-sm text-muted-foreground">
          {query.isFetching ? t('refreshing') : t('routes_count', { count: routes.length })}
        </span>
      </div>

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_route')}</TableHead>
              <TableHead>{t('col_calls')}</TableHead>
              <TableHead>{t('col_errors')}</TableHead>
              <TableHead>{t('col_error_rate')}</TableHead>
              <TableHead>{t('col_avg')}</TableHead>
              <TableHead>{t('col_p50')}</TableHead>
              <TableHead>{t('col_p95')}</TableHead>
              <TableHead>{t('col_p99')}</TableHead>
              <TableHead>{t('col_max')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              SKELETON_IDS.map(id => (
                <TableRow key={id}>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : routes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  {t('routes_empty')}
                </TableCell>
              </TableRow>
            ) : (
              routes.map(route => (
                <TableRow key={route.route}>
                  <TableCell className="font-mono text-xs">{route.route}</TableCell>
                  <TableCell className="tabular-nums">{route.calls}</TableCell>
                  <TableCell className="tabular-nums">
                    {route.errors > 0 ? <Badge variant="destructive">{route.errors}</Badge> : '0'}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatPercent(route.errorRate)}</TableCell>
                  <TableCell className="tabular-nums">{formatMs(route.avgMs)}</TableCell>
                  <TableCell className="tabular-nums">{formatMs(route.p50Ms)}</TableCell>
                  <TableCell className="tabular-nums">{formatMs(route.p95Ms)}</TableCell>
                  <TableCell className="tabular-nums">{formatMs(route.p99Ms)}</TableCell>
                  <TableCell className="tabular-nums">{formatMs(route.maxMs)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
