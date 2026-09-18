import { QueryError, useApiClient, useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import { Spinner } from '@amplicada/platform-core/frontend/ui/spinner';
import { LifeBuoyIcon, MessagesSquareIcon, PlusIcon } from 'lucide-react';
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
      className="flex w-full cursor-pointer flex-col gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50"
    >
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

      <p className="truncate text-sm text-muted-foreground">{thread.lastMessagePreview || t('portal_no_messages')}</p>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {thread.participants.length > 0 ? `${t('portal_participants')}: ${thread.participants.join(', ')}` : t('portal_waiting')}
        </span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          <MessagesSquareIcon className="size-3.5" />
          {thread.messageCount}
        </span>
      </div>
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
        <Button onClick={() => navigate('/support/new')}>
          <PlusIcon data-icon="inline-start" />
          {t('portal_new')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6 text-muted-foreground" />
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
