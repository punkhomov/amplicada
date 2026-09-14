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
