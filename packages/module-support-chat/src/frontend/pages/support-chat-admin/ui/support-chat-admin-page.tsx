import { cn, useApiClient, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@amplicada/platform-core/frontend/ui/message-scroller';
import { SparklesIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SupportThreadDto } from '../../../../contracts/index.js';
import { supportChatAdminThreadQueryOptions, supportChatAdminThreadsQueryOptions } from '../../../lib/query-options.js';
import { useSupportChatEvents } from '../../../lib/use-support-chat-events.js';
import { ChatComposer, type ChatComposerInput } from '../../../widgets/chat-composer/index.js';
import { ChatTranscript } from '../../../widgets/chat-transcript/index.js';

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function SupportChatAdminPage() {
  const { t } = useTranslation('support-chat');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const markedReadRef = useRef<string | null>(null);

  useSupportChatEvents('admin');

  const { data: threads = [] } = useQuery(supportChatAdminThreadsQueryOptions(api));
  const activeId = selectedId ?? threads[0]?.id ?? null;

  const { data: detail } = useQuery({ ...supportChatAdminThreadQueryOptions(api, activeId ?? ''), enabled: !!activeId });
  const thread = detail?.thread ?? null;
  const unreadCount = thread?.unreadCount ?? 0;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['support-chat'] });
  };

  const reply = useMutation({
    mutationFn: (input: ChatComposerInput) =>
      api.post<{ thread: SupportThreadDto }>(`/support-chat/admin/threads/${activeId}/messages`, input),
    onSuccess: invalidate,
  });

  const changeStatus = useMutation({
    mutationFn: (status: 'open' | 'closed') => api.patch(`/support-chat/admin/threads/${activeId}`, { status }),
    onSuccess: invalidate,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/support-chat/admin/threads/${id}/read`),
    onSuccess: invalidate,
  });

  useEffect(() => {
    if (!activeId || unreadCount === 0 || markedReadRef.current === activeId) return;
    markedReadRef.current = activeId;
    markRead.mutate(activeId);
  }, [activeId, unreadCount, markRead]);

  const userLogin = detail?.userLogin ?? '';

  return (
    <div className="h-full min-h-0 flex">
      <aside className="w-80 shrink-0 border-r overflow-y-auto">
        <div className="sticky top-0 bg-background border-b px-4 py-3">
          <h2 className="font-semibold">{t('admin_threads_title')}</h2>
        </div>
        {threads.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t('admin_threads_empty')}</p>
        ) : (
          threads.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id);
                markedReadRef.current = null;
              }}
              className={cn(
                'w-full text-left px-4 py-3 border-b cursor-pointer transition-colors hover:bg-muted/50',
                activeId === item.id && 'bg-muted',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{item.userLogin}</span>
                <span className="text-xs text-muted-foreground shrink-0">{formatTime(item.updatedAt)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground truncate">{item.lastMessagePreview ?? ''}</span>
                <Badge variant={item.unreadCount > 0 ? 'default' : 'secondary'} className="shrink-0 tabular-nums">
                  {item.unreadCount}
                </Badge>
              </div>
            </button>
          ))
        )}
      </aside>

      <section className="flex-1 min-h-0 flex flex-col">
        {!thread || !activeId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">{t('admin_no_selection')}</div>
        ) : (
          <>
            <div className="shrink-0 border-b px-4 py-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold truncate">{userLogin}</span>
                <Badge variant={thread.status === 'open' ? 'default' : 'secondary'}>
                  {thread.status === 'open' ? t('admin_status_open') : t('admin_status_closed')}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={changeStatus.isPending}
                onClick={() => changeStatus.mutate(thread.status === 'open' ? 'closed' : 'open')}
              >
                {thread.status === 'open' ? t('admin_close') : t('admin_reopen')}
              </Button>
            </div>

            <MessageScrollerProvider key={activeId} autoScroll defaultScrollPosition="end">
              <div className="flex-1 min-h-0 flex flex-col">
                <MessageScroller className="flex-1">
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="gap-0 px-4 py-3">
                      <ChatTranscript
                        messages={thread.messages}
                        ownRole="admin"
                        nameFor={message => (message.authorRole === 'user' ? (message.authorLogin ?? userLogin) : null)}
                        roleTagFor={message => (message.authorRole === 'user' ? { label: t('role_user'), variant: 'outline' } : null)}
                        avatarFor={message =>
                          message.authorRole === 'user' ? (
                            <span className="text-xs font-medium">{(message.authorLogin ?? userLogin).slice(0, 1).toUpperCase()}</span>
                          ) : (
                            <SparklesIcon className="size-4 text-muted-foreground" />
                          )
                        }
                        attachmentHrefFor={message => `${api.baseUrl}/support-chat/attachments/${message.id}`}
                      />
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton />
                </MessageScroller>

                <ChatComposer
                  placeholder={t('admin_reply_placeholder')}
                  pending={reply.isPending}
                  onSubmit={input => reply.mutateAsync(input).then(() => undefined)}
                />
              </div>
            </MessageScrollerProvider>
          </>
        )}
      </section>
    </div>
  );
}
