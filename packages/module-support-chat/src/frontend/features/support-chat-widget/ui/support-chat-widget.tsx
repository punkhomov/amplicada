import { useApiClient, useCurrentUser, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@amplicada/platform-core/frontend/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@amplicada/platform-core/frontend/ui/message-scroller';
import { Spinner } from '@amplicada/platform-core/frontend/ui/spinner';
import { CircleCheckIcon, LifeBuoyIcon, MessagesSquareIcon, RotateCcwIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SupportThreadDto } from '../../../../contracts/index.js';
import { supportChatQueryKeys, supportChatThreadQueryOptions } from '../../../lib/query-options.js';
import { useSupportChatEvents } from '../../../lib/use-support-chat-events.js';
import { ChatComposer, type ChatComposerInput } from '../../../widgets/chat-composer/index.js';
import { ChatTranscript } from '../../../widgets/chat-transcript/index.js';

export function SupportChatWidget() {
  const { t } = useTranslation('support-chat');
  const { user, loading } = useCurrentUser();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useSupportChatEvents('user', !!user);

  const { data, isPending } = useQuery({ ...supportChatThreadQueryOptions(api), enabled: !!user });
  const thread = data?.thread ?? null;
  /** Бейдж считает непрочитанное по всем обращениям, а не только по активному. */
  const unreadTotal = data?.unreadTotal ?? 0;
  const messages = thread?.messages ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: supportChatQueryKeys.thread });
  };

  const send = useMutation({
    mutationFn: (input: ChatComposerInput) => api.post<{ thread: SupportThreadDto }>('/support-chat/thread/messages', input),
    onSuccess: invalidate,
  });

  const markRead = useMutation({
    mutationFn: () => api.post('/support-chat/thread/read'),
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: (next: 'open' | 'closed') => {
      if (!thread) throw new Error('No active thread');
      return api.patch(`/support-chat/threads/${thread.id}`, {
        status: next,
        closeReason: next === 'closed' ? 'resolved' : undefined,
      });
    },
    onSuccess: invalidate,
  });

  if (loading || !user) return null;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && (thread?.unreadCount ?? 0) > 0) markRead.mutate();
  };

  return (
    <>
      {!open && (
        <Button
          size="icon-lg"
          className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg"
          aria-label={t('widget_open')}
          onClick={() => handleOpenChange(true)}
        >
          <LifeBuoyIcon />
          {unreadTotal > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-5 justify-center px-1 text-xs tabular-nums">{unreadTotal}</Badge>
          )}
        </Button>
      )}

      {open && (
        <Card className="fixed bottom-20 right-4 z-50 flex h-[min(32rem,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden py-0 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-3">
            <div className="min-w-0">
              <CardTitle className="text-base">{t('widget_title')}</CardTitle>
              <CardDescription className="truncate text-xs">{t('widget_subtitle')}</CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {thread && thread.status !== 'closed' ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('widget_close_thread')}
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('closed')}
                >
                  <CircleCheckIcon />
                </Button>
              ) : thread ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('portal_reopen')}
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('open')}
                >
                  <RotateCcwIcon />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('widget_all_requests')}
                onClick={() => {
                  setOpen(false);
                  navigate('/support');
                }}
              >
                <MessagesSquareIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={t('widget_close')} onClick={() => handleOpenChange(false)}>
                <XIcon />
              </Button>
            </div>
          </CardHeader>

          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <div className="flex-1 min-h-0 flex flex-col">
              {isPending || messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-4">
                  {isPending ? (
                    <Spinner className="size-6 text-muted-foreground" />
                  ) : (
                    <Empty className="border-0 p-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <LifeBuoyIcon />
                        </EmptyMedia>
                        <EmptyTitle>{t('widget_empty_title')}</EmptyTitle>
                        <EmptyDescription>{t('widget_empty')}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </div>
              ) : (
                <MessageScroller className="flex-1">
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="gap-0 px-4 py-3">
                      <ChatTranscript
                        messages={messages}
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
                hint={
                  thread?.status === 'closed'
                    ? t('thread_hint_closed')
                    : thread?.status === 'solved'
                      ? t('thread_hint_solved')
                      : thread?.status === 'pending'
                        ? t('thread_hint_pending')
                        : ''
                }
                pending={send.isPending}
                onSubmit={input => send.mutateAsync(input).then(() => undefined)}
              />
            </div>
          </MessageScrollerProvider>
        </Card>
      )}
    </>
  );
}
