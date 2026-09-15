export const AUTH_REDIRECT_KEY = 'auth:redirect';

/**
 * Страницы аутентификации живут под `/auth/*` (например `/auth/password/login`).
 * 401 с такой страницы (неверный пароль) не должен затирать сохранённый путь возврата,
 * иначе успешный вход вернёт человека обратно на логин.
 */
function isAuthPage(): boolean {
  return window.location.pathname.startsWith('/auth/');
}

export function saveRedirectPath(): void {
  if (isAuthPage()) return;
  sessionStorage.setItem(AUTH_REDIRECT_KEY, window.location.pathname + window.location.search);
}

export function isLoginLocation(loginUrl: string): boolean {
  try {
    const target = new URL(loginUrl, window.location.origin);
    return target.origin === window.location.origin && target.pathname === window.location.pathname;
  } catch {
    return true;
  }
}

export function isExternalUrl(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Уводит неавторизованного пользователя на страницу логина его метода.
 * Навигация полная: `loginUrl` может быть внешним (kerberos-портал, SSO), а не роутом SPA.
 */
export function redirectToLogin(loginUrl: string): void {
  if (!loginUrl || isLoginLocation(loginUrl)) return;
  saveRedirectPath();
  window.location.replace(loginUrl);
}
