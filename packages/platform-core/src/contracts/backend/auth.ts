import type { AuthResult, User } from '../auth.js';

export interface BackendAuthProvider {
  id: string;
  authenticate(request: unknown): Promise<AuthResult | null>;
}

export interface BackendAuthService {
  registerProvider(provider: BackendAuthProvider): void;
  authenticate(request: unknown): Promise<AuthResult | null>;
  login(request: unknown, reply: unknown, user: User): void;
  logout(request: unknown, reply: unknown): Promise<void>;
  getCurrentUser(request: unknown): User | null;
}

/**
 * Метод аутентификации, который модуль предоставляет узлу. Узел выбирает один из
 * зарегистрированных методов (обычно через `AUTH_METHOD`), платформа редиректит
 * неавторизованного пользователя на `loginUrl` выбранного метода.
 */
export interface AuthMethodDescriptor {
  id: string;
  loginUrl: string;
  logoutUrl?: string;
}

export interface BackendAuthNodeService {
  registerMethod(method: AuthMethodDescriptor): void;
  getMethods(): AuthMethodDescriptor[];
  /** Резолвит активный метод для конкретного запроса (сейчас — env, позже — Host и т.п.). */
  getActiveMethod(request: unknown): AuthMethodDescriptor | null;
}

export interface AuthLogEntry {
  userId?: string | null;
  login?: string | null;
  action: 'login' | 'logout';
  success: boolean;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface BackendAuthLogService {
  record(entry: AuthLogEntry): Promise<void>;
}
