import type { BackendAuthService, BackendDbService, BackendSetupContext, User } from '@amplicada/platform-core/contracts/backend';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { processInstances, workflowTasks } from '../schemas/index.js';

export function createWorkflowTaskRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const db = context.services.resolve<BackendDbService>('db');

  fastify.get('/tasks/my', async request => {
    const authService = context.services.resolve<BackendAuthService>('auth-service');
    const user = authService.getCurrentUser(request) as User;

    return db
      .select({
        id: workflowTasks.id,
        processInstanceId: workflowTasks.processInstanceId,
        state: workflowTasks.state,
        status: workflowTasks.status,
        createdAt: workflowTasks.createdAt,
        workflowCode: processInstances.workflowCode,
      })
      .from(workflowTasks)
      .innerJoin(processInstances, eq(workflowTasks.processInstanceId, processInstances.id))
      .where(and(eq(workflowTasks.assigneeId, user.id), eq(workflowTasks.status, 'pending')))
      .orderBy(desc(workflowTasks.createdAt));
  });
}
