import { type ApiClient, QueryError, useApiClient, useMutation, useQuery, useQueryClient } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@amplicada/platform-core/frontend/ui/card';
import { CheckCircle2, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Params, useNavigate, useParams } from 'react-router-dom';
import type { PollDetail } from '../../../../contracts/index.js';
import { GenericPollForm } from '../../../widgets/generic-poll-form/index.js';

/** params — тот же объект, что возвращает useParams() в компоненте и loader получает от react-router. */
export function pollDetailQueryOptions(api: ApiClient, params: Params) {
  const id = params.id ?? '';
  return {
    queryKey: ['hr-polls', 'detail', id] as const,
    queryFn: () => api.get<PollDetail>(`/hr-polls/${id}`),
  };
}

export function PollTakePage() {
  const params = useParams<{ id: string }>();
  const { id } = params;
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const {
    data: poll,
    isLoading,
    isError,
    error: queryError,
    refetch,
  } = useQuery({ ...pollDetailQueryOptions(api, params), enabled: !!id });

  // biome-ignore lint/correctness/useExhaustiveDependencies: намеренно только poll — сброс черновика при (пере)загрузке опроса
  useEffect(() => {
    setAnswers(poll?.myAnswers ?? {});
    setError(null);
  }, [poll]);

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/hr-polls/${id}/responses`, { answers }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['hr-polls'] });
    },
    onError: (err: unknown) => {
      const data = (err as { data?: { error?: string } }).data;
      setError(data?.error ?? (err as Error).message);
    },
  });

  if (!id) return null;
  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading || !poll) return <div className="p-8 text-muted-foreground">Загрузка...</div>;

  const showReadonly = !poll.canSubmit;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{poll.title}</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate('/polls')}>
          К списку
        </Button>
      </div>
      {poll.description && <p className="text-sm text-muted-foreground">{poll.description}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Вопросы</CardTitle>
        </CardHeader>
        <CardContent>
          <GenericPollForm questions={poll.questions} answers={answers} onChange={setAnswers} readonly={showReadonly} />
        </CardContent>
      </Card>

      {error && <span className="text-sm text-destructive">{error}</span>}

      {submitMutation.isSuccess ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-emerald-500" />
          Ответ сохранён
        </div>
      ) : showReadonly ? (
        <p className="text-sm text-muted-foreground">
          {poll.myAnswers ? 'Вы уже ответили на этот опрос' : 'Опрос сейчас недоступен для ответа'}
        </p>
      ) : (
        <Button disabled={submitMutation.isPending} onClick={() => submitMutation.mutate()} className="self-start">
          <Send />
          Отправить
        </Button>
      )}
    </div>
  );
}
