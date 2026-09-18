import { createHash } from 'node:crypto';
import type { BackendAuthService } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  type AlertRuleInput,
  METRIC_EVENT_KINDS,
  type MetricEventKind,
  type MetricsSettingsPatch,
  type SinkConfigPatch,
} from '../contracts/index.js';
import { type MetricsService, MetricsSettingsError, toEventDto } from './services/metrics-service.js';

export interface MetricsRoutesDeps {
  service: MetricsService;
  authService: BackendAuthService;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

interface TimeRange {
  from: Date;
  to: Date;
}

/** Шаг графика по умолчанию: мельче для короткого окна, крупнее для длинного. */
function defaultStepSeconds(rangeMs: number): number {
  if (rangeMs <= 2 * 60 * 60 * 1000) return 300;
  if (rangeMs <= 48 * 60 * 60 * 1000) return 3600;
  return 6 * 60 * 60;
}

/** Диапазон запроса: по умолчанию последние 24 часа; невалидный — 400. */
function parseRange(query: { from?: string; to?: string }): TimeRange | { error: string } {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
    return { error: 'invalid_range' };
  }
  return { from, to };
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

  fastify.get('/definitions', { preHandler: requireUser }, async () => ({ definitions: deps.service.listDefinitions() }));

  fastify.get('/definitions/summary', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; step?: string };
    const range = parseRange(query);
    if ('error' in range) return reply.code(400).send({ error: range.error });
    const rangeMs = range.to.getTime() - range.from.getTime();
    const requested = query.step ? Number.parseInt(query.step, 10) : Number.NaN;
    const stepSeconds = Number.isFinite(requested) ? Math.min(Math.max(requested, 60), 86_400) : defaultStepSeconds(rangeMs);
    return { definitions: await deps.service.definitionsSummary(range.from, range.to, stepSeconds), stepSeconds };
  });

  fastify.get('/series', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as {
      name?: string;
      eventPrefix?: string;
      groupBy?: string;
      measure?: string;
      from?: string;
      to?: string;
      step?: string;
    };
    if (!query.name && !query.eventPrefix) return reply.code(400).send({ error: 'name_or_eventPrefix_required' });
    const range = parseRange(query);
    if ('error' in range) return reply.code(400).send({ error: range.error });
    const rangeMs = range.to.getTime() - range.from.getTime();
    const requested = query.step ? Number.parseInt(query.step, 10) : Number.NaN;
    const stepSeconds = Number.isFinite(requested) ? Math.min(Math.max(requested, 60), 86_400) : defaultStepSeconds(rangeMs);
    return {
      series: await deps.service.eventSeries({
        name: query.name,
        eventPrefix: query.eventPrefix,
        groupBy: query.groupBy,
        measure: query.measure,
        from: range.from,
        to: range.to,
        stepSeconds,
      }),
      stepSeconds,
    };
  });

  const alertError = (error: unknown, reply: FastifyReply) => {
    if (error instanceof MetricsSettingsError) return reply.code(400).send({ error: error.message });
    throw error;
  };

  fastify.get('/admin/alert-rules', { preHandler: requireUser }, async () => ({
    rules: await deps.service.listAlertRules(),
  }));

  fastify.post('/admin/alert-rules', { preHandler: requireUser }, async (request, reply) => {
    try {
      return await deps.service.createAlertRule(request.body as AlertRuleInput);
    } catch (error) {
      return alertError(error, reply);
    }
  });

  fastify.patch('/admin/alert-rules/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await deps.service.updateAlertRule(id, request.body as AlertRuleInput);
    } catch (error) {
      return alertError(error, reply);
    }
  });

  fastify.delete('/admin/alert-rules/:id', { preHandler: requireUser }, async request => {
    const { id } = request.params as { id: string };
    return { deleted: await deps.service.deleteAlertRule(id) };
  });

  fastify.get('/admin/alerts', { preHandler: requireUser }, async () => ({
    instances: await deps.service.listAlertInstances(),
  }));

  fastify.get('/admin/alert-events', { preHandler: requireUser }, async request => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
    return { events: await deps.service.listAlertEvents(limit) };
  });

  fastify.post('/admin/alerts/evaluate', { preHandler: requireUser }, async () => deps.service.evaluateAlerts());

  fastify.get('/admin/health', { preHandler: requireUser }, async () => deps.service.health());

  fastify.get('/admin/sinks', { preHandler: requireUser }, async () => deps.service.listSinks());

  fastify.patch('/admin/sinks/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await deps.service.updateSink(id, request.body as SinkConfigPatch);
    } catch (error) {
      if (error instanceof MetricsSettingsError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  fastify.post('/admin/sinks/:id/test', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await deps.service.testSink(id);
    } catch (error) {
      if (error instanceof MetricsSettingsError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  fastify.get('/admin/deliveries', { preHandler: requireUser }, async request => {
    const query = request.query as { sinkId?: string; limit?: string };
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
    return { deliveries: await deps.service.listDeliveries(limit, query.sinkId) };
  });

  fastify.post('/admin/outbox/dispatch', { preHandler: requireUser }, async () => deps.service.dispatchOutbox());

  fastify.get('/export/events.csv', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; kind?: string; name?: string; limit?: string };
    const range = parseRange(query);
    if ('error' in range) return reply.code(400).send({ error: range.error });
    const kind = query.kind && (METRIC_EVENT_KINDS as readonly string[]).includes(query.kind) ? (query.kind as MetricEventKind) : undefined;
    const csv = await deps.service.exportEventsCsv({
      from: range.from,
      to: range.to,
      kind,
      name: query.name?.trim() || undefined,
      limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="metrics-events.csv"')
      .send(csv);
  });

  fastify.get('/errors', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; limit?: string };
    const range = parseRange(query);
    if ('error' in range) return reply.code(400).send({ error: range.error });
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
    const issues = await deps.service.listErrorIssues(range.from, range.to, limit);
    return {
      issues: issues.map(issue => ({
        ...issue,
        firstSeen: issue.firstSeen.toISOString(),
        lastSeen: issue.lastSeen.toISOString(),
      })),
    };
  });

  fastify.get('/errors/:fingerprint/samples', { preHandler: requireUser }, async request => {
    const { fingerprint } = request.params as { fingerprint: string };
    const query = request.query as { limit?: string };
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 20;
    const samples = await deps.service.listErrorSamples(fingerprint, limit);
    return { samples: samples.map(toEventDto) };
  });

  fastify.get('/vitals', { preHandler: requireUser }, async (request, reply) => {
    const range = parseRange(request.query as { from?: string; to?: string });
    if ('error' in range) return reply.code(400).send({ error: range.error });
    return { vitals: await deps.service.vitalsSummary(range.from, range.to) };
  });

  fastify.get('/routes', { preHandler: requireUser }, async (request, reply) => {
    const range = parseRange(request.query as { from?: string; to?: string });
    if ('error' in range) return reply.code(400).send({ error: range.error });
    return { routes: await deps.service.routesSummary(range.from, range.to) };
  });

  fastify.get('/sql', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; limit?: string };
    const range = parseRange(query);
    if ('error' in range) return reply.code(400).send({ error: range.error });
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
    return { queries: await deps.service.sqlSummary(range.from, range.to, limit) };
  });

  fastify.get('/slow-queries', { preHandler: requireUser }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; limit?: string };
    const range = parseRange(query);
    if ('error' in range) return reply.code(400).send({ error: range.error });
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
    return { samples: await deps.service.slowQueries(range.from, range.to, limit) };
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
