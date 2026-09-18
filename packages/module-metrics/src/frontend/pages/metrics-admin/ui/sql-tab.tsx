import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { type MetricsPeriod, metricsSlowQueriesQueryOptions, metricsSqlQueryOptions } from '../../../lib/query-options.js';
import { formatMs, shortHash } from './format.js';
import { MetricsPeriodSelect } from './period-select.js';

const SKELETON_IDS = ['s1', 's2', 's3', 's4', 's5'];

export function SqlTab({
  api,
  period,
  onPeriodChange,
}: {
  api: ApiClient;
  period: MetricsPeriod;
  onPeriodChange: (period: MetricsPeriod) => void;
}) {
  const { t } = useTranslation('metrics');
  const summaryQuery = useQuery(metricsSqlQueryOptions(api, period));
  const slowQuery = useQuery(metricsSlowQueriesQueryOptions(api, period));
  const queries = summaryQuery.data?.queries ?? [];
  const samples = slowQuery.data?.samples ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MetricsPeriodSelect value={period} onChange={onPeriodChange} />
        <span className="text-sm text-muted-foreground">
          {summaryQuery.isFetching ? t('refreshing') : t('sql_count', { count: queries.length })}
        </span>
      </div>

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_query')}</TableHead>
              <TableHead>{t('col_calls')}</TableHead>
              <TableHead>{t('col_avg')}</TableHead>
              <TableHead>{t('col_p95')}</TableHead>
              <TableHead>{t('col_max')}</TableHead>
              <TableHead>{t('col_last_seen')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summaryQuery.isLoading ? (
              SKELETON_IDS.map(id => (
                <TableRow key={id}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : queries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {t('sql_empty')}
                </TableCell>
              </TableRow>
            ) : (
              queries.map(query => (
                <TableRow key={query.fingerprint}>
                  <TableCell className="max-w-[36rem]">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs break-all">{query.queryText}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{shortHash(query.fingerprint, 16)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{query.calls}</TableCell>
                  <TableCell className="tabular-nums">{formatMs(query.avgMs)}</TableCell>
                  <TableCell className="tabular-nums">{formatMs(query.p95Ms)}</TableCell>
                  <TableCell className="tabular-nums">{formatMs(query.maxMs)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {query.lastSeen ? new Date(query.lastSeen).toLocaleString() : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('slow_queries_title')}</h3>
        <div className="rounded-xl border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_time')}</TableHead>
                <TableHead>{t('col_route')}</TableHead>
                <TableHead>{t('col_duration')}</TableHead>
                <TableHead>{t('col_rows')}</TableHead>
                <TableHead>{t('col_error_code')}</TableHead>
                <TableHead>{t('col_query')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slowQuery.isLoading ? (
                SKELETON_IDS.map(id => (
                  <TableRow key={id}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : samples.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    {t('slow_queries_empty')}
                  </TableCell>
                </TableRow>
              ) : (
                samples.map(sample => (
                  <TableRow key={`${sample.at}:${sample.fingerprint}`}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(sample.at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{sample.route ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">
                      {sample.durationMs >= 1000 ? (
                        <Badge variant="destructive">{formatMs(sample.durationMs)}</Badge>
                      ) : (
                        formatMs(sample.durationMs)
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{sample.rowCount ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{sample.errorCode ?? '—'}</TableCell>
                    <TableCell className="max-w-[32rem]">
                      <span className="font-mono text-xs break-all">{sample.queryText}</span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">{t('slow_queries_hint')}</p>
      </div>
    </div>
  );
}
