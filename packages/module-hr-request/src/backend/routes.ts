import {
  processInstances,
  type WorkflowEngine,
  workflowAuditLog,
  workflowAutomationJobs,
  workflowTasks,
} from '@amplicada/module-workflow/backend';
import type { UserTaskNode } from '@amplicada/module-workflow/contracts';
import { identityUser } from '@amplicada/platform-core/backend';
import type { BackendAuthService, BackendDbService, BackendSetupContext, User } from '@amplicada/platform-core/contracts/backend';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HrRequestListItem } from '../contracts/index.js';
import { type HrRequestRow, type HrRequestTypeRow, hrRequests } from './schemas/index.js';
import { resolveRequestStatus, type WorkflowConfigCache } from './status.js';
import { loadPortalTypes, loadTypeMap, renderTitle } from './types.js';

interface RouteDeps {
  engine: WorkflowEngine;
  configCache: WorkflowConfigCache;
}

type TypeMap = Map<string, HrRequestTypeRow>;

export function createHrRequestRoutes(fastify: FastifyInstance, context: BackendSetupContext, deps: RouteDeps): void {
  const db = context.services.resolve<BackendDbService>('db');
  const { engine, configCache } = deps;

  const currentUser = (request: FastifyRequest): User => {
    const authService = context.services.resolve<BackendAuthService>('auth-service');
    return authService.getCurrentUser(request) as User; // preHandler гарантировал аутентификацию
  };

  const toListItem = async (
    request: HrRequestRow,
    instance: typeof processInstances.$inferSelect | null,
    typeMap: TypeMap,
  ): Promise<HrRequestListItem> => ({
    id: request.id,
    type: request.type,
    typeLabel: typeMap.get(request.type)?.label ?? request.type,
    title: request.title,
    status: await resolveRequestStatus(request, instance, configCache),
    createdAt: request.createdAt.toISOString(),
    submittedAt: request.submittedAt?.toISOString() ?? null,
  });

  /** Загрузка + 404. Черновик виден только автору — чужие черновики не существуют для остальных. */
  const loadRequest = async (id: string, user: User, reply: FastifyReply): Promise<HrRequestRow | null> => {
    const [row] = await db.select().from(hrRequests).where(eq(hrRequests.id, id)).limit(1);
    if (!row || (row.status === 'draft' && row.createdBy !== user.id)) {
      reply.code(404).send({ error: 'Заявка не найдена' });
      return null;
    }
    return row;
  };

  fastify.get('/types', async () => loadPortalTypes(db));

  fastify.post('/', async (request, reply) => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as { type?: string; fields?: Record<string, unknown> };
    const typeMap = await loadTypeMap(db);
    const def = body.type ? typeMap.get(body.type) : undefined;
    if (!def?.portalEnabled) return reply.code(400).send({ error: `Неизвестный тип заявки: "${body.type}"` });

    const fields = body.fields ?? {};
    const [row] = await db
      .insert(hrRequests)
      .values({ type: def.code, title: renderTitle(def, fields), fields, createdBy: user.id })
      .returning();
    return reply.code(201).send(await toListItem(row, null, typeMap));
  });

  fastify.get('/my', async request => {
    const user = currentUser(request);
    const typeMap = await loadTypeMap(db);
    const rows = await db
      .select({ request: hrRequests, instance: processInstances })
      .from(hrRequests)
      .leftJoin(processInstances, eq(hrRequests.processInstanceId, processInstances.id))
      .where(eq(hrRequests.createdBy, user.id))
      .orderBy(desc(hrRequests.createdAt));
    return Promise.all(rows.map(({ request: req, instance }) => toListItem(req, instance, typeMap)));
  });

  fastify.get('/inbox', async request => {
    const user = currentUser(request);
    const typeMap = await loadTypeMap(db);
    const rows = await db
      .select({ request: hrRequests, instance: processInstances })
      .from(workflowTasks)
      .innerJoin(processInstances, eq(workflowTasks.processInstanceId, processInstances.id))
      .innerJoin(hrRequests, eq(hrRequests.processInstanceId, processInstances.id))
      .where(and(eq(workflowTasks.assigneeId, user.id), eq(workflowTasks.status, 'pending')))
      .orderBy(desc(workflowTasks.createdAt));
    return Promise.all(rows.map(({ request: req, instance }) => toListItem(req, instance, typeMap)));
  });

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = currentUser(request);
    const row = await loadRequest(id, user, reply);
    if (!row) return;

    const typeMap = await loadTypeMap(db);
    const base = {
      fields: row.fields,
      formFields: typeMap.get(row.type)?.formFields ?? [],
      createdBy: row.createdBy,
      canEdit: row.status === 'draft' && row.createdBy === user.id,
    };

    if (!row.processInstanceId) {
      return {
        ...(await toListItem(row, null, typeMap)),
        ...base,
        isAssignee: false,
        availableActions: [],
        editableFields: [],
        failedAutomation: null,
        nodeLabels: {},
        timeline: [],
      };
    }

    const instance = await engine.loadInstance(row.processInstanceId);
    const config = await configCache.get(instance.workflowVersionId);
    // С parallel/inclusive gateway у заявки может быть несколько одновременных pending-задач —
    // берём ту (если есть), что назначена текущему пользователю, а не денормализованный currentState
    // инстанса целиком (не авторитетен при активном форке, см. WorkflowEngine).
    const pendingTasks = await engine.loadPendingTasks(instance.id);
    const myTask = pendingTasks.find(t => t.assigneeId === user.id);
    const isAssignee = !!myTask;

    const currentNode = myTask ? config.nodes.find(n => n.id === myTask.state) : config.nodes.find(n => n.id === instance.currentState);
    const availableActions =
      isAssignee && currentNode?.type === 'userTask'
        ? config.edges
            .filter(e => e.source === (currentNode as UserTaskNode).id && e.action)
            .map(e => ({ action: e.action as string, label: e.label ?? (e.action as string) }))
        : [];
    const editableFields = isAssignee && currentNode?.type === 'userTask' ? ((currentNode as UserTaskNode).editableKeys ?? []) : [];

    // Последняя зафейленная джоба автоматики на текущей ноде — чтобы автор/согласующий не остались
    // в тишине, если процесс завис на asyncTask с исчерпанными ретраями.
    const failedAutomation =
      currentNode?.type === 'asyncTask'
        ? ((
            await db
              .select({ lastError: workflowAutomationJobs.lastError })
              .from(workflowAutomationJobs)
              .where(
                and(
                  eq(workflowAutomationJobs.processInstanceId, instance.id),
                  eq(workflowAutomationJobs.nodeId, instance.currentState),
                  eq(workflowAutomationJobs.status, 'failed'),
                ),
              )
              .orderBy(desc(workflowAutomationJobs.createdAt))
              .limit(1)
          )[0] ?? null)
        : null;

    const timeline = await db
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
      .where(eq(workflowAuditLog.processInstanceId, instance.id))
      .orderBy(asc(workflowAuditLog.createdAt));

    return {
      ...(await toListItem(row, instance, typeMap)),
      ...base,
      isAssignee,
      availableActions,
      editableFields,
      failedAutomation,
      nodeLabels: Object.fromEntries(config.nodes.map(n => [n.id, n.label])),
      timeline,
    };
  });

  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = currentUser(request);
    const row = await loadRequest(id, user, reply);
    if (!row) return;
    if (row.status !== 'draft' || row.createdBy !== user.id) {
      return reply.code(403).send({ error: 'Редактировать можно только собственный черновик' });
    }

    const body = (request.body ?? {}) as { fields?: Record<string, unknown> };
    const fields = { ...row.fields, ...(body.fields ?? {}) };
    const typeMap = await loadTypeMap(db);
    const [updated] = await db
      .update(hrRequests)
      .set({ fields, title: renderTitle(typeMap.get(row.type), fields) })
      .where(eq(hrRequests.id, id))
      .returning();
    return toListItem(updated, null, typeMap);
  });

  fastify.post('/:id/submit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = currentUser(request);
    const row = await loadRequest(id, user, reply);
    if (!row) return;
    if (row.status !== 'draft' || row.createdBy !== user.id) {
      return reply.code(403).send({ error: 'Отправить можно только собственный черновик' });
    }

    // Одна транзакция на старт процесса и апдейт заявки: упавший settle (битый делегат и т.п.)
    // не оставит ни осиротевшего process_instance, ни заявки, ссылающейся на несуществующий процесс
    const { instance, updated } = await db.transaction(async tx => {
      // Поля заявки становятся payload процесса — источником истины для маршрутизации (Gateway по cost и т.д.)
      const startedInstance = await engine.startProcess(row.type, row.fields, user.id, { db: tx });
      const [updatedRow] = await tx
        .update(hrRequests)
        .set({ status: 'submitted', processInstanceId: startedInstance.id, submittedAt: new Date() })
        .where(eq(hrRequests.id, id))
        .returning();
      return { instance: startedInstance, updated: updatedRow };
    });
    return toListItem(updated, instance, await loadTypeMap(db));
  });

  fastify.post('/:id/actions/:action', async (request, reply) => {
    const { id, action } = request.params as { id: string; action: string };
    const user = currentUser(request);
    const row = await loadRequest(id, user, reply);
    if (!row) return;
    if (!row.processInstanceId) return reply.code(400).send({ error: 'Заявка ещё не отправлена' });

    const body = (request.body ?? {}) as { comment?: string; fields?: Record<string, unknown> };
    const pendingTasks = await engine.loadPendingTasks(row.processInstanceId);
    const myTask = pendingTasks.find(t => t.assigneeId === user.id);
    if (!myTask) {
      return reply.code(403).send({ error: 'Действие доступно только назначенному исполнителю' });
    }

    const typeMap = await loadTypeMap(db);
    // Одна транзакция на переход и синхронизацию витрины (правки payload → fields заявки)
    const instance = await db.transaction(async tx => {
      const result = await engine.executeAction(myTask.id, action, user.id, {
        payloadPatch: body.fields,
        comment: body.comment,
        db: tx,
      });
      if (body.fields && Object.keys(body.fields).length) {
        const fields = { ...row.fields, ...body.fields };
        await tx
          .update(hrRequests)
          .set({ fields, title: renderTitle(typeMap.get(row.type), fields) })
          .where(eq(hrRequests.id, id));
      }
      return result;
    });
    const [updated] = await db.select().from(hrRequests).where(eq(hrRequests.id, id)).limit(1);
    return toListItem(updated, instance, typeMap);
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = currentUser(request);
    const row = await loadRequest(id, user, reply);
    if (!row) return;
    if (row.status !== 'draft' || row.createdBy !== user.id) {
      return reply.code(403).send({ error: 'Удалить можно только собственный черновик' });
    }
    await db.delete(hrRequests).where(eq(hrRequests.id, id));
    return { ok: true };
  });
}
