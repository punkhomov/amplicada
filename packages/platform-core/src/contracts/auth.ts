export interface User {
  id: string;
  login: string;
}

export interface AuthResult {
  user: User;
}

/** Дефолтный выход — путь от базы API-клиента: `/auth/logout` → `POST /api/auth/logout`. */
export const DEFAULT_LOGOUT_URL = '/auth/logout';

/**
 * Конфигурация аутентификации узла (деплоя), которую платформа публикует фронтенду.
 * Платформа не знает, где находится страница логина — она только следует за `loginUrl`.
 */
export interface AuthNodeContext {
  /** Идентификатор активного метода (`password`, `kerberos`, …) или null, если узел анонимный. */
  method: string | null;
  /** URL страницы логина метода: same-origin путь или абсолютный (внешний портал/SSO). */
  loginUrl: string | null;
  /**
   * URL выхода. Относительный путь трактуется от базы API-клиента (`/auth/logout` → POST),
   * абсолютный URL — внешний выход (full-page redirect).
   */
  logoutUrl: string;
}
