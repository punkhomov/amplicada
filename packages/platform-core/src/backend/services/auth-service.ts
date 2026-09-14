import type { FastifyRequest } from 'fastify';
import type { AuthResult, User } from '../../contracts/auth.js';
import type { BackendAuthLogService, BackendAuthProvider, BackendAuthService } from '../../contracts/backend/auth.js';
import { requestAuthMeta } from './auth-log-service.js';

export class AuthServiceImpl implements BackendAuthService {
  private providers: BackendAuthProvider[] = [];

  constructor(private readonly authLog?: BackendAuthLogService) {}

  registerProvider(provider: BackendAuthProvider): void {
    this.providers.push(provider);
  }

  async authenticate(request: unknown): Promise<AuthResult | null> {
    const req = request as { cookies?: Record<string, string> };
    for (const provider of this.providers) {
      const result = await provider.authenticate(req);
      if (result) return result;
    }
    return null;
  }

  login(request: unknown, _reply: unknown, user: User): void {
    const req = request as FastifyRequest;
    req.session.set('user', user);
    this.log({ action: 'login', success: true, userId: user.id, login: user.login, request });
  }

  async logout(request: unknown, _reply: unknown): Promise<void> {
    const req = request as FastifyRequest;
    const user = req.session.get('user') as User | undefined;
    await req.session.destroy();
    this.log({ action: 'logout', success: true, userId: user?.id, login: user?.login, request });
  }

  getCurrentUser(request: unknown): User | null {
    const req = request as FastifyRequest;
    return req.session.get('user') ?? null;
  }

  private log(params: { action: 'login' | 'logout'; success: boolean; userId?: string; login?: string; request: unknown }): void {
    if (!this.authLog) return;
    const { ipAddress, userAgent } = requestAuthMeta(params.request);
    this.authLog
      .record({
        action: params.action,
        success: params.success,
        userId: params.userId,
        login: params.login,
        ipAddress,
        userAgent,
      })
      .catch(() => {});
  }
}
