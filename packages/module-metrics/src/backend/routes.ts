import { createHash } from 'node:crypto';
import type { BackendAuthService } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { METRIC_EVENT_KINDS, type MetricEventKind, type MetricsSettingsPatch } from '../contracts/index.js';
import { type MetricsService, MetricsSettingsError } from './services/metrics-service.js';

export interface MetricsRoutesDeps {
  service: MetricsService;
  authService: BackendAuthService;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function createMetricsRoutes(fastify: FastifyInstance, deps: MetricsRoutesDeps): void {
  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = deps.authService.getCurrentUser(request);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
  };

  // Публичный приём клиентских событий: актор опционален (анонимные страницы допустимы).
  fastify.post('/collect', async (request, reply) => {
    const body = request.body as { events?: unknown } | null | undefined;
    const events = body && typeof body === 'object' && Array.isArray(body.events) ? body.events : [];
    const user = deps.authService.getCurrentUser(request);

    if (events.length > 0) {
      // Ключ — псевдоним узла приёма: хеш пользователя, сессии или IP; в Redis живёт минуту.
      const first = events[0] as { sessionId?: unknown } | undefined;
      const sessionId = typeof first?.sessionId === 'string' ? first.sessionId : undefined;
      const key = user ? `u:${shortHash(user.id)}` : sessionId ? `s:${shortHash(sessionId)}` : `ip:${shortHash(request.ip)}`;
      const decision = await deps.service.checkIngestRate(key, events.length);
      if (!decision.allowed) {
        reply.header('retry-after', decision.retryAfterSeconds);
        return reply.code(429).send({ error: 'rate_limited', retryAfter: decision.retryAfterSeconds });
      }
    }

    const result = await deps.service.collect(body, user ? { userId: user.id } : undefined);
    return reply.code(202).send(result);
  });

  fastify.get('/context', async () => deps.service.getContext());

  fastify.get('/events', { preHandler: requireUser }, async request => {
    const query = request.query as { kind?: string; name?: string; limit?: string };
    const kind = query.kind && (METRIC_EVENT_KINDS as readonly string[]).includes(query.kind) ? (query.kind as MetricEventKind) : undefined;
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    return { events: await deps.service.listEvents({ kind, name: query.name?.trim() || undefined, limit }) };
  });

  fastify.get('/catalog', { preHandler: requireUser }, async () => ({ entries: await deps.service.listCatalog() }));

  fastify.get('/admin/settings', { preHandler: requireUser }, async () => deps.service.getSettings());

  fastify.patch('/admin/settings', { preHandler: requireUser }, async (request, reply) => {
    try {
      return await deps.service.updateSettings(request.body as MetricsSettingsPatch);
    } catch (error) {
      if (error instanceof MetricsSettingsError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });
}
