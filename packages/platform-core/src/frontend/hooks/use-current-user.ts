import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from '../lib/api-client.js';
import { AUTH_REDIRECT_KEY } from '../lib/query-client.js';
import { useApiClient } from './use-api-client.js';

interface User {
  id: string;
  login: string;
}

interface MeResponse {
  user: User;
}

export function useCurrentUser(redirectTo?: string) {
  const api = useApiClient();

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
  });

  useEffect(() => {
    if (!redirectTo) return;
    if (query.isError && query.error instanceof ApiError && query.error.status === 401) {
      const current = window.location.pathname + window.location.search;
      if (current !== '/login') {
        sessionStorage.setItem(AUTH_REDIRECT_KEY, current);
      }
      window.location.href = redirectTo;
    }
  }, [redirectTo, query.isError, query.error]);

  return { user: query.data?.user ?? null, loading: query.isLoading };
}
