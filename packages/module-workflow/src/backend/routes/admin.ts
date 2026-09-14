import type { BackendAuthService, BackendDbService, BackendSetupContext, User } from '@amplicada/platform-core/contracts/backend';
import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WorkflowRegistry } from '../../contracts/registry.js';
import { workflowAutomationJobs, workflowVersions } from '../schemas/index.js';
import type { WorkflowEngine } from '../services/engine.js';

export function createAdminRoutes(
  fastify: FastifyInstance,
  context: BackendSetupContext,
  engine: WorkflowEngine,
  registry: WorkflowRegistry,
): void {
  const db = context.services.resolve<BackendDbService>('db');

  fastify.get('/admin/workflows/:id/versions', async request => {
    const { id } = request.params as { id: string };
    return db.select().from(workflowVersions).where(eq(workflowVersions.workflowId, id)).orderBy(asc(workflowVersions.versionNumber));
  });

  fastify.post('/admin/workflows/:id/publish', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { config?: unknown };
    const authService = context.services.resolve<BackendAuthService>('auth-service');
    const user = authService.getCurrentUser(request) as User;

    const version = await engine.publishVersion(id, body.config, user.id);
    return reply.code(201).send(version);
  });

  fastify.get('/admin/builder/meta', async () => registry.listMeta());

  fastify.get('/admin/workflow-jobs', async request => {
    const { status } = (request.query ?? {}) as { status?: string };
    const query = db.select().from(workflowAutomationJobs).orderBy(desc(workflowAutomationJobs.createdAt));
    return status ? query.where(eq(workflowAutomationJobs.status, status)) : query;
  });

  fastify.post('/admin/workflow-jobs/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [job] = await db
      .update(workflowAutomationJobs)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), updatedAt: new Date() })
      .where(eq(workflowAutomationJobs.id, id))
      .returning();
    if (!job) return reply.code(404).send({ error: `Джоба "${id}" не найдена` });
    return job;
  });

  fastify.post('/admin/workflow-jobs/:id/override', async request => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { payloadPatch?: Record<string, unknown> };
    // Ручной escape hatch: применяет payload от админа вместо результата провайдера — на случай,
    // когда внешняя система недоступна долго и ждать очередной ретрай нет смысла.
    return engine.completeAutomationJob(id, { payloadPatch: body.payloadPatch ?? {} });
  });
}
