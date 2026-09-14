import { documentIndex, identityUser } from '@amplicada/platform-core/backend';
import { type DocumentActor, FILTER_MAX_PARAM_LENGTH } from '@amplicada/platform-core/contracts';
import type {
  BackendAuthService,
  BackendDbService,
  BackendDocumentRuntime,
  BackendSetupContext,
} from '@amplicada/platform-core/contracts/backend';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveExportResult, resolveListResult, resolveRegistryMeta } from '../lib/resolve-document-labels.js';

/**
 * `filters` — JSON-строка, поэтому схема может проверить только тип и длину. Ценность именно в
 * maxLength: он ограничивает стоимость JSON.parse ДО того, как сработают FILTER_MAX_NODES/DEPTH
 * (к тому моменту объект уже построен).
 *
 * additionalProperties: true — хендлеры передают request.query в runtime как есть, вырезание
 * незнакомых ключей было бы молчаливым изменением поведения. page/pageSize намеренно остаются
 * строками (runtime сам делает parseInt). Response-схемы нет: она срезала бы динамические
 * columns/items.
 */
const listQuerystring = {
  type: 'object',
  properties: {
    page: { type: 'string' },
    pageSize: { type: 'string' },
    sortBy: { type: 'string', maxLength: 200 },
    sortDir: { type: 'string', enum: ['asc', 'desc'] },
    columns: { type: 'string', maxLength: 4000 },
    filters: { type: 'string', maxLength: FILTER_MAX_PARAM_LENGTH },
    format: { type: 'string', enum: ['csv', 'json'] },
  },
  additionalProperties: true,
} as const;

function currentActor(context: BackendSetupContext, request: FastifyRequest): DocumentActor {
  const authService = context.services.resolve<BackendAuthService>('auth-service');
  // preHandler плагина (module-admin/backend/index.ts) уже гарантировал аутентификацию — здесь не может быть null.
  const user = authService.getCurrentUser(request) as { id: string };
  return { userId: user.id };
}

export function createDocumentRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const runtime = context.services.resolve<BackendDocumentRuntime>('document-runtime');
  const db = context.services.resolve<BackendDbService>('db');

  fastify.get('/documents/:type', { schema: { querystring: listQuerystring } }, async request => {
    const { type } = request.params as { type: string };
    const query = request.query as Record<string, string>;
    return resolveListResult(await runtime.list(type, query), request.t);
  });

  fastify.get('/documents/:type/:id', async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const doc = await runtime.getAnyById(id, type);
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    // pages/UI-метаданные — забота admin-роута, не generic-чтения документа. getRegistryMeta не ходит в БД.
    const rawMeta = runtime.getRegistryMeta(type);
    if (!rawMeta) return reply.code(404).send({ error: 'Not found' });
    const meta = resolveRegistryMeta(rawMeta, request.t);

    const createdByUser = alias(identityUser, 'created_by_user');
    const updatedByUser = alias(identityUser, 'updated_by_user');
    const [idx] = await db
      .select({
        createdAt: documentIndex.createdAt,
        updatedAt: documentIndex.updatedAt,
        createdByLogin: createdByUser.login,
        updatedByLogin: updatedByUser.login,
      })
      .from(documentIndex)
      .leftJoin(createdByUser, eq(createdByUser.id, documentIndex.createdByUserId))
      .leftJoin(updatedByUser, eq(updatedByUser.id, documentIndex.updatedByUserId))
      .where(eq(documentIndex.id, id))
      .limit(1);

    return {
      type: meta.type,
      pages: meta.pages,
      data: doc.data,
      createdAt: idx?.createdAt?.toISOString(),
      updatedAt: idx?.updatedAt?.toISOString() ?? idx?.createdAt?.toISOString(),
      createdBy: idx?.createdByLogin ?? 'Система',
      updatedBy: idx?.updatedByLogin ?? idx?.createdByLogin ?? 'Система',
    };
  });

  fastify.post('/documents/:type', async (request, reply) => {
    const { type } = request.params as { type: string };
    const body = request.body as Record<string, unknown>;
    const row = await runtime.create(type, body, currentActor(context, request));
    return reply.code(201).send(row);
  });

  fastify.put('/documents/:type/:id', async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const body = request.body as Record<string, unknown>;
    await runtime.update(type, id, body, currentActor(context, request));
    return reply.send({ ok: true });
  });

  fastify.delete('/documents/:type/:id', async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    await runtime.delete(type, id, currentActor(context, request));
    return reply.send({ ok: true });
  });

  fastify.delete('/documents/:type', async (request, reply) => {
    const { type } = request.params as { type: string };
    const { ids } = request.body as { ids?: unknown };
    if (!Array.isArray(ids)) return reply.code(400).send({ error: 'ids must be an array' });
    await runtime.bulkDelete(type, ids.map(String), currentActor(context, request));
    return { ok: true, deleted: ids.length };
  });

  fastify.get('/documents/:type/export', async request => {
    const { type } = request.params as { type: string };
    return resolveExportResult(await runtime.exportData(type), request.t);
  });

  fastify.get('/documents/:type/export-view', { schema: { querystring: listQuerystring } }, async (request, reply) => {
    const { type } = request.params as { type: string };
    const query = request.query as Record<string, string>;
    const format = (query.format as 'csv' | 'json') ?? 'json';
    const stream = await runtime.exportDataFiltered(type, query, format, request.t);
    if (format === 'csv') {
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${type}-export.csv"`)
        .send(stream);
    }
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${type}-export.json"`)
      .send(stream);
  });

  fastify.post('/documents/:type/import', async (request, reply) => {
    const { type } = request.params as { type: string };
    const { items } = request.body as { items?: unknown };
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items must be an array' });
    return runtime.importData(type, items as Record<string, unknown>[]);
  });
}
