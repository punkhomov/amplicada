import { type ApiClient, QueryError, useApiClient, useQuery } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@amplicada/platform-core/frontend/ui/card';
import { AlertTriangle, ArrowRight, Bot } from 'lucide-react';
import { type Params, useParams } from 'react-router-dom';
import { ActionButtons } from '../../../widgets/action-buttons/index.js';

interface ProcessDetail {
  id: string;
  workflowCode: string;
  currentState: string;
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  availableActions: { action: string; label: string }[];
  isAssignee: boolean;
  nodeLabels: Record<string, string>;
  failedAutomation: { lastError: string | null } | null;
}

interface TimelineEntry {
  id: string;
  action: string;
  fromState: string | null;
  toState: string | null;
  comment: string | null;
  payloadDiff: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
  actorLogin: string | null;
}

/** params — тот же объект, что возвращает useParams() в компоненте и loader получает от react-router. */
export function processDetailQueryOptions(api: ApiClient, params: Params) {
  const id = params.id ?? '';
  return {
    queryKey: ['workflows', 'process', id] as const,
    queryFn: () => api.get<ProcessDetail>(`/workflows/processes/${id}`),
  };
}

export function ProcessTimelinePage() {
  const params = useParams<{ id: string }>();
  const { id } = params;
  const api = useApiClient();

  const {
    data: process,
    isLoading,
    isError,
    error: queryError,
    refetch,
  } = useQuery({ ...processDetailQueryOptions(api, params), enabled: !!id });

  const { data: timeline = [] } = useQuery({
    queryKey: ['workflows', 'process', id, 'timeline'],
    queryFn: () => api.get<TimelineEntry[]>(`/workflows/processes/${id}/timeline`),
    enabled: !!id,
  });

  if (!id) return null;
  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading || !process) return <div className="p-8 text-muted-foreground">Загрузка...</div>;

  const stateLabel = (state: string | null) => (state ? (process.nodeLabels[state] ?? state) : '—');
  const completed = !!process.completedAt;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{process.workflowCode}</h1>
            <Badge variant={completed ? 'default' : 'secondary'}>{completed ? 'Завершена' : 'В работе'}</Badge>
          </div>
          <span className="text-sm text-muted-foreground">от {new Date(process.createdAt).toLocaleString()}</span>
        </div>

        <div className="text-sm">
          Текущий этап: <span className="font-medium">{stateLabel(process.currentState)}</span>
        </div>

        {process.failedAutomation && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Автоматика не выполнилась</span>
              {process.failedAutomation.lastError && <span className="text-xs opacity-90">{process.failedAutomation.lastError}</span>}
            </div>
          </div>
        )}

        {process.isAssignee && process.availableActions.length > 0 && <ActionButtons processId={id} actions={process.availableActions} />}

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Payload</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-56 overflow-auto text-xs">{JSON.stringify(process.payload, null, 2)}</pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Context</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-56 overflow-auto text-xs">{JSON.stringify(process.context, null, 2)}</pre>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Таймлайн</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!timeline.length && <span className="text-sm text-muted-foreground">Переходов ещё не было</span>}
            {[...timeline].reverse().map(entry => (
              <div key={entry.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{entry.actorLogin ?? '—'}</span>
                  {entry.action === 'auto' ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Bot className="size-3.5" />
                      авто
                    </span>
                  ) : (
                    <Badge variant="outline">{entry.action}</Badge>
                  )}
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {stateLabel(entry.fromState)}
                    <ArrowRight className="size-3" />
                    {stateLabel(entry.toState)}
                  </span>
                </div>
                {entry.comment && <div className="text-xs text-muted-foreground">«{entry.comment}»</div>}
                {entry.payloadDiff && Object.keys(entry.payloadDiff).length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Изменены поля:{' '}
                    {Object.entries(entry.payloadDiff)
                      .map(([key, { from, to }]) => `${key}: ${String(from)} → ${String(to)}`)
                      .join(', ')}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
