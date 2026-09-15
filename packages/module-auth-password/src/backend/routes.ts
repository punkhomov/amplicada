import { requestAuthMeta } from '@amplicada/platform-core/backend';
import type { BackendAuthLogService, BackendAuthService, BackendRouteHandler } from '@amplicada/platform-core/contracts/backend';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PasswordAuthProvider } from './services/plugin.js';

interface LoginBody {
  login: string;
  password: string;
}

interface HashPasswordBody {
  password: string;
}

export function createLoginHandler(
  provider: PasswordAuthProvider,
  authService: BackendAuthService,
  authLog?: BackendAuthLogService,
): BackendRouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { login, password } = request.body as LoginBody;
    const result = await provider.validateCredentials(login, password);
    if (!result) {
      const { ipAddress, userAgent } = requestAuthMeta(request);
      const userId = await provider.findUserIdByLogin(login);
      await authLog
        ?.record({ action: 'login', success: false, userId, login, reason: 'invalid_credentials', ipAddress, userAgent })
        .catch(() => {});
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    authService.login(request, reply, result.user);
    return { user: result.user };
  };
}

export function createHashPasswordHandler(): BackendRouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { password } = request.body as HashPasswordBody;
    if (!password || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Password is required' });
    }
    const { default: bcrypt } = await import('bcrypt');
    const hash = await bcrypt.hash(password, 10);
    return { hash };
  };
}
