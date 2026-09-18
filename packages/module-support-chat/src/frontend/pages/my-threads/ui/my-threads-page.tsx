import { QueryError, useApiClient, useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { ChevronRightIcon, LifeBuoyIcon, MessagesSquareIcon, PlusIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SupportUserThreadSummaryDto } from '../../../../contracts/index.js';
import { supportChatMyThreadsQueryOptions } from '../../../lib/query-options.js';
import { statusBadgeVariant } from '../../../lib/status.js';

function ThreadRow({ thread }: { thread: SupportUserThreadSummaryDto }) {
  const { t } = useTranslation('support-chat');
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(`/support/${thread.id}`)}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:border-foreground/15 hover:shadow-sm"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={statusBadgeVariant(thread.status)}>{t(`status_${thread.status}`)}</Badge>
            {thread.kind === 'incident' || thread.incidentThreadId ? (
              <Badge variant="destructive">
                {t('kind_incident')}
                {thread.severity ? ` · ${t(`severity_${thread.severity}`)}` : ''}
              </Badge>
            ) : null}
            {thread.unreadCount > 0 && (
              <Badge className="tabular-nums" aria-label={t('portal_unread')}>
                {thread.unreadCount}
              </Badge>
            )}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{new Date(thread.updatedAt).toLocaleString()}</span>
        </div>

        <p className="truncate text-sm text-foreground/80">{thread.lastMessagePreview || t('portal_no_messages')}</p>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="truncate">
            {thread.participants.length > 0 ? `${t('portal_participants')}: ${thread.participants.join(', ')}` : t('portal_waiting')}
          </span>
          <span className="flex shrink-0 items-center gap-1 tabular-nums">
            <MessagesSquareIcon className="size-3.5" />
            {thread.messageCount}
          </span>
        </div>
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export function MyThreadsPage() {
  const { t } = useTranslation('support-chat');
  const api = useApiClient();
  const navigate = useNavigate();
  const { data: threads = [], isLoading, isError, error, refetch } = useQuery(supportChatMyThreadsQueryOptions(api));

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t('portal_title')}</h1>
        <Button data-metrics="ui.click.support_new_request" onClick={() => navigate('/support/new')}>
          <PlusIcon data-icon="inline-start" />
          {t('portal_new')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(index => (
            <Skeleton key={index} className="h-[104px] rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <QueryError error={error} onRetry={refetch} />
      ) : threads.length === 0 ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LifeBuoyIcon />
            </EmptyMedia>
            <EmptyTitle>{t('portal_empty_title')}</EmptyTitle>
            <EmptyDescription>{t('portal_empty')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button data-metrics="ui.click.support_new_request" onClick={() => navigate('/support/new')}>
              <PlusIcon data-icon="inline-start" />
              {t('portal_new')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {threads.map(thread => (
            <ThreadRow key={thread.id} thread={thread} />
          ))}
        </div>
      )}
    </div>
  );
}
