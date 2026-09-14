import { useApiClient, useMutation, useQueryClient } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { useState } from 'react';

interface ActionButtonsProps {
  processId: string;
  actions: { action: string; label: string }[];
}

/** Кнопки доступных действий + опциональный комментарий. payload с этой страницы не отправляется (v1, план 06). */
export function ActionButtons({ processId, actions }: ActionButtonsProps) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const actionMutation = useMutation({
    mutationFn: (action: string) =>
      api.post(`/workflows/processes/${processId}/actions/${action}`, { comment: comment.trim() || undefined }),
    onSuccess: () => {
      setComment('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['workflows', 'process', processId] });
    },
    onError: (err: unknown) => {
      const data = (err as { data?: { error?: string } }).data;
      setError(data?.error ?? (err as Error).message);
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Комментарий (опционально)</Label>
        <Textarea className="min-h-16 text-sm" value={comment} onChange={e => setComment(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        {actions.map(({ action, label }) => (
          <Button key={action} size="sm" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate(action)}>
            {label}
          </Button>
        ))}
      </div>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
