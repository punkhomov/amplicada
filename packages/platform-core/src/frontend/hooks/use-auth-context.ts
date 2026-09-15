import { useQuery } from '@tanstack/react-query';
import type { AuthNodeContext } from '../../contracts/auth.js';
import { useApiClient } from './use-api-client.js';

/**
 * Метод аутентификации узла: куда вести неавторизованного пользователя и как выходить.
 * Конфигурация узла не меняется в рамках сессии, поэтому кэш живёт долго.
 */
export function useAuthContext(options?: { enabled?: boolean }) {
  const api = useApiClient();

  return useQuery({
    queryKey: ['auth', 'context'],
    queryFn: () => api.get<AuthNodeContext>('/auth/context'),
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true,
  });
}
