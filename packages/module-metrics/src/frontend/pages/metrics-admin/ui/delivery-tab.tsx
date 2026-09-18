import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useApiClient, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { useState } from 'react';
import type { SinkConfigDto, SinkDeliveryDto } from '../../../../contracts/index.js';
import { metricsDeliveriesQueryOptions, metricsQueryKeys, metricsSinksQueryOptions } from '../../../lib/query-options.js';
import { shortHash } from './format.js';

const DELIVERY_VARIANT: Record<SinkDeliveryDto['status'], 'secondary' | 'destructive' | 'outline'> = {
  sent: 'secondary',
  failed: 'outline',
  dead: 'destructive',
};

function SinkCard({ api, sink }: { api: ApiClient; sink: SinkConfigDto }) {
  const { t } = useTranslation('metrics');
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(typeof sink.settings.url === 'string' ? sink.settings.url : '');
  const [events, setEvents] = useState(Array.isArray(sink.settings.events) ? (sink.settings.events as string[]).join(', ') : '');
  const [testResult, setTestResult] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; settings?: Record<string, unknown> }) =>
      api.patch<SinkConfigDto>(`/metrics/admin/sinks/${sink.id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: metricsQueryKeys.sinks }),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>(`/metrics/admin/sinks/${sink.id}/test`),
    onSuccess: result => setTestResult(result.ok ? t('sink_test_ok') : `${t('sink_test_fail')}: ${result.error ?? ''}`),
    onError: error => setTestResult(`${t('sink_test_fail')}: ${error instanceof Error ? error.message : ''}`),
  });

  const saveSettings = () =>
    save.mutate({
      settings: {
        url,
        events: events
          .split(',')
          .map(entry => entry.trim())
          .filter(entry => entry.length > 0),
      },
    });

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t(sink.titleKey)}</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {sink.id}
          </Badge>
          {sink.pending > 0 ? (
            <Badge variant="secondary">
              {t('delivery_pending')}: {sink.pending}
            </Badge>
          ) : null}
          {sink.dead > 0 ? (
            <Badge variant="destructive">
              {t('delivery_dead')}: {sink.dead}
            </Badge>
          ) : null}
        </div>
        <Switch checked={sink.enabled} onCheckedChange={checked => save.mutate({ enabled: checked })} aria-label={t('sink_enabled')} />
      </div>

      {sink.id === 'webhook' ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('sink_url')}</span>
            <Input value={url} placeholder="https://example.com/hooks/metrics" onChange={event => setUrl(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('sink_events')}</span>
            <Input value={events} placeholder="support.*, page.view" onChange={event => setEvents(event.target.value)} />
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {sink.id === 'webhook' ? (
          <Button size="sm" disabled={save.isPending} onClick={saveSettings}>
            {save.isPending ? t('refreshing') : t('sink_save')}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
          {t('sink_test')}
        </Button>
        {testResult ? <span className="text-xs text-muted-foreground">{testResult}</span> : null}
      </div>
    </div>
  );
}

export function DeliveryTab({ api }: { api: ApiClient }) {
  const { t } = useTranslation('metrics');
  const sinksQuery = useQuery(metricsSinksQueryOptions(api));
  const deliveriesQuery = useQuery(metricsDeliveriesQueryOptions(api));
  const sinks = sinksQuery.data?.sinks ?? [];
  const deliveries = deliveriesQuery.data?.deliveries ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {sinksQuery.isLoading
          ? ['s1', 's2'].map(id => <Skeleton key={id} className="h-48 w-full" />)
          : sinks.map(sink => <SinkCard key={sink.id} api={api} sink={sink} />)}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('deliveries_title')}</h3>
        <div className="rounded-xl border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_time')}</TableHead>
                <TableHead>{t('col_sink')}</TableHead>
                <TableHead>{t('col_item')}</TableHead>
                <TableHead>{t('col_status')}</TableHead>
                <TableHead>{t('col_attempts')}</TableHead>
                <TableHead>{t('col_error')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveriesQuery.isLoading ? (
                ['d1', 'd2', 'd3'].map(id => (
                  <TableRow key={id}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : deliveries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    {t('deliveries_empty')}
                  </TableCell>
                </TableRow>
              ) : (
                deliveries.map(delivery => (
                  <TableRow key={delivery.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(delivery.at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{delivery.sinkId}</TableCell>
                    <TableCell className="font-mono text-xs">{shortHash(delivery.itemId, 12)}</TableCell>
                    <TableCell>
                      <Badge variant={DELIVERY_VARIANT[delivery.status]}>{t(`delivery_status_${delivery.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{delivery.attempts}</TableCell>
                    <TableCell className="max-w-[24rem] truncate text-xs text-muted-foreground">{delivery.error ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">{t('deliveries_hint')}</p>
      </div>
    </div>
  );
}
