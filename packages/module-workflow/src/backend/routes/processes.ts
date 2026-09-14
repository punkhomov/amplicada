import { identityUser } from '@amplicada/platform-core/backend';
import type { BackendAuthService, BackendDbService, BackendSetupContext, User } from '@amplicada/platform-core/contracts/backend';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserTaskNode } from '../../contracts/graph.js';
import { ForbiddenActionError } from '../errors.js';
import { workflowAuditLog, workflowAutomationJobs } from '../schemas/index.js';
import type { WorkflowEngine } from '../services/engine.js';

/** Последняя зафейленная джоба автоматики на текущей ноде — чтобы UI не молчал о зависшем процессе. */
async function loadFailedAutomation(db: BackendDbService, processInstanceId: string, nodeId: string) {
  const [job] = await db
    .select({ lastError: workflowAutomationJobs.lastError })
    .from(workflowAutomationJobs)
    .where(
      and(
        eq(workflowAutomationJobs.processInstanceId, processInstanceId),
        eq(workflowAutomationJobs.nodeId, nodeId),
        eq(workflowAutomationJobs.status, 'failed'),
      ),
    )
    .orderBy(desc(workflowAutomationJobs.createdAt))
    .limit(1);
  return job ?? null;
}

function currentUser(context: BackendSetupContext, request: FastifyRequest): User {
  const authService = context.services.resolve<BackendAuthService>('auth-service');
  // preHandler плагина уже гарантировал аутентификацию — здесь не может быть null.
  return authService.getCurrentUser(request) as User;
}

export function createProcessRoutes(fastify: FastifyInstance, context: BackendSetupContext, engine: WorkflowEngine): void {
  const db = context.services.resolve<BackendDbService>('db');

  fastify.post('/:code/start', async (request, reply) => {
    const { code } = request.params as { code: string };
    const body = (request.body ?? {}) as { payload?: Record<string, unknown> };
    const user = currentUser(context, request);
    const instance = await engine.startProcess(code, body.payload ?? {}, user.id);
    return reply.code(201).send(instance);
  });

  fastify.get('/processes/:id', async request => {
    const { id } = request.params as { id: string };
    const user = currentUser(context, request);

    const instance = await engine.loadInstance(id);
    const config = await engine.loadFrozenConfig(instance.workflowVersionId);
    // С parallel/inclusive gateway у инстанса может быть несколько одновременных pending-задач —
    // берём именно ту (если есть), что назначена текущему пользователю, а не "текущее состояние"
    // инстанса целиком (оно денормализовано и не авторитетно при активном форке, см. WorkflowEngine).
    const pendingTasks = await engine.loadPendingTasks(id);
    const myTask = pendingTasks.find(t => t.assigneeId === user.id);
    const isAssignee = !!myTask;

    const currentNode = myTask ? config.nodes.find(n => n.id === myTask.state) : config.nodes.find(n => n.id === instance.currentState);
    const availableActions =
      isAssignee && currentNode?.type === 'userTask'
        ? config.edges
            .filter(e => e.source === (currentNode as UserTaskNode).id && e.action)
            .map(e => ({ action: e.action as string, label: e.label ?? (e.action as string) }))
        : [];

    // id ноды → label, чтобы страница процесса показывала человекочитаемые этапы, а не id
    const nodeLabels = Object.fromEntries(config.nodes.map(n => [n.id, n.label]));
    const failedAutomation = currentNode?.type === 'asyncTask' ? await loadFailedAutomation(db, id, instance.currentState) : null;

    return { ...instance, taskId: myTask?.id ?? null, availableActions, isAssignee, nodeLabels, failedAutomation };
  });

  fastify.post('/processes/:id/actions/:action', async request => {
    const { id, action } = request.params as { id: string; action: string };
    const body = (request.body ?? {}) as { payload?: Record<string, unknown>; comment?: string };
    const user = currentUser(context, request);

    const pendingTasks = await engine.loadPendingTasks(id);
    const myTask = pendingTasks.find(t => t.assigneeId === user.id);
    if (!myTask) throw new ForbiddenActionError('Действие доступно только назначенному исполнителю');

    return engine.executeAction(myTask.id, action, user.id, { payloadPatch: body.payload, comment: body.comment });
  });

  fastify.get('/processes/:id/timeline', async request => {
    const { id } = request.params as { id: string };
    await engine.loadInstance(id); // 404, если процесса нет
    return (
      db
        .select({
          id: workflowAuditLog.id,
          action: workflowAuditLog.action,
          fromState: workflowAuditLog.fromState,
          toState: workflowAuditLog.toState,
          comment: workflowAuditLog.comment,
          payloadDiff: workflowAuditLog.payloadDiff,
          createdAt: workflowAuditLog.createdAt,
          actorLogin: identityUser.login,
        })
        .from(workflowAuditLog)
        // LEFT JOIN: actorId nullable под будущий actorType='system' (фаза C) — сегодня всегда 'user'
        .leftJoin(identityUser, eq(workflowAuditLog.actorId, identityUser.id))
        .where(eq(workflowAuditLog.processInstanceId, id))
        .orderBy(asc(workflowAuditLog.createdAt))
    );
  });
}
