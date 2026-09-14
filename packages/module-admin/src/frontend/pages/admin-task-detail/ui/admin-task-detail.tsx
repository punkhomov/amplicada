import {
  type ApiClient,
  QueryError,
  useApiClient,
  useMutation,
  useQuery,
  useQueryClient,
  useTranslation,
} from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@amplicada/platform-core/frontend/ui/card';
import {
  ExtTable,
  ExtTableBody,
  ExtTableCell,
  ExtTableHead,
  ExtTableHeader,
  ExtTableRow,
} from '@amplicada/platform-core/frontend/ui/ext-table';
import { AlertTriangle, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { type Params, useParams } from 'react-router-dom';
import { type TaskRunFailedPayload, type TaskRunLogPayload, useTaskEventStream } from '../../../lib/use-task-event-stream.js';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';

interface TaskRow {
  id: string;
  stale: boolean;
}

interface TaskRun {
  id: string;
  taskId: string;
  status: 'running' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'orphaned';
  trigger: 'schedule' | 'manual';
  instanceId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  reason: string | null;
  error: string | null;
}

interface LogLine {
  timestamp: string;
  level: string;
  message: string;
}

const STATUS_VARIANT: Record<TaskRun['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'secondary',
  success: 'default',
  failed: 'destructive',
  timeout: 'destructive',
  cancelled: 'outline',
  orphaned: 'destructive',
};

const REASON_TO_STATUS: Record<TaskRunFailedPayload['reason'], TaskRun['status']> = {
  error: 'failed',
  timeout: 'timeout',
  cancelled: 'cancelled',
};

/** params — тот же объект, что возвращает useParams() в компоненте и loader получает от react-router. */
export function adminTaskRunsQueryOptions(api: ApiClient, params: Params) {
  const taskId = params.id ?? '';
  return {
    queryKey: ['admin', 'tasks', taskId, 'runs'] as const,
    queryFn: () => api.get<TaskRun[]>(`/admin/tasks/${taskId}/runs`),
  };
}

export function AdminTaskDetail() {
  const { t } = useTranslation('admin');
  const params = useParams<{ id: string }>();
  const { id } = params;
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [logsByRun, setLogsByRun] = useState<Record<string, TaskRunLogPayload[]>>({});

  const runsQueryOptions = adminTaskRunsQueryOptions(api, params);
  const runsQueryKey = runsQueryOptions.queryKey;

  const { data: tasks = [] } = useQuery({
    queryKey: ['admin', 'tasks'],
    queryFn: () => api.get<TaskRow[]>('/admin/tasks'),
  });
  const task = tasks.find(t => t.id === id);

  const { data: runs = [], isLoading, isError, error: queryError, refetch } = useQuery(runsQueryOptions);

  const selectedRun = runs.find(r => r.id === selectedRunId);
  const liveLogsForSelected = selectedRunId ? logsByRun[selectedRunId] : undefined;
  const { data: historicalLogs } = useQuery({
    queryKey: ['admin', 'tasks', id, 'runs', selectedRunId, 'logs'],
    queryFn: () => api.get<LogLine[]>(`/admin/tasks/${id}/runs/${selectedRunId}/logs`),
    enabled: !!selectedRunId && !liveLogsForSelected?.length,
  });
  const displayedLogs: LogLine[] = liveLogsForSelected?.length ? liveLogsForSelected : (historicalLogs ?? []);

  const cancelMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/admin/tasks/${id}/runs/${runId}/cancel`),
  });

  const runMutation = useMutation({
    mutationFn: () => api.post(`/admin/tasks/${id}/run`),
  });

  const runningRun = runs.find(r => r.status === 'running');

  useTaskEventStream({
    onStarted: payload => {
      if (payload.taskId !== id) return;
      queryClient.setQueryData<TaskRun[]>(runsQueryKey, old => [
        {
          id: payload.runId,
          taskId: payload.taskId,
          status: 'running',
          trigger: payload.trigger,
          instanceId: payload.workerId,
          startedAt: payload.startedAt,
          finishedAt: null,
          durationMs: null,
          reason: null,
          error: null,
        },
        ...(old ?? []),
      ]);
    },
    onSucceeded: payload => {
      if (payload.taskId !== id) return;
      queryClient.setQueryData<TaskRun[]>(runsQueryKey, old =>
        old?.map(r =>
          r.id === payload.runId ? { ...r, status: 'success', finishedAt: payload.finishedAt, durationMs: payload.durationMs } : r,
        ),
      );
    },
    onFailed: payload => {
      if (payload.taskId !== id) return;
      queryClient.setQueryData<TaskRun[]>(runsQueryKey, old =>
        old?.map(r =>
          r.id === payload.runId
            ? {
                ...r,
                status: REASON_TO_STATUS[payload.reason],
                finishedAt: payload.finishedAt,
                durationMs: payload.durationMs,
                reason: payload.reason,
                error: payload.error?.message ?? null,
              }
            : r,
        ),
      );
    },
    onLog: payload => {
      if (payload.taskId !== id) return;
      setLogsByRun(prev => ({ ...prev, [payload.runId]: [...(prev[payload.runId] ?? []), payload] }));
    },
  });

  return (
    <div className="h-full">
      <div className="w-full max-w-screen-2xl mx-auto flex h-full flex-col px-8 py-4 gap-4">
        <div className="shrink-0 flex flex-col gap-4">
          <AdminBreadcrumbs
            items={[
              { label: t('admin_breadcrumb_root'), to: '/admin' },
              { label: t('admin_task_breadcrumb_tasks'), to: '/admin/scheduled-task' },
              { label: id ?? '', to: `/admin/scheduled-task/${id}` },
              { label: t('admin_task_history') },
            ]}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{id}</h1>
            {task?.stale && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50"
              >
                <AlertTriangle className="size-3" />
                {t('admin_task_stale')}
              </Badge>
            )}
          </div>
          {runningRun ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate(runningRun.id)}
            >
              <Square />
              {t('admin_task_stop')}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={runMutation.isPending || task?.stale}
              title={task?.stale ? t('admin_task_run_disabled_title') : undefined}
              onClick={() => runMutation.mutate()}
            >
              <Play />
              {t('admin_task_run')}
            </Button>
          )}
        </div>

        <h2 className="text-lg font-semibold mt-2">{t('admin_task_history')}</h2>
        {isLoading ? (
          <div className="text-muted-foreground">{t('core:loading')}</div>
        ) : isError ? (
          <QueryError error={queryError} onRetry={refetch} />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            <div className="basis-0 flex-1 min-h-0 overflow-hidden rounded-xl ring-1 ring-foreground/10">
              <ExtTable>
                <ExtTableHeader sticky>
                  <ExtTableRow>
                    <ExtTableHead>{t('admin_task_col_status')}</ExtTableHead>
                    <ExtTableHead>{t('admin_task_col_trigger')}</ExtTableHead>
                    <ExtTableHead>{t('admin_task_col_started')}</ExtTableHead>
                    <ExtTableHead>{t('admin_task_col_duration')}</ExtTableHead>
                    <ExtTableHead>{t('admin_task_col_error')}</ExtTableHead>
                    <ExtTableHead>{t('admin_task_col_instance')}</ExtTableHead>
                    <ExtTableHead />
                  </ExtTableRow>
                </ExtTableHeader>
                <ExtTableBody>
                  {runs.length ? (
                    runs.map(run => (
                      <ExtTableRow
                        key={run.id}
                        className="cursor-pointer"
                        data-state={selectedRunId === run.id ? 'selected' : undefined}
                        onClick={() => setSelectedRunId(selectedRunId === run.id ? null : run.id)}
                      >
                        <ExtTableCell>
                          <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
                        </ExtTableCell>
                        <ExtTableCell>{run.trigger}</ExtTableCell>
                        <ExtTableCell>{new Date(run.startedAt).toLocaleString()}</ExtTableCell>
                        <ExtTableCell>{run.durationMs !== null ? `${run.durationMs}ms` : '—'}</ExtTableCell>
                        <ExtTableCell className="max-w-80 text-destructive">{run.error ?? '—'}</ExtTableCell>
                        <ExtTableCell className="text-muted-foreground text-xs">{run.instanceId ?? '—'}</ExtTableCell>
                        <ExtTableCell>
                          {run.status === 'running' && (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={cancelMutation.isPending}
                              onClick={e => {
                                e.stopPropagation();
                                cancelMutation.mutate(run.id);
                              }}
                            >
                              {t('admin_task_cancel')}
                            </Button>
                          )}
                        </ExtTableCell>
                      </ExtTableRow>
                    ))
                  ) : (
                    <ExtTableRow>
                      <ExtTableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        {t('admin_task_never_run')}
                      </ExtTableCell>
                    </ExtTableRow>
                  )}
                </ExtTableBody>
              </ExtTable>
            </div>

            <Card className="basis-0 flex-1 min-h-0">
              <CardHeader>
                <CardTitle>
                  {selectedRun
                    ? t('admin_task_logs_run_title', { date: new Date(selectedRun.startedAt).toLocaleString() })
                    : t('admin_task_logs_title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-auto font-mono text-xs flex flex-col gap-0.5">
                {!selectedRunId && <span className="text-muted-foreground">{t('admin_task_select_run')}</span>}
                {selectedRunId && displayedLogs.length === 0 && <span className="text-muted-foreground">{t('admin_task_no_logs')}</span>}
                {displayedLogs.map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: лог-строки не имеют стабильного id
                  <span key={i} className={line.level === 'error' ? 'text-destructive' : undefined}>
                    [{new Date(line.timestamp).toLocaleTimeString()}] {line.message}
                  </span>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
