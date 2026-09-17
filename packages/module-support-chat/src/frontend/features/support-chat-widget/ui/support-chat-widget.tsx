import { useApiClient, useCurrentUser, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card, CardHeader, CardTitle } from '@amplicada/platform-core/frontend/ui/card';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@amplicada/platform-core/frontend/ui/message-scroller';
import { LifeBuoyIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import type { SupportThreadDto } from '../../../../contracts/index.js';
import { supportChatQueryKeys, supportChatThreadQueryOptions } from '../../../lib/query-options.js';
import { useSupportChatEvents } from '../../../lib/use-support-chat-events.js';
import { ChatTranscript } from '../../../widgets/chat-transcript/index.js';
import { SupportChatComposer } from './support-chat-composer.js';

export function SupportChatWidget() {
  const { t } = useTranslation();
  const { user, loading } = useCurrentUser();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  useSupportChatEvents('user', !!user);

  const { data } = useQuery({ ...supportChatThreadQueryOptions(api), enabled: !!user });
  const thread = data?.thread ?? null;
  const unreadCount = thread?.unreadCount ?? 0;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: supportChatQueryKeys.thread });
  };

  const send = useMutation({
    mutationFn: (body: string) => api.post<{ thread: SupportThreadDto }>('/support-chat/thread/messages', { body }),
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
  });

  const markRead = useMutation({
    mutationFn: () => api.post('/support-chat/thread/read'),
    onSuccess: invalidate,
  });

  if (loading || !user) return null;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && unreadCount > 0) markRead.mutate();
  };

  return (
    <>
      {!open && (
        <Button
          size="icon-lg"
          className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg"
          aria-label={t('support-chat:widget_open')}
          onClick={() => handleOpenChange(true)}
        >
          <LifeBuoyIcon />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-5 justify-center px-1 text-xs tabular-nums">{unreadCount}</Badge>
          )}
        </Button>
      )}

      {open && (
        <Card className="fixed bottom-20 right-4 z-50 flex h-[min(32rem,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden py-0 shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-3">
            <CardTitle className="text-base">{t('support-chat:widget_title')}</CardTitle>
            <Button variant="ghost" size="icon-sm" aria-label={t('support-chat:widget_close')} onClick={() => handleOpenChange(false)}>
              <XIcon />
            </Button>
          </CardHeader>

          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <div className="flex-1 min-h-0 flex flex-col">
              <MessageScroller className="flex-1">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="gap-0 px-4 py-3">
                    <ChatTranscript
                      messages={thread?.messages ?? []}
                      ownRole="user"
                      labelFor={message => t(`support-chat:role_${message.authorRole}`)}
                      avatarFor={message =>
                        message.authorRole === 'ai' ? (
                          <SparklesIcon className="size-4 text-muted-foreground" />
                        ) : (
                          <LifeBuoyIcon className="size-4 text-muted-foreground" />
                        )
                      }
                      emptyText={t('support-chat:widget_empty')}
                    />
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>

              <SupportChatComposer
                value={draft}
                onValueChange={setDraft}
                onSubmit={() => send.mutate(draft.trim())}
                pending={send.isPending}
                placeholder={t('support-chat:widget_placeholder')}
                submitLabel={t('support-chat:widget_send')}
                hint={thread?.status === 'closed' ? t('support-chat:widget_closed') : ''}
              />
            </div>
          </MessageScrollerProvider>
        </Card>
      )}
    </>
  );
}
