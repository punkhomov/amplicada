import { type ApiClient, QueryError, useApiClient, useMutation, useQuery, useQueryClient } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { HrRequestListItem, RequestTypeMeta } from '../../../../contracts/index.js';
import { GenericRequestForm } from '../../../features/request-form/index.js';
import { getRequestForm } from '../../../lib/form-registry.js';

export function requestTypesQueryOptions(api: ApiClient) {
  return {
    queryKey: ['hr-requests', 'types'] as const,
    queryFn: () => api.get<RequestTypeMeta[]>('/hr-requests/types'),
  };
}

export function RequestNewPage() {
  const { type } = useParams<{ type: string }>();
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: types, isLoading, isError, error: queryError, refetch } = useQuery(requestTypesQueryOptions(api));
  const typeDef = types?.find(t => t.code === type);
  // Escape hatch: кастомная форма, зарегистрированная кодом, важнее generic-рендерера
  const CustomForm = type ? getRequestForm(type) : undefined;

  const createMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      const created = await api.post<HrRequestListItem>('/hr-requests', { type, fields });
      if (submit) await api.post(`/hr-requests/${created.id}/submit`);
      return created;
    },
    onSuccess: created => {
      queryClient.invalidateQueries({ queryKey: ['hr-requests'] });
      navigate(`/requests/${created.id}`);
    },
    onError: (err: unknown) => {
      const data = (err as { data?: { error?: string } }).data;
      setError(data?.error ?? (err as Error).message);
    },
  });

  if (!type) return null;
  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading) return <div className="p-8 text-muted-foreground">Загрузка...</div>;
  if (!typeDef && !CustomForm) {
    return <div className="p-8 text-muted-foreground">Тип заявки "{type}" не найден или отключён</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-6">
      <h1 className="text-2xl font-bold">{typeDef?.label ?? 'Новая заявка'}</h1>
      {CustomForm ? (
        <CustomForm fields={fields} onChange={setFields} />
      ) : (
        <GenericRequestForm formFields={typeDef?.formFields ?? []} fields={fields} onChange={setFields} editableKeys={true} />
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={createMutation.isPending} onClick={() => createMutation.mutate(false)}>
          Сохранить черновик
        </Button>
        <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate(true)}>
          Отправить
        </Button>
      </div>
    </div>
  );
}
