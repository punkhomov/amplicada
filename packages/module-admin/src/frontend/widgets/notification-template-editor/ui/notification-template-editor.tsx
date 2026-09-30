import type { FieldMetadata, NotificationAttachment } from '@amplicada/platform-core/contracts';
import { useApiClient, useMutation, useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Alert, AlertTitle } from '@amplicada/platform-core/frontend/ui/alert';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@amplicada/platform-core/frontend/ui/tabs';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { Paperclip, X } from 'lucide-react';
import { useRef } from 'react';
import { useDocumentCardContext } from '../../../lib/document-card-context.js';

interface NotificationTemplateEditorProps {
  /** Бакет extension'а целиком: subject/name — соседние поля карточки, их надо сохранять. */
  data: Record<string, unknown>;
  fields: Record<string, FieldMetadata>;
  readonly?: boolean;
  onChange: (data: Record<string, unknown>) => void;
}

/** Сентинел «дефолтный отправитель узла»: Base UI Select не любит пустые value. */
const DEFAULT_SENDER = '__default__';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МиБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КиБ`;
  return `${bytes} Б`;
}

/**
 * Редактор шаблона: отправитель, контент (plain text, HTML, предпросмотр) и вложения.
 * Без rich-text библиотеки — textarea + iframe-песочница. `onChange` заменяет бакет
 * extension'а целиком, поэтому остальные ключи сохраняются явно.
 *
 * Вложения живут в storage и манифесте документа: загрузка/снятие — сразу через API,
 * ответ синхронизируется в локальный бакет (дальше его сохранит кнопка карточки).
 */
export function NotificationTemplateEditor({ data, fields, readonly, onChange }: NotificationTemplateEditorProps) {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const { documentId, fixture } = useDocumentCardContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const locked = readonly || fixture;

  const body = typeof data.body === 'string' ? data.body : '';
  const html = typeof data.html === 'string' ? data.html : '';
  const subject = typeof data.subject === 'string' ? data.subject : '';
  const sender = typeof data.sender === 'string' ? data.sender : '';
  const attachments = Array.isArray(data.attachments) ? (data.attachments as NotificationAttachment[]) : [];

  const patch = (key: 'body' | 'html', value: string) => onChange({ ...data, [key]: value });

  const sendersQuery = useQuery({
    queryKey: ['admin', 'notifications', 'senders'],
    queryFn: () => api.get<{ senders: string[] }>('/admin/notifications/senders'),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post<{ attachments: NotificationAttachment[] }>(
        `/admin/notifications/template-attachments?templateId=${encodeURIComponent(documentId ?? '')}`,
        formData,
      );
    },
    onSuccess: response => onChange({ ...data, attachments: response.attachments }),
  });

  const removeMutation = useMutation({
    mutationFn: (storageKey: string) =>
      api.delete<{ attachments: NotificationAttachment[] }>('/admin/notifications/template-attachments', {
        body: { templateId: documentId, storageKey },
      }),
    onSuccess: response => onChange({ ...data, attachments: response.attachments }),
  });

  const attachmentsDisabled = locked || documentId === null;
  const senderItems = [
    { value: DEFAULT_SENDER, label: t('template_editor_sender_default') },
    ...(sendersQuery.data?.senders ?? []).map(name => ({ value: name, label: name })),
  ];

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) uploadMutation.mutate(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="mb-1 block">{t('template_editor_sender_label')}</Label>
        <Select
          items={senderItems}
          value={sender || DEFAULT_SENDER}
          onValueChange={value => onChange({ ...data, sender: value === DEFAULT_SENDER ? undefined : value })}
          disabled={locked}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('template_editor_sender_default')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_SENDER}>{t('template_editor_sender_default')}</SelectItem>
            {(sendersQuery.data?.senders ?? []).map(name => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="body">
        <TabsList>
          <TabsTrigger value="body">{t('template_editor_tab_body')}</TabsTrigger>
          <TabsTrigger value="html">{t('template_editor_tab_html')}</TabsTrigger>
          <TabsTrigger value="preview">{t('template_editor_tab_preview')}</TabsTrigger>
        </TabsList>

        <TabsContent value="body" className="mt-2">
          <Label className="mb-1 block">{fields.body?.label ?? t('template_editor_tab_body')}</Label>
          <Textarea
            rows={12}
            value={body}
            readOnly={locked}
            placeholder={fields.body?.placeholder}
            onChange={event => patch('body', event.target.value)}
          />
        </TabsContent>

        <TabsContent value="html" className="mt-2">
          <Label className="mb-1 block">{fields.html?.label ?? t('template_editor_tab_html')}</Label>
          <Textarea
            rows={12}
            value={html}
            readOnly={locked}
            placeholder={fields.html?.placeholder}
            onChange={event => patch('html', event.target.value)}
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-2">
          <div className="overflow-hidden rounded-lg border">
            <div className="border-b bg-muted/40 px-3 py-2 text-sm">
              {subject || <span className="text-muted-foreground">{t('template_editor_no_subject')}</span>}
            </div>
            {html.trim() ? (
              <iframe title={t('template_editor_preview_title')} className="h-96 w-full bg-white" sandbox="" srcDoc={html} />
            ) : (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-3 text-sm">{body}</pre>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div>
        <Label className="mb-1 block">{t('template_editor_attachments_title')}</Label>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={attachmentsDisabled || uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-3.5" />
            {t('template_editor_attachment_upload')}
          </Button>
          {documentId === null && <span className="text-xs text-muted-foreground">{t('template_attachments_save_first')}</span>}
        </div>

        {attachments.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {attachments.map(attachment => (
              <li
                key={attachment.storageKey}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <span className="truncate">
                  {attachment.filename}
                  {attachment.size !== undefined && <span className="text-muted-foreground"> · {formatSize(attachment.size)}</span>}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('template_editor_attachment_remove')}
                  disabled={locked || removeMutation.isPending}
                  onClick={() => removeMutation.mutate(attachment.storageKey)}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {(uploadMutation.isError || removeMutation.isError) && (
          <Alert variant="destructive" className="mt-2">
            <AlertTitle>
              {uploadMutation.error instanceof Error
                ? uploadMutation.error.message
                : removeMutation.error instanceof Error
                  ? removeMutation.error.message
                  : t('template_editor_attachment_error')}
            </AlertTitle>
          </Alert>
        )}
      </div>
    </div>
  );
}
