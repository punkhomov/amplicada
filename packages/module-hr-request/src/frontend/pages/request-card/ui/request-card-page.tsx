import { type ApiClient, QueryError, useApiClient, useMutation, useQuery, useQueryClient } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@amplicada/platform-core/frontend/ui/card';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { AlertTriangle, ArrowRight, Bot, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Params, useNavigate, useParams } from 'react-router-dom';
import type { HrRequestDetail } from '../../../../contracts/index.js';
import { GenericRequestForm } from '../../../features/request-form/index.js';
import { getRequestForm } from '../../../lib/form-registry.js';
import { RequestStatusBadge } from '../../../widgets/request-status-badge/index.js';

/** params — тот же объект, что возвращает useParams() в компоненте и loader получает от react-router. */
export function requestDetailQueryOptions(api: ApiClient, params: Params) {
  const id = params.id ?? '';
  return {
    queryKey: ['hr-requests', 'detail', id] as const,
    queryFn: () => api.get<HrRequestDetail>(`/hr-requests/${id}`),
  };
}

export function RequestCardPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draftFields, setDraftFields] = useState<Record<string, unknown> | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const {
    data: request,
    isLoading,
    isError,
    error: queryError,
    refetch,
  } = useQuery({ ...requestDetailQueryOptions(api, params), enabled: !!id });

  // Локальная копия полей для редактирования черновика; сбрасывается при переходе на другую заявку
  // (не на каждый рефетч — иначе фокус-рефетч react-query стирал бы несохранённый ввод)
  // biome-ignore lint/correctness/useExhaustiveDependencies: намеренно только id
  useEffect(() => {
    setDraftFields(null);
    setComment('');
    setError(null);
  }, [id]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['hr-requests'] });
  const onError = (err: unknown) => {
    const data = (err as { data?: { error?: string } }).data;
    setError(data?.error ?? (err as Error).message);
  };

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/hr-requests/${id}`, { fields: draftFields }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (draftFields) await api.patch(`/hr-requests/${id}`, { fields: draftFields });
      return api.post(`/hr-requests/${id}/submit`);
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/hr-requests/${id}`),
    onSuccess: () => {
      invalidate();
      navigate('/requests');
    },
    onError,
  });
  const actionMutation = useMutation({
    mutationFn: (action: string) => {
      // Патч действия ограничен editableFields текущего шага — движок отклонит любой другой
      // ключ целиком, поэтому шлём только разрешённые (draftFields, если тронуты, уже содержат их полный набор)
      const editablePatch =
        draftFields && request?.editableFields.length
          ? Object.fromEntries(request.editableFields.map(key => [key, draftFields[key]]))
          : undefined;
      return api.post(`/hr-requests/${id}/actions/${action}`, { comment: comment.trim() || undefined, fields: editablePatch });
    },
    onSuccess: () => {
      setComment('');
      setDraftFields(null);
      setError(null);
      invalidate();
    },
    onError,
  });

  if (!id) return null;
  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading || !request) return <div className="p-8 text-muted-foreground">Загрузка...</div>;

  // Escape hatch: кастомная форма, зарегистрированная кодом, важнее generic-рендерера
  const CustomForm = getRequestForm(request.type);
  const fields = draftFields ?? request.fields;
  const stateLabel = (state: string | null) => (state ? (request.nodeLabels[state] ?? state) : '—');
  const fieldLabel = (key: string) => request.formFields.find(f => f.key === key)?.label ?? key;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{request.typeLabel}</h1>
          <RequestStatusBadge status={request.status} />
        </div>
        <span className="text-sm text-muted-foreground">от {new Date(request.createdAt).toLocaleDateString()}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Заявка</CardTitle>
        </CardHeader>
        <CardContent>
          {CustomForm ? (
            <CustomForm fields={fields} onChange={setDraftFields} readonly={!request.canEdit} />
          ) : (
            <GenericRequestForm
              formFields={request.formFields}
              fields={fields}
              onChange={setDraftFields}
              editableKeys={request.canEdit ? true : request.editableFields}
            />
          )}
        </CardContent>
      </Card>

      {error && <span className="text-sm text-destructive">{error}</span>}

      {request.failedAutomation && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Автоматика не выполнилась</span>
            {request.failedAutomation.lastError && <span className="text-xs opacity-90">{request.failedAutomation.lastError}</span>}
          </div>
        </div>
      )}

      {request.canEdit && (
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={saveMutation.isPending || !draftFields} onClick={() => saveMutation.mutate()}>
            Сохранить
          </Button>
          <Button disabled={submitMutation.isPending} onClick={() => submitMutation.mutate()}>
            <Send />
            Отправить
          </Button>
          <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            <Trash2 />
            Удалить
          </Button>
        </div>
      )}

      {request.isAssignee && request.availableActions.length > 0 && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Комментарий (опционально)</Label>
            <Textarea className="min-h-16 text-sm" value={comment} onChange={e => setComment(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            {request.availableActions.map(({ action, label }) => (
              <Button key={action} size="sm" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate(action)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {request.timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">История</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {[...request.timeline].reverse().map(entry => (
              <div key={entry.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{entry.actorLogin ?? '—'}</span>
                  {entry.action === 'auto' && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Bot className="size-3.5" />
                      авто
                    </span>
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
                      .map(([key, { from, to }]) => `${fieldLabel(key)}: ${String(from)} → ${String(to)}`)
                      .join(', ')}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
