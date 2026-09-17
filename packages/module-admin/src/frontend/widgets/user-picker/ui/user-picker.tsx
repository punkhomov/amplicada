import type { FilterTree } from '@amplicada/platform-core/contracts';
import { type ApiClient, useApiClient, useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { ScrollArea } from '@amplicada/platform-core/frontend/ui/scroll-area';
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface PickedUser {
  id: string;
  login: string;
}

interface UserPickerProps {
  selected: PickedUser[];
  onChange: (users: PickedUser[]) => void;
}

interface UserListResponse {
  items: Array<Record<string, unknown>>;
}

const SEARCH_MIN = 2;
const PAGE_SIZE = 20;
const LOGIN_COLUMN = 'core:base:login';

function userSearchQueryOptions(api: ApiClient, search: string) {
  const filters: FilterTree = {
    kind: 'group',
    combinator: 'and',
    children: [{ kind: 'condition', column: LOGIN_COLUMN, operator: 'contains', value: search }],
  };
  return {
    queryKey: ['admin', 'user-picker', search] as const,
    enabled: search.length >= SEARCH_MIN,
    queryFn: () =>
      api.get<UserListResponse>('/admin/documents/user', {
        query: {
          page: 1,
          pageSize: PAGE_SIZE,
          sortBy: LOGIN_COLUMN,
          sortDir: 'asc',
          columns: LOGIN_COLUMN,
          filters: JSON.stringify(filters),
        },
      }),
  };
}

/**
 * Выбор получателей по логину: поиск через общий список документов `user` (свой endpoint не нужен),
 * выбранные живут в состоянии вызывающего. Пагинации нет — поиск по подстроке логина, лимит 20.
 */
export function UserPicker({ selected, onChange }: UserPickerProps) {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError } = useQuery(userSearchQueryOptions(api, debounced));
  const found: PickedUser[] = (data?.items ?? []).map(item => ({
    id: String(item.id),
    login: String(item[LOGIN_COLUMN] ?? ''),
  }));
  const selectedIds = new Set(selected.map(user => user.id));

  const toggle = (user: PickedUser) => {
    onChange(selectedIds.has(user.id) ? selected.filter(item => item.id !== user.id) : [...selected, user]);
  };

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(user => (
            <Badge key={user.id} variant="secondary" className="gap-1">
              {user.login || user.id}
              <button
                type="button"
                aria-label={t('template_picker_remove')}
                className="rounded-full outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange(selected.filter(item => item.id !== user.id))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          value={search}
          placeholder={t('template_send_search_placeholder')}
          onChange={event => setSearch(event.target.value)}
        />
      </div>

      <div className="h-56 overflow-hidden rounded-lg border">
        <ScrollArea className="h-full">
          {debounced.length < SEARCH_MIN ? (
            <p className="p-3 text-sm text-muted-foreground">{t('template_send_search_hint')}</p>
          ) : isLoading ? (
            <p className="p-3 text-sm text-muted-foreground">{t('core:loading')}</p>
          ) : isError ? (
            <p className="p-3 text-sm text-destructive">{t('template_send_search_error')}</p>
          ) : found.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t('template_send_no_results')}</p>
          ) : (
            <ul className="flex flex-col p-1">
              {found.map(user => (
                <li key={user.id}>
                  <label
                    htmlFor={user.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <Checkbox id={user.id} checked={selectedIds.has(user.id)} onCheckedChange={() => toggle(user)} />
                    <span className="truncate">{user.login || user.id}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
