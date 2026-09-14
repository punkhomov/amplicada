import { type ApiClient, QueryError, useApiClient, useQuery } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import {
  ExtTable,
  ExtTableBody,
  ExtTableCell,
  ExtTableHead,
  ExtTableHeader,
  ExtTableRow,
} from '@amplicada/platform-core/frontend/ui/ext-table';
import { useNavigate } from 'react-router-dom';
import type { PollListItem } from '../../../../contracts/index.js';

function PollsTable({ rows, emptyText }: { rows: PollListItem[]; emptyText: string }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-hidden rounded-md border">
      <ExtTable>
        <ExtTableHeader>
          <ExtTableRow>
            <ExtTableHead>Название</ExtTableHead>
            <ExtTableHead>Описание</ExtTableHead>
            <ExtTableHead>Статус</ExtTableHead>
          </ExtTableRow>
        </ExtTableHeader>
        <ExtTableBody>
          {rows.length ? (
            rows.map(row => (
              <ExtTableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/polls/${row.id}`)}>
                <ExtTableCell>{row.title}</ExtTableCell>
                <ExtTableCell className="max-w-96 truncate text-muted-foreground">{row.description}</ExtTableCell>
                <ExtTableCell>
                  <Badge variant={row.status === 'answered' ? 'secondary' : 'default'}>
                    {row.status === 'answered' ? 'Пройден' : 'Доступен'}
                  </Badge>
                </ExtTableCell>
              </ExtTableRow>
            ))
          ) : (
            <ExtTableRow>
              <ExtTableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                {emptyText}
              </ExtTableCell>
            </ExtTableRow>
          )}
        </ExtTableBody>
      </ExtTable>
    </div>
  );
}

export function pollsListQueryOptions(api: ApiClient) {
  return {
    queryKey: ['hr-polls', 'list'] as const,
    queryFn: () => api.get<PollListItem[]>('/hr-polls'),
  };
}

export function PollsListPage() {
  const api = useApiClient();
  const { data: polls = [], isLoading, isError, error: queryError, refetch } = useQuery(pollsListQueryOptions(api));

  if (isLoading) return <div className="p-8 text-muted-foreground">Загрузка...</div>;
  if (isError) return <QueryError error={queryError} onRetry={refetch} />;

  const available = polls.filter(p => p.status === 'available');
  const answered = polls.filter(p => p.status === 'answered');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6">
      <h1 className="text-2xl font-bold">Опросы</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Доступные</h2>
        <PollsTable rows={available} emptyText="Сейчас нет доступных опросов" />
      </section>

      {answered.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Пройденные</h2>
          <PollsTable rows={answered} emptyText="" />
        </section>
      )}
    </div>
  );
}
