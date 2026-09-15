import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthNodeContext } from '../../contracts/auth.js';
import { DEFAULT_LOGOUT_URL } from '../../contracts/auth.js';
import type { BackendAuthNodeService, BackendAuthService, BackendRouteHandler } from '../../contracts/backend/index.js';

/**
 * Публикует метод аутентификации узла. Платформа (SPA) не знает, куда вести неавторизованного
 * пользователя: она спрашивает у узла и делает full-page redirect на `loginUrl`.
 */
export function createAuthContextHandler(authNode: BackendAuthNodeService): BackendRouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const method = authNode.getActiveMethod(request);
    reply.header('cache-control', 'no-store');
    const context: AuthNodeContext = {
      method: method?.id ?? null,
      loginUrl: method?.loginUrl ?? null,
      logoutUrl: method?.logoutUrl ?? DEFAULT_LOGOUT_URL,
    };
    return context;
  };
}

export function createMeHandler(authService: BackendAuthService): BackendRouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = authService.getCurrentUser(request);
    if (!user) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    return { user };
  };
}

export function createLogoutHandler(authService: BackendAuthService): BackendRouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authService.logout(request, reply);
    return { ok: true };
  };
}
