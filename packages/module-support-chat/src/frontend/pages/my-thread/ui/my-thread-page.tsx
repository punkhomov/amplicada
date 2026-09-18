import { QueryError, useApiClient, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card } from '@amplicada/platform-core/frontend/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@amplicada/platform-core/frontend/ui/message-scroller';
import { Spinner } from '@amplicada/platform-core/frontend/ui/spinner';
import { ArrowLeftIcon, LifeBuoyIcon, SparklesIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SupportThreadDto } from '../../../../contracts/index.js';
import { supportChatMyThreadQueryOptions } from '../../../lib/query-options.js';
import { statusBadgeVariant } from '../../../lib/status.js';
import { useSupportChatEvents } from '../../../lib/use-support-chat-events.js';
import { ChatComposer, type ChatComposerInput } from '../../../widgets/chat-composer/index.js';
import { ChatTranscript } from '../../../widgets/chat-transcript/index.js';

/** Страница обращения: `/support/:id` — история и продолжение, `/support/new` — новое обращение. */
export function MyThreadPage() {
  const { t } = useTranslation('support-chat');
  const { id } = useParams<{ id: string }>();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const markedReadRef = useRef<string | null>(null);
  const isNew = !id;

  useSupportChatEvents('user');

  const { data, isLoading, isError, error, refetch } = useQuery({
    ...supportChatMyThreadQueryOptions(api, id ?? ''),
    enabled: !!id,
  });
  const thread = data?.thread ?? null;
  const unreadCount = thread?.unreadCount ?? 0;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['support-chat'] });
  };

  const send = useMutation({
    mutationFn: (input: ChatComposerInput) =>
      isNew
        ? api.post<{ thread: SupportThreadDto }>('/support-chat/threads', input)
        : api.post<{ thread: SupportThreadDto }>(`/support-chat/threads/${id}/messages`, input),
    onSuccess: result => {
      invalidate();
      if (isNew) navigate(`/support/${result.thread.id}`, { replace: true });
    },
  });

  const markRead = useMutation({
    mutationFn: (threadId: string) => api.post(`/support-chat/threads/${threadId}/read`),
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: (next: 'open' | 'closed') =>
      api.patch<{ thread: SupportThreadDto }>(`/support-chat/threads/${id}`, {
        status: next,
        closeReason: next === 'closed' ? 'resolved' : undefined,
      }),
    onSuccess: invalidate,
  });

  useEffect(() => {
    if (!id || unreadCount === 0 || markedReadRef.current === id) return;
    markedReadRef.current = id;
    markRead.mutate(id);
  }, [id, unreadCount, markRead]);

  const participants = thread
    ? [
        ...new Set(
          thread.messages
            .filter(message => message.authorRole === 'admin' && message.authorLogin)
            .map(message => message.authorLogin as string),
        ),
      ]
    : [];
  const closedNote = thread
    ? [
        thread.status === 'closed' ? t('portal_closed_note') : thread.status === 'solved' ? t('portal_resolved_note') : null,
        thread.resolvedBy ? t(`resolved_by_${thread.resolvedBy}`) : null,
        thread.closeReason ? t(`close_reason_${thread.closeReason}`) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const hint = !thread
    ? ''
    : thread.status === 'closed'
      ? t('thread_hint_closed')
      : thread.status === 'solved'
        ? t('thread_hint_solved')
        : thread.status === 'pending'
          ? t('thread_hint_pending')
          : '';

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-4 px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label={t('portal_back')} onClick={() => navigate('/support')}>
            <ArrowLeftIcon />
          </Button>
          <h1 className="truncate text-xl font-bold">{isNew ? t('portal_new') : t('portal_thread_title')}</h1>
          {thread ? <Badge variant={statusBadgeVariant(thread.status)}>{t(`status_${thread.status}`)}</Badge> : null}
          {thread && (thread.kind === 'incident' || thread.incidentThreadId) ? (
            <Badge variant="destructive">
              {t('kind_incident')}
              {thread.severity ? ` · ${t(`severity_${thread.severity}`)}` : ''}
            </Badge>
          ) : null}
        </div>

        {thread ? (
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
            <span>{`${t('portal_created')}: ${new Date(thread.createdAt).toLocaleString()}`}</span>
            {participants.length > 0 ? (
              <span className="max-w-56 truncate text-right">{`${t('portal_participants')}: ${participants.join(', ')}`}</span>
            ) : null}
            {closedNote ? <span className="text-right">{closedNote}</span> : null}
            {thread.status === 'closed' ? (
              <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate('open')}>
                {t('portal_reopen')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate('closed')}>
                {t('portal_close')}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <Card className="flex h-[min(40rem,calc(100dvh-13rem))] flex-col gap-0 overflow-hidden py-0">
        <MessageScrollerProvider key={id ?? 'new'} autoScroll defaultScrollPosition="end">
          <div className="flex-1 min-h-0 flex flex-col">
            {!isNew && isLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : !isNew && isError ? (
              <div className="flex flex-1 items-center justify-center p-4">
                <QueryError error={error} onRetry={refetch} />
              </div>
            ) : !thread || thread.messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <Empty className="border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <LifeBuoyIcon />
                    </EmptyMedia>
                    <EmptyTitle>{isNew ? t('portal_new_hint_title') : t('widget_empty_title')}</EmptyTitle>
                    <EmptyDescription>{isNew ? t('portal_new_hint') : t('widget_empty')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : (
              <MessageScroller className="flex-1">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="gap-0 px-4 py-3">
                    <ChatTranscript
                      messages={thread.messages}
                      ownRole="user"
                      nameFor={message => message.authorLogin ?? t(`role_${message.authorRole}`)}
                      roleTagFor={message => ({ label: t(`role_${message.authorRole}`) })}
                      avatarFor={message =>
                        message.authorRole === 'ai' ? (
                          <SparklesIcon className="size-4 text-muted-foreground" />
                        ) : (
                          <LifeBuoyIcon className="size-4 text-muted-foreground" />
                        )
                      }
                      attachmentHrefFor={message => `${api.baseUrl}/support-chat/attachments/${message.id}`}
                    />
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            )}

            <ChatComposer
              placeholder={t('widget_placeholder')}
              hint={hint}
              pending={send.isPending}
              onSubmit={input => send.mutateAsync(input).then(() => undefined)}
            />
          </div>
        </MessageScrollerProvider>
      </Card>
    </div>
  );
}
