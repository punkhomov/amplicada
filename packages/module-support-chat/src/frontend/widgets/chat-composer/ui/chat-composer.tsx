import { useApiClient, useTranslation } from '@amplicada/platform-core/frontend';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@amplicada/platform-core/frontend/ui/attachment';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { useMessageScroller } from '@amplicada/platform-core/frontend/ui/message-scroller';
import { Spinner } from '@amplicada/platform-core/frontend/ui/spinner';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { ArrowUpIcon, FileIcon, PlusIcon, XIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { SupportAttachmentUploadDto } from '../../../../contracts/index.js';
import { formatBytes } from '../../chat-transcript/index.js';

export interface ChatComposerInput {
  body: string;
  attachment: SupportAttachmentUploadDto | null;
}

interface ChatComposerProps {
  placeholder: string;
  hint?: string;
  pending: boolean;
  /** Отправка; черновик очищается только после успешного промиса. */
  onSubmit: (input: ChatComposerInput) => Promise<void>;
}

export function ChatComposer({ placeholder, hint, pending, onSubmit }: ChatComposerProps) {
  const { t } = useTranslation('support-chat');
  const api = useApiClient();
  const { scrollToEnd } = useMessageScroller();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState<SupportAttachmentUploadDto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = (body.trim().length > 0 || attachment !== null) && !pending && !uploading;

  const submit = async () => {
    if (!canSend) return;
    try {
      setError(null);
      await onSubmit({ body: body.trim(), attachment });
      setBody('');
      setAttachment(null);
      scrollToEnd();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      setAttachment(await api.post<SupportAttachmentUploadDto>('/support-chat/attachments', form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  return (
    <form
      className="shrink-0 border-t p-3"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-2 rounded-3xl bg-muted p-2.5">
        {attachment ? (
          <Attachment size="sm" state={uploading ? 'uploading' : 'done'} className="max-w-full bg-background">
            <AttachmentMedia>
              <FileIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{attachment.name}</AttachmentTitle>
              <AttachmentDescription>{formatBytes(attachment.size)}</AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction type="button" aria-label={t('widget_attachment_remove')} onClick={() => setAttachment(null)}>
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ) : null}

        <Textarea
          value={body}
          rows={1}
          placeholder={placeholder}
          className="min-h-9 resize-none border-0 bg-transparent px-1.5 py-1 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
          onChange={event => setBody(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={t('widget_attach')}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusIcon />
          </Button>

          <div className="flex min-w-0 items-center gap-2">
            {error ? <span className="truncate text-xs text-destructive">{error}</span> : null}
            {!error && hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
            <Button type="submit" size="icon-sm" className="rounded-full" aria-label={t('widget_send')} disabled={!canSend}>
              {pending ? <Spinner /> : <ArrowUpIcon />}
            </Button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
    </form>
  );
}
