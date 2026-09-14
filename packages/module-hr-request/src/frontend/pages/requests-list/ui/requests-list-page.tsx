import { type ApiClient, QueryError, useApiClient, useQuery } from '@amplicada/platform-core/frontend';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@amplicada/platform-core/frontend/ui/dropdown-menu';
import {
  ExtTable,
  ExtTableBody,
  ExtTableCell,
  ExtTableHead,
  ExtTableHeader,
  ExtTableRow,
} from '@amplicada/platform-core/frontend/ui/ext-table';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { HrRequestListItem, RequestTypeMeta } from '../../../../contracts/index.js';
import { RequestStatusBadge } from '../../../widgets/request-status-badge/index.js';

function RequestsTable({ rows, emptyText }: { rows: HrRequestListItem[]; emptyText: string }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-hidden rounded-md border">
      <ExtTable>
        <ExtTableHeader>
          <ExtTableRow>
            <ExtTableHead>Тип</ExtTableHead>
            <ExtTableHead>Заголовок</ExtTableHead>
            <ExtTableHead>Статус</ExtTableHead>
            <ExtTableHead>Создана</ExtTableHead>
          </ExtTableRow>
        </ExtTableHeader>
        <ExtTableBody>
          {rows.length ? (
            rows.map(row => (
              <ExtTableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/requests/${row.id}`)}>
                <ExtTableCell>{row.typeLabel}</ExtTableCell>
                <ExtTableCell className="max-w-96 truncate">{row.title}</ExtTableCell>
                <ExtTableCell>
                  <RequestStatusBadge status={row.status} />
                </ExtTableCell>
                <ExtTableCell className="text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</ExtTableCell>
              </ExtTableRow>
            ))
          ) : (
            <ExtTableRow>
              <ExtTableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                {emptyText}
              </ExtTableCell>
            </ExtTableRow>
          )}
        </ExtTableBody>
      </ExtTable>
    </div>
  );
}

export function requestsListMyQueryOptions(api: ApiClient) {
  return {
    queryKey: ['hr-requests', 'my'] as const,
    queryFn: () => api.get<HrRequestListItem[]>('/hr-requests/my'),
  };
}

export function RequestsListPage() {
  const api = useApiClient();
  const navigate = useNavigate();

  const { data: my = [], isLoading, isError, error: queryError, refetch } = useQuery(requestsListMyQueryOptions(api));
  const { data: inbox = [] } = useQuery({
    queryKey: ['hr-requests', 'inbox'],
    queryFn: () => api.get<HrRequestListItem[]>('/hr-requests/inbox'),
  });
  const { data: types = [] } = useQuery({
    queryKey: ['hr-requests', 'types'],
    queryFn: () => api.get<RequestTypeMeta[]>('/hr-requests/types'),
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Заявки</h1>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-xs outline-none hover:bg-primary/90">
            <Plus className="size-4" />
            Создать
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {types.map(type => (
              <DropdownMenuItem key={type.code} onClick={() => navigate(`/requests/new/${type.code}`)}>
                {type.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {inbox.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Ждут моего решения</h2>
          <RequestsTable rows={inbox} emptyText="" />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Мои заявки</h2>
        {isLoading ? (
          <div className="text-muted-foreground">Загрузка...</div>
        ) : isError ? (
          <QueryError error={queryError} onRetry={refetch} />
        ) : (
          <RequestsTable rows={my} emptyText="Заявок ещё нет — создайте первую" />
        )}
      </section>
    </div>
  );
}
