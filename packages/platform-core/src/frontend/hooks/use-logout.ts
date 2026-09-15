import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_LOGOUT_URL } from '../../contracts/auth.js';
import { isExternalUrl, redirectToLogin } from '../lib/auth-redirect.js';
import { useApiClient } from './use-api-client.js';
import { useAuthContext } from './use-auth-context.js';

/**
 * Выход из сессии по правилам узла: относительный `logoutUrl` — POST через API-клиент,
 * абсолютный — внешний выход (redirect). После выхода уводит на страницу логина метода.
 */
export function useLogout() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { data: authContext } = useAuthContext();

  return useMutation({
    mutationFn: async () => {
      const logoutUrl = authContext?.logoutUrl ?? DEFAULT_LOGOUT_URL;
      if (isExternalUrl(logoutUrl)) return;
      await api.post(logoutUrl);
    },
    onSuccess: () => {
      queryClient.clear();

      const logoutUrl = authContext?.logoutUrl ?? DEFAULT_LOGOUT_URL;
      if (isExternalUrl(logoutUrl)) {
        window.location.assign(logoutUrl);
        return;
      }
      if (authContext?.loginUrl) {
        redirectToLogin(authContext.loginUrl);
        return;
      }
      window.location.reload();
    },
  });
}
