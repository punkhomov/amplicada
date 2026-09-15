import type { AuthMethodDescriptor, BackendAuthNodeService } from '../../contracts/backend/auth.js';
import { logger } from '../logger.js';

/**
 * Резолвер активного метода узла. Точка расширения: сейчас единственная реализация читает env,
 * позже сюда встанет выбор метода по Host (один API на несколько web-хостов).
 */
export type AuthMethodResolver = (request: unknown, methods: AuthMethodDescriptor[]) => AuthMethodDescriptor | null;

/**
 * env-резолвер: `AUTH_METHOD` выбирает зарегистрированный метод; если метод не зарегистрирован
 * модулем, но задан `AUTH_LOGIN_URL` — узел описывает внешний метод (kerberos-портал, SSO и т.п.)
 * без модуля. Без `AUTH_METHOD` берётся единственный зарегистрированный метод.
 */
export function resolveAuthMethodFromEnv(_request: unknown, methods: AuthMethodDescriptor[]): AuthMethodDescriptor | null {
  const externalLoginUrl = process.env.AUTH_LOGIN_URL;
  const configured = process.env.AUTH_METHOD;

  if (configured) {
    const registered = methods.find(method => method.id === configured);
    if (registered) return registered;
    if (externalLoginUrl) {
      return { id: configured, loginUrl: externalLoginUrl, logoutUrl: process.env.AUTH_LOGOUT_URL };
    }
    logger.warn({ method: configured }, 'AUTH_METHOD не зарегистрирован ни одним модулем и AUTH_LOGIN_URL не задан');
    return null;
  }

  if (methods.length === 1) return methods[0];

  if (methods.length === 0) {
    if (externalLoginUrl) {
      return { id: 'external', loginUrl: externalLoginUrl, logoutUrl: process.env.AUTH_LOGOUT_URL };
    }
    return null;
  }

  logger.warn(
    { methods: methods.map(method => method.id) },
    'Зарегистрировано несколько методов аутентификации, но AUTH_METHOD не задан — узел анонимный',
  );
  return null;
}

export class AuthNodeServiceImpl implements BackendAuthNodeService {
  private readonly methods = new Map<string, AuthMethodDescriptor>();

  constructor(private readonly resolver: AuthMethodResolver = resolveAuthMethodFromEnv) {}

  registerMethod(method: AuthMethodDescriptor): void {
    this.methods.set(method.id, method);
  }

  getMethods(): AuthMethodDescriptor[] {
    return [...this.methods.values()];
  }

  getActiveMethod(request: unknown): AuthMethodDescriptor | null {
    return this.resolver(request, this.getMethods());
  }
}
