import type { ApiClient } from '@amplicada/platform-core/frontend';
import { useApiClient, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { useState } from 'react';
import type { AlertCondition, AlertRuleDto, AlertRuleInput, AlertSeverity, AlertTarget } from '../../../../contracts/index.js';
import {
  metricsAlertEventsQueryOptions,
  metricsAlertInstancesQueryOptions,
  metricsAlertRulesQueryOptions,
  metricsQueryKeys,
} from '../../../lib/query-options.js';

const SEVERITIES: AlertSeverity[] = ['info', 'warning', 'critical'];
const SEVERITY_VARIANT: Record<AlertSeverity, 'secondary' | 'outline' | 'destructive'> = {
  info: 'secondary',
  warning: 'outline',
  critical: 'destructive',
};

function conditionText(condition: AlertCondition, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (condition.kind === 'absence') {
    return t('alert_condition_absence', { minutes: Math.round((condition.forMs ?? 0) / 60_000) });
  }
  const suffix = condition.forMs ? ` (for ${Math.round(condition.forMs / 60_000)}m)` : '';
  return `${condition.op} ${condition.value}${suffix}`;
}

export function AlertsTab({ api }: { api: ApiClient }) {
  const { t } = useTranslation('metrics');
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [targetKind, setTargetKind] = useState<AlertTarget['kind']>('event');
  const [targetKey, setTargetKey] = useState('');
  const [metric, setMetric] = useState<NonNullable<AlertTarget['metric']>>('count');
  const [filter, setFilter] = useState('');
  const [conditionKind, setConditionKind] = useState<AlertCondition['kind']>('threshold');
  const [op, setOp] = useState<'gt' | 'gte' | 'lt' | 'lte'>('gt');
  const [value, setValue] = useState('10');
  const [windowMinutes, setWindowMinutes] = useState('5');
  const [forMinutes, setForMinutes] = useState('0');
  const [severity, setSeverity] = useState<AlertSeverity>('warning');

  const rulesQuery = useQuery(metricsAlertRulesQueryOptions(api));
  const instancesQuery = useQuery(metricsAlertInstancesQueryOptions(api));
  const eventsQuery = useQuery(metricsAlertEventsQueryOptions(api));
  const rules = rulesQuery.data?.rules ?? [];
  const instances = instancesQuery.data?.instances ?? [];
  const events = eventsQuery.data?.events ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: metricsQueryKeys.alertRules });
    void queryClient.invalidateQueries({ queryKey: metricsQueryKeys.alertInstances });
  };

  const create = useMutation({
    mutationFn: (input: AlertRuleInput) => api.post<AlertRuleDto>('/metrics/admin/alert-rules', input),
    onSuccess: () => {
      setName('');
      setTargetKey('');
      invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AlertRuleInput }) =>
      api.patch<AlertRuleDto>(`/metrics/admin/alert-rules/${id}`, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/metrics/admin/alert-rules/${id}`),
    onSuccess: invalidate,
  });
  const evaluate = useMutation({
    mutationFn: () => api.post<{ evaluated: number; firing: number; resolved: number }>('/metrics/admin/alerts/evaluate'),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: metricsQueryKeys.alertEvents });
    },
  });

  const buildInput = (enabled?: boolean): AlertRuleInput => {
    const filters: Record<string, string> = {};
    const [filterKey, filterValue] = filter.split('=').map(part => part.trim());
    if (filterKey && filterValue) filters[filterKey] = filterValue;
    return {
      name,
      enabled,
      severity,
      target: { kind: targetKind, key: targetKey.trim(), metric: targetKind === 'event' ? undefined : metric, filters },
      windowMs: Math.max(1, Number(windowMinutes)) * 60_000,
      condition:
        conditionKind === 'absence'
          ? { kind: 'absence', forMs: Math.max(0, Number(forMinutes)) * 60_000 }
          : { kind: 'threshold', op, value: Number(value), forMs: Math.max(0, Number(forMinutes)) * 60_000 },
    };
  };

  const toRuleInput = (rule: AlertRuleDto, enabled: boolean): AlertRuleInput => ({
    name: rule.name,
    enabled,
    severity: rule.severity,
    target: rule.target,
    windowMs: rule.windowMs,
    condition: rule.condition,
    labels: rule.labels,
    annotations: rule.annotations,
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">{t('alert_create_title')}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Input className="w-56" placeholder={t('alert_name')} value={name} onChange={event => setName(event.target.value)} />
          <Select value={targetKind} onValueChange={next => setTargetKind(next as AlertTarget['kind'])}>
            <SelectTrigger className="w-44" aria-label={t('alert_target_kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="event">{t('alert_target_event')}</SelectItem>
              <SelectItem value="measurement">{t('alert_target_measurement')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="w-64"
            placeholder="page.view / http.server.request.duration"
            value={targetKey}
            onChange={event => setTargetKey(event.target.value)}
          />
          {targetKind === 'measurement' ? (
            <Select value={metric} onValueChange={next => setMetric(next as NonNullable<AlertTarget['metric']>)}>
              <SelectTrigger className="w-32" aria-label={t('alert_metric')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">count</SelectItem>
                <SelectItem value="avg">avg</SelectItem>
                <SelectItem value="p95">p95</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <Input
            className="w-48"
            placeholder={t('alert_filter_placeholder')}
            value={filter}
            onChange={event => setFilter(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={conditionKind} onValueChange={next => setConditionKind(next as AlertCondition['kind'])}>
            <SelectTrigger className="w-40" aria-label={t('alert_condition')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="threshold">{t('alert_condition_threshold')}</SelectItem>
              <SelectItem value="absence">{t('alert_condition_absence_label')}</SelectItem>
            </SelectContent>
          </Select>
          {conditionKind === 'threshold' ? (
            <>
              <Select value={op} onValueChange={next => setOp(next as typeof op)}>
                <SelectTrigger className="w-24" aria-label={t('alert_op')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gt">&gt;</SelectItem>
                  <SelectItem value="gte">&ge;</SelectItem>
                  <SelectItem value="lt">&lt;</SelectItem>
                  <SelectItem value="lte">&le;</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="w-28"
                type="number"
                value={value}
                aria-label={t('alert_value')}
                onChange={event => setValue(event.target.value)}
              />
            </>
          ) : null}
          <Input
            className="w-28"
            type="number"
            min={1}
            value={windowMinutes}
            aria-label={t('alert_window')}
            onChange={event => setWindowMinutes(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">{t('alert_window_minutes')}</span>
          <Input
            className="w-28"
            type="number"
            min={0}
            value={forMinutes}
            aria-label={t('alert_for')}
            onChange={event => setForMinutes(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">{t('alert_for_minutes')}</span>
          <Select value={severity} onValueChange={next => setSeverity(next as AlertSeverity)}>
            <SelectTrigger className="w-36" aria-label={t('alert_severity')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITIES.map(item => (
                <SelectItem key={item} value={item}>
                  {t(`alert_severity_${item}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={create.isPending || name.trim().length === 0 || targetKey.trim().length === 0}
            onClick={() => create.mutate(buildInput())}
          >
            {t('alert_create')}
          </Button>
          <Button variant="outline" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>
            {t('alert_evaluate_now')}
          </Button>
          {evaluate.data ? (
            <span className="text-xs text-muted-foreground">
              {t('alert_evaluated', { evaluated: evaluate.data.evaluated, firing: evaluate.data.firing })}
            </span>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('alert_rules_title')}</h3>
        <div className="rounded-xl border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('alert_name')}</TableHead>
                <TableHead>{t('alert_target')}</TableHead>
                <TableHead>{t('alert_condition')}</TableHead>
                <TableHead>{t('alert_window')}</TableHead>
                <TableHead>{t('alert_severity')}</TableHead>
                <TableHead>{t('sink_enabled')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rulesQuery.isLoading ? (
                ['a1', 'a2'].map(id => (
                  <TableRow key={id}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    {t('alert_rules_empty')}
                  </TableCell>
                </TableRow>
              ) : (
                rules.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell className="text-sm font-medium">{rule.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {rule.target.kind}:{rule.target.key}
                      {rule.target.metric ? `:${rule.target.metric}` : ''}
                    </TableCell>
                    <TableCell className="text-xs">{conditionText(rule.condition, t)}</TableCell>
                    <TableCell className="tabular-nums text-xs">{Math.round(rule.windowMs / 60_000)}m</TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[rule.severity]}>{t(`alert_severity_${rule.severity}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rule.enabled}
                        aria-label={rule.name}
                        onCheckedChange={checked => toggle.mutate({ id: rule.id, input: toRuleInput(rule, checked) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(rule.id)}>
                        {t('alert_delete')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('alert_instances_title')}</h3>
        <div className="rounded-xl border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('alert_name')}</TableHead>
                <TableHead>{t('col_status')}</TableHead>
                <TableHead>{t('alert_value')}</TableHead>
                <TableHead>{t('alert_active_since')}</TableHead>
                <TableHead>{t('alert_last_eval')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {instances.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    {t('alert_instances_empty')}
                  </TableCell>
                </TableRow>
              ) : (
                instances.map(instance => (
                  <TableRow key={`${instance.ruleId}:${instance.activeAt}`}>
                    <TableCell className="text-sm">{instance.ruleName}</TableCell>
                    <TableCell>
                      <Badge variant={instance.state === 'firing' ? 'destructive' : 'outline'}>{t(`alert_state_${instance.state}`)}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{instance.value?.toFixed(2) ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(instance.activeAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(instance.lastEvalAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('alert_events_title')}</h3>
        <div className="rounded-xl border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_time')}</TableHead>
                <TableHead>{t('alert_name')}</TableHead>
                <TableHead>{t('col_status')}</TableHead>
                <TableHead>{t('alert_value')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    {t('alert_events_empty')}
                  </TableCell>
                </TableRow>
              ) : (
                events.map(event => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(event.at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{event.ruleName}</TableCell>
                    <TableCell>
                      <Badge variant={event.state === 'firing' ? 'destructive' : 'secondary'}>{t(`alert_state_${event.state}`)}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{event.value?.toFixed(2) ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
