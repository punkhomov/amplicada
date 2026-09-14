import type { ToolbarActionProps } from '@amplicada/module-admin/frontend';
import { DEFAULT_EXTENSION_KEY } from '@amplicada/platform-core/contracts';
import { useApiClient, useMutation, useQueryClient } from '@amplicada/platform-core/frontend';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@amplicada/platform-core/frontend/ui/alert-dialog';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { useParams } from 'react-router-dom';

export function PublishPollAction({ editData, isNew }: ToolbarActionProps) {
  const { id } = useParams<{ id: string }>();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const status = (editData['hr-poll']?.[DEFAULT_EXTENSION_KEY] as { status?: string } | undefined)?.status;

  const publishMutation = useMutation({
    mutationFn: () => api.post(`/hr-polls/${id}/publish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'document', 'poll', id] });
    },
  });

  if (isNew || !id || status === 'published') return null;

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="lg" />}>Опубликовать</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Опубликовать опрос?</AlertDialogTitle>
          <AlertDialogDescription>
            После публикации вопросы станут доступны пользователям на портале и будут заморожены — изменить их будет нельзя. Действие
            необратимо; чтобы изменить схему вопросов позже, придётся создать новый опрос.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {publishMutation.isError && <p className="text-sm text-destructive">Не удалось опубликовать опрос</p>}
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" size="default">
            Отмена
          </AlertDialogCancel>
          <AlertDialogAction disabled={publishMutation.isPending} onClick={() => publishMutation.mutate()}>
            {publishMutation.isPending ? 'Публикация...' : 'Опубликовать'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
