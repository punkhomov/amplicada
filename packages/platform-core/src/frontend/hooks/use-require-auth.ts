import { useEffect } from 'react';
import { redirectToLogin } from '../lib/auth-redirect.js';
import { useAuthContext } from './use-auth-context.js';
import { useCurrentUser } from './use-current-user.js';

/**
 * Гейт защищённых layout'ов. Если пользователь не авторизован — спрашивает у узла его метод
 * аутентификации и делает full-page redirect на страницу логина этого метода.
 * Узел без метода (анонимный) никуда не уводит.
 */
export function useRequireAuth() {
  const { user, loading } = useCurrentUser();
  const { data: authContext } = useAuthContext({ enabled: !loading && !user });

  useEffect(() => {
    if (loading || user || !authContext?.loginUrl) return;
    redirectToLogin(authContext.loginUrl);
  }, [loading, user, authContext]);

  return { user, loading };
}
