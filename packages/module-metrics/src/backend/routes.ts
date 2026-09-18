import type { BackendAuthService } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { METRIC_EVENT_KINDS, type MetricEventKind, type MetricsSettingsPatch } from '../contracts/index.js';
import { type MetricsService, MetricsSettingsError } from './services/metrics-service.js';

export interface MetricsRoutesDeps {
  service: MetricsService;
  authService: BackendAuthService;
}

export function createMetricsRoutes(fastify: FastifyInstance, deps: MetricsRoutesDeps): void {
  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = deps.authService.getCurrentUser(request);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
  };

  // Публичный приём клиентских событий: актор опционален (анонимные страницы допустимы).
  fastify.post('/collect', async (request, reply) => {
    const user = deps.authService.getCurrentUser(request);
    const result = await deps.service.collect(request.body, user ? { userId: user.id } : undefined);
    return reply.code(202).send(result);
  });

  fastify.get('/context', async () => deps.service.getContext());

  fastify.get('/events', { preHandler: requireUser }, async request => {
    const query = request.query as { kind?: string; name?: string; limit?: string };
    const kind = query.kind && (METRIC_EVENT_KINDS as readonly string[]).includes(query.kind) ? (query.kind as MetricEventKind) : undefined;
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    return { events: await deps.service.listEvents({ kind, name: query.name?.trim() || undefined, limit }) };
  });

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
