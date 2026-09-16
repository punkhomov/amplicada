import type { NotificationDelivery, NotificationStatus } from '@amplicada/platform-core/contracts';
import {
  type ApiClient,
  QueryError,
  useApiClient,
  useMutation,
  useQuery,
  useQueryClient,
  useTranslation,
} from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { NativeSelect, NativeSelectOption } from '@amplicada/platform-core/frontend/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { RotateCw, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';

const PAGE_SIZE = 50;
const STATUSES: NotificationStatus[] = ['pending', 'sending', 'sent', 'failed'];

/** Даты приходят строкой: сервер отдаёт JSON, а не строку таблицы. */
type DeliveryRow = Omit<NotificationDelivery, 'nextAttemptAt' | 'createdAt' | 'sentAt'> & {
  nextAttemptAt: string;
  createdAt: string;
  sentAt: string | null;
};

interface DeliveryListResponse {
  items: DeliveryRow[];
  total: number;
}

interface AppliedFilters {
  status: NotificationStatus | 'all';
  kind: string;
  userId: string;
}

const STATUS_VARIANT: Record<NotificationStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  sending: 'outline',
  sent: 'default',
  failed: 'destructive',
};

export function adminNotificationsQueryOptions(api: ApiClient, filters: AppliedFilters, page: number) {
  return {
    queryKey: ['admin', 'notifications', filters, page] as const,
    queryFn: () =>
      api.get<DeliveryListResponse>('/admin/notifications', {
        query: {
          status: filters.status === 'all' ? undefined : filters.status,
          kind: filters.kind || undefined,
          userId: filters.userId || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
  };
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function AdminNotifications() {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<AppliedFilters>({ status: 'all', kind: '', userId: '' });
  const [kindDraft, setKindDraft] = useState('');
  const [userDraft, setUserDraft] = useState('');
  const [page, setPage] = useState(0);

  const queryOptions = adminNotificationsQueryOptions(api, filters, page);
  const { data, isLoading, isError, error: queryError, refetch } = useQuery(queryOptions);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/notifications/${id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] }),
  });

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setPage(0);
    setFilters(current => ({ ...current, kind: kindDraft.trim(), userId: userDraft.trim() }));
  };

  const changeStatus = (status: NotificationStatus | 'all') => {
    setPage(0);
    setFilters(current => ({ ...current, status }));
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-4">
        <AdminBreadcrumbs items={[{ label: t('admin_breadcrumb_root'), to: '/admin' }, { label: t('admin_breadcrumb_notifications') }]} />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-bold">{t('admin_notifications_title')}</h1>
          <span className="text-sm text-muted-foreground">{t('admin_notifications_total', { count: total })}</span>
        </div>

        <form className="flex flex-wrap items-center gap-2" onSubmit={applyFilters}>
          <NativeSelect
            value={filters.status}
            onChange={event => changeStatus(event.target.value as NotificationStatus | 'all')}
            aria-label={t('admin_notifications_filter_status')}
          >
            <NativeSelectOption value="all">{t('admin_notifications_filter_all')}</NativeSelectOption>
            {STATUSES.map(status => (
              <NativeSelectOption key={status} value={status}>
                {t(`admin_notifications_status_${status}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            className="w-48"
            placeholder={t('admin_notifications_filter_kind')}
            value={kindDraft}
            onChange={event => setKindDraft(event.target.value)}
          />
          <Input
            className="w-64"
            placeholder={t('admin_notifications_filter_user')}
            value={userDraft}
            onChange={event => setUserDraft(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm">
            <Search />
            {t('admin_notifications_filter_apply')}
          </Button>
        </form>

        {isLoading ? (
          <div className="text-muted-foreground">{t('core:loading')}</div>
        ) : isError ? (
          <QueryError error={queryError} onRetry={refetch} />
        ) : items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('admin_notifications_empty_title')}</EmptyTitle>
              <EmptyDescription>{t('admin_notifications_empty_description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin_notifications_col_created')}</TableHead>
                  <TableHead>{t('admin_notifications_col_channel')}</TableHead>
                  <TableHead>{t('admin_notifications_col_kind')}</TableHead>
                  <TableHead>{t('admin_notifications_col_recipient')}</TableHead>
                  <TableHead>{t('admin_notifications_col_status')}</TableHead>
                  <TableHead>{t('admin_notifications_col_attempts')}</TableHead>
                  <TableHead>{t('admin_notifications_col_error')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell>{row.kind}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{row.address}</span>
                        {row.userId && <span className="text-xs text-muted-foreground">{row.userId}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>{t(`admin_notifications_status_${row.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.attempts} / {row.maxAttempts}
                    </TableCell>
                    <TableCell className="max-w-80 truncate text-destructive" title={row.lastError ?? undefined}>
                      {row.lastError ?? '—'}
                    </TableCell>
                    <TableCell>
                      {row.status === 'failed' && (
                        <Button size="sm" variant="outline" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate(row.id)}>
                          <RotateCw />
                          {t('admin_notifications_retry')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(current => Math.max(current - 1, 0))}>
              {t('admin_notifications_prev')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}
            </span>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(current => current + 1)}>
              {t('admin_notifications_next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
