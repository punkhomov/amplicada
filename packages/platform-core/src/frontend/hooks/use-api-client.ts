import { useFrontendContext } from '../frontend-context.js';
import { API_CLIENT_TOKEN, type ApiClient } from '../lib/api-client.js';

export function useApiClient(): ApiClient {
  const context = useFrontendContext();
  return context.services.resolve<ApiClient>(API_CLIENT_TOKEN);
}
