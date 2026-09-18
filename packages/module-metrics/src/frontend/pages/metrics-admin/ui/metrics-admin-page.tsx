import { useApiClient, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@amplicada/platform-core/frontend/ui/tabs';
import { useEffect, useState } from 'react';
import {
  METRIC_EVENT_KINDS,
  type MetricEventDto,
  type MetricEventKind,
  type MetricsSettingsDto,
  type MetricsSettingsPatch,
} from '../../../../contracts/index.js';
import { metricsEventsQueryOptions, metricsQueryKeys, metricsSettingsQueryOptions } from '../../../lib/query-options.js';

const KIND_VARIANT: Record<MetricEventKind, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  page: 'secondary',
  ui: 'outline',
  error: 'destructive',
  web_vital: 'outline',
  business: 'default',
  system: 'secondary',
};

function short(hash: string | null): string {
  return hash ? `${hash.slice(0, 10)}…` : '—';
}

function EventRow({ event }: { event: MetricEventDto }) {
  const { t } = useTranslation('metrics');
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
        {new Date(event.occurredAt).toLocaleString()}
      </TableCell>
      <TableCell className="font-mono text-xs">{event.name}</TableCell>
      <TableCell>
        <Badge variant={KIND_VARIANT[event.kind]}>{t(`kind_${event.kind}`)}</Badge>
      </TableCell>
      <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">{event.route ?? '—'}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{short(event.actorHash)}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{short(event.sessionHash)}</TableCell>
    </TableRow>
  );
}

export function MetricsAdminPage() {
  const { t } = useTranslation('metrics');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<MetricEventKind | 'all'>('all');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<MetricsSettingsDto | null>(null);

  const eventsQuery = useQuery(
    metricsEventsQueryOptions(api, {
      kind: kind === 'all' ? undefined : kind,
      name: name.trim() || undefined,
      limit: 100,
    }),
  );
  const settingsQuery = useQuery(metricsSettingsQueryOptions(api));

  useEffect(() => {
    if (settingsQuery.data) setDraft(settingsQuery.data);
  }, [settingsQuery.data]);

  const saveSettings = useMutation({
    mutationFn: (patch: MetricsSettingsPatch) => api.patch<MetricsSettingsDto>('/metrics/admin/settings', patch),
    onSuccess: data => {
      setDraft(data);
      void queryClient.invalidateQueries({ queryKey: metricsQueryKeys.settings });
    },
  });

  const events = eventsQuery.data?.events ?? [];
  const patchDraft = (values: Partial<MetricsSettingsDto>) => setDraft(previous => (previous ? { ...previous, ...values } : previous));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 p-8">
        <Tabs defaultValue="events" className="gap-4">
          <TabsList>
            <TabsTrigger value="events">{t('tab_events')}</TabsTrigger>
            <TabsTrigger value="settings">{t('tab_settings')}</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={kind} onValueChange={value => setKind(value as MetricEventKind | 'all')}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filter_all_kinds')}</SelectItem>
                  {METRIC_EVENT_KINDS.map(value => (
                    <SelectItem key={value} value={value}>
                      {t(`kind_${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="w-64"
                value={name}
                placeholder={t('filter_name_placeholder')}
                onChange={event => setName(event.target.value)}
              />
              <span className="text-sm text-muted-foreground">
                {eventsQuery.isFetching ? t('refreshing') : t('events_count', { count: events.length })}
              </span>
            </div>

            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_time')}</TableHead>
                    <TableHead>{t('col_name')}</TableHead>
                    <TableHead>{t('col_kind')}</TableHead>
                    <TableHead>{t('col_route')}</TableHead>
                    <TableHead>{t('col_actor')}</TableHead>
                    <TableHead>{t('col_session')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eventsQuery.isLoading ? (
                    ['s1', 's2', 's3', 's4', 's5'].map(id => (
                      <TableRow key={id}>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : events.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        {t('events_empty')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    events.map(event => <EventRow key={event.id} event={event} />)
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="max-w-xl">
            {draft ? (
              <div className="flex flex-col gap-5 rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{t('settings_enabled')}</span>
                    <span className="text-xs text-muted-foreground">{t('settings_enabled_hint')}</span>
                  </div>
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={checked => patchDraft({ enabled: checked })}
                    aria-label={t('settings_enabled')}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm">{t('settings_retention_days')}</span>
                  <Input
                    className="w-28"
                    type="number"
                    min={1}
                    max={3650}
                    aria-label={t('settings_retention_days')}
                    value={draft.retentionEventsDays}
                    onChange={event => patchDraft({ retentionEventsDays: Number(event.target.value) })}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm">{t('settings_sample_pageview')}</span>
                  <Input
                    className="w-28"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label={t('settings_sample_pageview')}
                    value={draft.samplePageviewRate}
                    onChange={event => patchDraft({ samplePageviewRate: Number(event.target.value) })}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm">{t('settings_sample_click')}</span>
                  <Input
                    className="w-28"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label={t('settings_sample_click')}
                    value={draft.sampleClickRate}
                    onChange={event => patchDraft({ sampleClickRate: Number(event.target.value) })}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{t('settings_store_raw_urls')}</span>
                    <span className="text-xs text-muted-foreground">{t('settings_store_raw_urls_hint')}</span>
                  </div>
                  <Switch
                    checked={draft.storeRawUrls}
                    onCheckedChange={checked => patchDraft({ storeRawUrls: checked })}
                    aria-label={t('settings_store_raw_urls')}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    disabled={saveSettings.isPending}
                    onClick={() =>
                      saveSettings.mutate({
                        enabled: draft.enabled,
                        retentionEventsDays: draft.retentionEventsDays,
                        samplePageviewRate: draft.samplePageviewRate,
                        sampleClickRate: draft.sampleClickRate,
                        storeRawUrls: draft.storeRawUrls,
                      })
                    }
                  >
                    {t('settings_save')}
                  </Button>
                  {saveSettings.isSuccess ? <span className="text-sm text-muted-foreground">{t('settings_saved')}</span> : null}
                </div>
              </div>
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
