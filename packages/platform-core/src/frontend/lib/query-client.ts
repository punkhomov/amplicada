import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client.js';
import { saveRedirectPath } from './auth-redirect.js';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: error => {
        if (error instanceof ApiError && error.status === 401) {
          saveRedirectPath();
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: error => {
        if (error instanceof ApiError && error.status === 401) {
          saveRedirectPath();
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
