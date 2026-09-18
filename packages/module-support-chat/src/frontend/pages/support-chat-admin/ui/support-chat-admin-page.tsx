import { cn, useApiClient, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@amplicada/platform-core/frontend/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@amplicada/platform-core/frontend/ui/dropdown-menu';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@amplicada/platform-core/frontend/ui/message-scroller';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { AlertTriangleIcon, BellIcon, ChevronDownIcon, Link2OffIcon, SparklesIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  SupportAdminThreadDto,
  SupportCloseReason,
  SupportIncidentSeverity,
  SupportThreadDto,
  SupportThreadStatus,
} from '../../../../contracts/index.js';
import { supportChatAdminThreadQueryOptions, supportChatAdminThreadsQueryOptions } from '../../../lib/query-options.js';
import { isActiveStatus, statusBadgeVariant } from '../../../lib/status.js';
import { useSupportChatEvents } from '../../../lib/use-support-chat-events.js';
import { ChatComposer, type ChatComposerInput } from '../../../widgets/chat-composer/index.js';
import { ChatTranscript } from '../../../widgets/chat-transcript/index.js';

type StatusFilter = 'all' | 'active' | SupportThreadStatus;

const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'open', 'pending', 'solved', 'closed'];
const SEVERITIES: SupportIncidentSeverity[] = ['low', 'medium', 'high', 'critical'];

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function filterLabel(filter: StatusFilter, t: (key: string) => string): string {
  if (filter === 'all') return t('admin_filter_all');
  if (filter === 'active') return t('admin_filter_active');
  return t(`status_${filter}`);
}

