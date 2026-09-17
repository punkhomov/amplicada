import { DEFAULT_EXTENSION_KEY } from '@amplicada/platform-core/contracts';
import { useApiClient, useMutation, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Alert, AlertDescription, AlertTitle } from '@amplicada/platform-core/frontend/ui/alert';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@amplicada/platform-core/frontend/ui/dialog';
import { Send } from 'lucide-react';
import { useState } from 'react';
import {
  ADMIN_BROADCAST_MAX_RECIPIENTS,
  AdminDocuments,
  type SendNotificationTemplateResponse,
} from '../../../../contracts/notification-template.js';
import type { ToolbarActionProps } from '../../../../contracts/toolbar.js';
import { useDocumentCardContext } from '../../../lib/document-card-context.js';
import { type PickedUser, UserPicker } from '../../user-picker/index.js';

/**
 * Действие карточки шаблона: рассылка сохранённого шаблона выбранным пользователям.
 * Ядро получает по одному `send({ userId })` на получателя — контракт уведомлений не меняется,
 * а адрес и канал по-прежнему резолвит канальный модуль.
 *
 * Отправляется сохранённая версия: черновик в форме сначала надо сохранить, поэтому кнопка
 * заблокирована на несохранённой карточке.
 */
export function SendNotificationTemplateAction({ documentType, editData, isNew }: ToolbarActionProps) {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { documentId } = useDocumentCardContext();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PickedUser[]>([]);
  const [result, setResult] = useState<SendNotificationTemplateResponse | null>(null);

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<SendNotificationTemplateResponse>('/admin/notifications/send-template', {
        templateId: documentId ?? '',
        userIds: selected.map(user => user.id),
      }),
    onSuccess: response => {
      setResult(response);
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] });
    },
  });

  if (documentType !== AdminDocuments.NOTIFICATION_TEMPLATE) return null;

  const bucket = editData.admin?.[DEFAULT_EXTENSION_KEY] ?? {};
  const subject = typeof bucket.subject === 'string' ? bucket.subject : '';
  const ready = !!documentId && !isNew;
  const overLimit = selected.length > ADMIN_BROADCAST_MAX_RECIPIENTS;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setResult(null);
      sendMutation.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="lg" />}>
        <Send />
        {t('template_send_action')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('template_send_title')}</DialogTitle>
          <DialogDescription>{subject || t('template_send_description')}</DialogDescription>
        </DialogHeader>

        {!ready ? (
          <Alert variant="destructive">
            <AlertTitle>{t('template_send_unsaved')}</AlertTitle>
          </Alert>
        ) : (
          <UserPicker selected={selected} onChange={setSelected} />
        )}

        {overLimit && (
          <Alert variant="destructive">
            <AlertTitle>{t('template_send_over_limit', { max: ADMIN_BROADCAST_MAX_RECIPIENTS })}</AlertTitle>
          </Alert>
        )}

        {result && (
          <Alert>
            <AlertTitle>
              {t('template_send_result', {
                queued: result.queued,
                total: result.total,
                skipped: result.skipped,
                failed: result.failed,
              })}
            </AlertTitle>
            {result.skipped > 0 && <AlertDescription>{t('template_send_skipped_hint')}</AlertDescription>}
          </Alert>
        )}

        {sendMutation.isError && <p className="text-sm text-destructive">{t('template_send_error')}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('core:common_cancel')}
          </Button>
          <Button disabled={!ready || selected.length === 0 || overLimit || sendMutation.isPending} onClick={() => sendMutation.mutate()}>
            {sendMutation.isPending ? t('template_send_pending') : t('template_send_submit', { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
