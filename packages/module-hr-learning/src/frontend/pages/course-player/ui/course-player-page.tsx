import { getErrorMessage, QueryError, useApiClient, useMutation, useQuery, useQueryClient } from '@amplicada/platform-core/frontend';
import { Alert, AlertDescription } from '@amplicada/platform-core/frontend/ui/alert';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { type AttemptCompletion, type AttemptProgress, type CourseLaunch, isScormKind } from '../../../../contracts/index.js';

/**
 * Курс сам родителю ничего не сообщает — он в песочнице и до нас не дотягивается. Единственный
 * способ показать прогресс в шапке — переспрашивать свой же API; рантайм внутри сохраняется раз в
 * полминуты, поэтому чаще смысла нет.
 */
const PROGRESS_POLL_MS = 15_000;

const COMPLETION_LABELS: Record<AttemptCompletion, string> = {
  not_started: 'Не начат',
  in_progress: 'В процессе',
  completed: 'Пройден',
};

/**
 * Плеер курса: шапка с прогрессом и iframe с содержимым.
 *
 * Всё содержательное происходит **внутри** iframe: там живёт SCORM-рантайм, он же шлёт коммиты на
 * наш API. Эта страница ничего не знает про `cmi` и знать не должна — она открывает адрес, который
 * выдал запуск, и показывает то, что БД записала по итогам коммитов.
 */
export function CoursePlayerPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const {
    data: launch,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['learning', 'launch', courseId],
    // POST в queryFn — не оплошность: запуск идемпотентен по смыслу. Незавершённая попытка на курс
    // ровно одна (частичный уникальный индекс), повторный вызов её переиспользует и лишь
    // перевыпускает сессию просмотра. Новая попытка заводится, только когда открытой нет.
    queryFn: () => api.post<CourseLaunch>(`/learning/courses/${courseId}/launch`),
    enabled: !!courseId,
    // Перезапуск на каждом возврате фокуса перевыпускал бы сессию и обесценивал ту, в которой
    // сейчас открыт курс, — то есть ломал бы ровно то, что защищает.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const attemptId = launch?.attemptId;
  const { data: progress } = useQuery({
    queryKey: ['learning', 'progress', attemptId],
    queryFn: () => api.get<AttemptProgress>(`/learning/attempts/${attemptId}/progress`),
    enabled: !!attemptId,
    refetchInterval: PROGRESS_POLL_MS,
    initialData: launch?.progress,
  });

  const acknowledge = useMutation({
    mutationFn: () => api.post<AttemptProgress>(`/learning/attempts/${attemptId}/acknowledge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['learning', 'progress', attemptId] }),
  });

  if (!courseId) return null;
  if (isError) return <QueryError error={error} onRetry={refetch} />;
  if (isLoading || !launch) return <div className="p-8 text-muted-foreground">Открываем курс…</div>;

  const state = progress ?? launch.progress;

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{launch.courseTitle}</h1>
        <Badge variant={state.completion === 'completed' ? 'default' : 'secondary'}>{COMPLETION_LABELS[state.completion]}</Badge>
        {state.success && (
          <Badge variant={state.success === 'passed' ? 'default' : 'destructive'}>
            {state.success === 'passed' ? 'Сдано' : 'Не сдано'}
          </Badge>
        )}
        {state.score !== null && <span className="text-sm text-muted-foreground tabular-nums">Балл: {state.score}</span>}
        <span className="text-sm text-muted-foreground tabular-nums">Время: {formatDuration(state.totalTimeSeconds)}</span>

        {!isScormKind(launch.kind) && state.completion !== 'completed' && (
          <Button size="sm" className="ml-auto" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate()}>
            <CheckCircle2 className="size-4" />
            Ознакомлен
          </Button>
        )}
      </div>

      {acknowledge.error && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertDescription>{getErrorMessage(acknowledge.error)}</AlertDescription>
        </Alert>
      )}

      {/*
        Про `sandbox` здесь намеренно ничего нет: изоляция задаётся заголовком `Content-Security-Policy`
        на самой раздаче контента, а не атрибутом. Атрибут действует только на этот конкретный iframe —
        заголовок действует на документ, как бы его ни открыли, в том числе если ссылку скопировали в
        новую вкладку.
      */}
      <iframe
        key={launch.contentUrl}
        src={launch.contentUrl}
        title={launch.courseTitle}
        className="w-full flex-1 rounded border bg-white"
        allow="autoplay; fullscreen; microphone; camera"
      />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} ч ${minutes} мин`;
  if (minutes) return `${minutes} мин`;
  return `${seconds} с`;
}
