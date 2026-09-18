import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { useState } from 'react';
import { type MetricsPeriod, metricsErrorSamplesQueryOptions, metricsErrorsQueryOptions } from '../../../lib/query-options.js';
import { shortHash } from './format.js';
import { MetricsPeriodSelect } from './period-select.js';

const SKELETON_IDS = ['e1', 'e2', 'e3', 'e4', 'e5'];

/** Issues сгруппированных ошибок + samples выбранного issue со стеком. */
export function ErrorsTab({
  api,
  period,
  onPeriodChange,
}: {
  api: ApiClient;
  period: MetricsPeriod;
  onPeriodChange: (period: MetricsPeriod) => void;
}) {
  const { t } = useTranslation('metrics');
  const [selected, setSelected] = useState<string | null>(null);
  const issuesQuery = useQuery(metricsErrorsQueryOptions(api, period));
  const samplesQuery = useQuery(metricsErrorSamplesQueryOptions(api, selected ?? ''));
  const issues = issuesQuery.data?.issues ?? [];
  const samples = samplesQuery.data?.samples ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MetricsPeriodSelect value={period} onChange={onPeriodChange} />
        <span className="text-sm text-muted-foreground">
          {issuesQuery.isFetching ? t('refreshing') : t('errors_count', { count: issues.length })}
        </span>
      </div>

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_error')}</TableHead>
              <TableHead>{t('col_route')}</TableHead>
              <TableHead>{t('col_period_count')}</TableHead>
              <TableHead>{t('col_affected')}</TableHead>
              <TableHead>{t('col_total_count')}</TableHead>
              <TableHead>{t('col_last_seen')}</TableHead>
              <TableHead>{t('col_release')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issuesQuery.isLoading ? (
              SKELETON_IDS.map(id => (
                <TableRow key={id}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : issues.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {t('errors_empty')}
                </TableCell>
              </TableRow>
            ) : (
              issues.map(issue => (
                <TableRow
                  key={issue.fingerprint}
                  className="cursor-pointer"
                  onClick={() => setSelected(selected === issue.fingerprint ? null : issue.fingerprint)}
                >
                  <TableCell className="max-w-[28rem]">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{issue.errorType}</span>
                      <span className="truncate text-xs text-muted-foreground">{issue.messageTemplate}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{shortHash(issue.fingerprint, 16)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{issue.route ?? '—'}</TableCell>
                  <TableCell className="tabular-nums">{issue.periodCount}</TableCell>
                  <TableCell className="tabular-nums">{issue.affectedActors}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{issue.issueCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(issue.lastSeen).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{issue.lastRelease ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selected ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('error_samples_title')}</h3>
          {samplesQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : samples.length === 0 ? (
            <div className="rounded-xl border bg-card py-6 text-center text-sm text-muted-foreground">{t('error_samples_empty')}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {samples.map(sample => (
                <div key={sample.id} className="flex flex-col gap-1 rounded-xl border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{new Date(sample.occurredAt).toLocaleString()}</Badge>
                    <span className="font-mono">{sample.route ?? '—'}</span>
                    <span className="font-mono">{sample.sessionHash ? shortHash(sample.sessionHash, 8) : '—'}</span>
                    <span className="font-mono">{sample.actorHash ? shortHash(sample.actorHash, 8) : '—'}</span>
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                    {String(sample.attributes['error.stack'] ?? sample.attributes['error.message'] ?? '—')}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('error_select_hint')}</p>
      )}
    </div>
  );
}
