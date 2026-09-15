import { useQuery } from '@tanstack/react-query';
import type { User } from '../../contracts/auth.js';
import { useApiClient } from './use-api-client.js';

interface MeResponse {
  user: User;
}

export function useCurrentUser() {
  const api = useApiClient();

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
  });

  return { user: query.data?.user ?? null, loading: query.isLoading };
}