export function SupportChatAdminPage() {
  const { t } = useTranslation('support-chat');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [linkOpen, setLinkOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
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

  const updateThread = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch<{ thread: SupportThreadDto }>(`/support-chat/admin/threads/${activeId}`, patch),
    onSuccess: () => {
      setLinkOpen(false);
      invalidate();
    },
  });

  const broadcast = useMutation({
    mutationFn: (body: string) => api.post<{ recipients: number }>(`/support-chat/admin/threads/${activeId}/broadcast`, { body }),
    onSuccess: () => {
      setBroadcastOpen(false);
      setBroadcastText('');
      invalidate();
    },
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
  const linkedThreads = detail?.linkedThreads ?? [];
  const incidents = threads.filter(item => item.kind === 'incident' && item.id !== activeId);
  const linkedIncident = thread?.incidentThreadId ? threads.find(item => item.id === thread.incidentThreadId) : undefined;

  const visibleThreads = threads.filter(item => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'active') return isActiveStatus(item.status);
    return item.status === statusFilter;
  });

  const selectThread = (id: string) => {
    setSelectedId(id);
    markedReadRef.current = null;
  };

  const closeWithReason = (reason: SupportCloseReason) => updateThread.mutate({ status: 'closed', closeReason: reason });

  return (
    <div className="h-full min-h-0 flex">
      <aside className="w-80 shrink-0 border-r overflow-y-auto">
        <div className="sticky top-0 bg-background border-b px-4 py-3 flex flex-col gap-2">
          <h2 className="font-semibold">{t('admin_threads_title')}</h2>
          <Select value={statusFilter} onValueChange={value => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map(filter => (
                <SelectItem key={filter} value={filter}>
                  {filterLabel(filter, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {visibleThreads.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t('admin_threads_empty')}</p>
        ) : (
          visibleThreads.map(item => (
            <ThreadListItem key={item.id} item={item} active={activeId === item.id} onSelect={() => selectThread(item.id)} />
          ))
        )}
      </aside>

      <section className="flex-1 min-h-0 flex flex-col">
        {!thread || !activeId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">{t('admin_no_selection')}</div>
        ) : (
          <>
            <div className="shrink-0 border-b px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-semibold truncate">{userLogin}</span>
                  <Badge variant={statusBadgeVariant(thread.status)}>{t(`status_${thread.status}`)}</Badge>
                  {thread.kind === 'incident' ? (
                    <Badge variant="destructive">
                      {t('kind_incident')}
                      {thread.severity ? ` · ${t(`severity_${thread.severity}`)}` : ''}
                    </Badge>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {thread.kind === 'incident' && linkedThreads.length > 0 ? (
                    <Button size="sm" variant="outline" disabled={broadcast.isPending} onClick={() => setBroadcastOpen(true)}>
                      <BellIcon data-icon="inline-start" />
                      {`${t('admin_broadcast')} (${linkedThreads.length})`}
                    </Button>
                  ) : null}

                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium outline-none hover:bg-muted">
                      {t('admin_actions')}
                      <ChevronDownIcon className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => updateThread.mutate({ status: 'open' })}>{t('admin_mark_open')}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => updateThread.mutate({ status: 'pending' })}>
                        {t('admin_mark_pending')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => updateThread.mutate({ status: 'solved' })}>
                        {t('admin_mark_solved')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => closeWithReason('resolved')}>{t('admin_mark_closed')}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => closeWithReason('duplicate')}>
                        {`${t('admin_mark_closed')} · ${t('close_reason_duplicate')}`}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium outline-none hover:bg-muted">
                      <AlertTriangleIcon className="size-4" />
                      {t('kind_incident')}
                      <ChevronDownIcon className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {thread.kind === 'question' ? (
                        <>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>{t('admin_make_incident')}</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {SEVERITIES.map(severity => (
                                <DropdownMenuItem key={severity} onClick={() => updateThread.mutate({ kind: 'incident', severity })}>
                                  {t(`severity_${severity}`)}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          {thread.incidentThreadId ? (
                            <DropdownMenuItem onClick={() => updateThread.mutate({ incidentThreadId: null })}>
                              <Link2OffIcon data-icon="inline-start" />
                              {t('admin_unlink_incident')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setLinkOpen(true)}>{t('admin_link_incident')}</DropdownMenuItem>
                          )}
                        </>
                      ) : (
                        <>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>{t('admin_incident_severity')}</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {SEVERITIES.map(severity => (
                                <DropdownMenuItem key={severity} onClick={() => updateThread.mutate({ severity })}>
                                  {t(`severity_${severity}`)}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => updateThread.mutate({ kind: 'question' })}>
                            {t('admin_demote_incident')}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {thread.kind === 'incident' && linkedThreads.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{t('admin_linked_threads')}:</span>
                  {linkedThreads.map(linked => (
                    <button
                      key={linked.id}
                      type="button"
                      onClick={() => selectThread(linked.id)}
                      className="cursor-pointer rounded-full border px-2 py-0.5 hover:bg-muted"
                    >
                      {`${linked.userLogin} · ${t(`status_${linked.status}`)}`}
                    </button>
                  ))}
                </div>
              ) : null}

              {linkedIncident ? (
                <div className="text-xs text-muted-foreground">
                  {`${t('kind_incident')}: `}
                  <button type="button" className="cursor-pointer underline" onClick={() => selectThread(linkedIncident.id)}>
                    {linkedIncident.userLogin}
                  </button>
                </div>
              ) : null}
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

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin_link_incident')}</DialogTitle>
            <DialogDescription>{t('admin_link_incident_hint')}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin_no_incidents')}</p>
            ) : (
              incidents.map(incident => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => updateThread.mutate({ incidentThreadId: incident.id })}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span className="truncate">{incident.userLogin}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {incident.severity ? t(`severity_${incident.severity}`) : ''} · {t(`status_${incident.status}`)}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={broadcastOpen} onOpenChange={setBroadcastOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin_broadcast_title')}</DialogTitle>
            <DialogDescription>{t('admin_broadcast_hint')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={broadcastText}
            rows={3}
            placeholder={t('admin_broadcast_placeholder')}
            onChange={event => setBroadcastText(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBroadcastOpen(false)}>
              {t('admin_broadcast_cancel')}
            </Button>
            <Button disabled={!broadcastText.trim() || broadcast.isPending} onClick={() => broadcast.mutate(broadcastText.trim())}>
              {t('admin_broadcast_send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ThreadListItem({ item, active, onSelect }: { item: SupportAdminThreadDto; active: boolean; onSelect: () => void }) {
  const { t } = useTranslation('support-chat');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn('w-full text-left px-4 py-3 border-b cursor-pointer transition-colors hover:bg-muted/50', active && 'bg-muted')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{item.userLogin}</span>
        <span className="text-xs text-muted-foreground shrink-0">{formatTime(item.updatedAt)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <Badge variant={statusBadgeVariant(item.status)}>{t(`status_${item.status}`)}</Badge>
        {item.kind === 'incident' ? (
          <Badge variant="destructive">{item.severity ? t(`severity_${item.severity}`) : t('kind_incident')}</Badge>
        ) : null}
        {item.unreadCount > 0 ? <Badge className="shrink-0 tabular-nums">{item.unreadCount}</Badge> : null}
      </div>
      <div className="mt-1 truncate text-sm text-muted-foreground">{item.lastMessagePreview ?? ''}</div>
    </button>
  );
}
