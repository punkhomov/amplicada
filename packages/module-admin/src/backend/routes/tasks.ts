import {
  CANCEL_RUN_CHANNEL,
  documentIndex,
  type NewScheduledTaskRow,
  RUN_NOW_CHANNEL,
  scheduledTaskRunLogs,
  scheduledTaskRuns,
  scheduledTasks,
  validateCronSchedule,
  WORKER_HEARTBEAT_PREFIX,
} from '@amplicada/platform-core/backend';
import { type BackendDbService, type BackendSetupContext, TASK_EVENTS } from '@amplicada/platform-core/contracts/backend';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

interface RedisTaskClient {
  publish(channel: string, message: string): Promise<number>;
  scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string>;
}

const RUN_HISTORY_LIMIT = 50;
const SSE_EVENT_TYPES = [TASK_EVENTS.started, TASK_EVENTS.succeeded, TASK_EVENTS.failed, TASK_EVENTS.log];
const SSE_KEEPALIVE_MS = 20_000;

export function createTaskRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const db = context.services.resolve<BackendDbService>('db');
  const redis = context.services.resolve<RedisTaskClient>('redis');

  fastify.get('/tasks', async () => {
    const rows = await db
      .select({
        id: scheduledTasks.id,
        description: scheduledTasks.description,
        timeout: scheduledTasks.timeout,
        alertOnFailure: scheduledTasks.alertOnFailure,
        schedule: scheduledTasks.schedule,
        active: scheduledTasks.active,
        // `stale` живёт в document_index (этап 2 плана 06) — колонки в scheduled_tasks больше нет.
        stale: documentIndex.stale,
        activeRunId: scheduledTaskRuns.id,
      })
      .from(scheduledTasks)
      .innerJoin(documentIndex, eq(documentIndex.id, scheduledTasks.id))
      .leftJoin(scheduledTaskRuns, and(eq(scheduledTaskRuns.taskId, scheduledTasks.code), eq(scheduledTaskRuns.status, 'running')));

    const byId = new Map<string, (typeof rows)[number]>();
    for (const row of rows) byId.set(row.id, row);
    return [...byId.values()];
  });

  fastify.get('/tasks/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const handlers = SSE_EVENT_TYPES.map(type => {
      const handler = (event: { payload: unknown }) => {
        reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      };
      context.eventBus.on(type, handler);
      return { type, handler };
    });

    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), SSE_KEEPALIVE_MS);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      for (const { type, handler } of handlers) context.eventBus.off(type, handler);
      reply.raw.end();
    });
  });

  fastify.get('/tasks/fleet-status', async () => {
    let activeWorkers = 0;
    for await (const _key of redis.scanIterator({ MATCH: `${WORKER_HEARTBEAT_PREFIX}*`, COUNT: 100 })) {
      activeWorkers++;
    }
    return { activeWorkers };
  });

  fastify.patch('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { schedule?: string | null; active?: boolean };

    if (body.schedule) {
      const error = validateCronSchedule(body.schedule);
      if (error) return reply.code(400).send({ error });
    }

    const updates: Partial<NewScheduledTaskRow> = { updatedAt: new Date() };
    if (body.schedule !== undefined) updates.schedule = body.schedule;
    if (body.active !== undefined) updates.active = body.active;

    await db.update(scheduledTasks).set(updates).where(eq(scheduledTasks.id, id));

    const [task] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).limit(1);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return task;
  });

  fastify.get('/tasks/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    // Внешний id — uuid; scheduled_task_runs.task_id — FK на code (внутренний ключ task-движка), нужен перевод.
    const [task] = await db.select({ code: scheduledTasks.code }).from(scheduledTasks).where(eq(scheduledTasks.id, id)).limit(1);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return db
      .select()
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.taskId, task.code))
      .orderBy(desc(scheduledTaskRuns.startedAt))
      .limit(RUN_HISTORY_LIMIT);
  });

  fastify.get('/tasks/:id/runs/:runId/logs', async request => {
    const { runId } = request.params as { id: string; runId: string };
    return db.select().from(scheduledTaskRunLogs).where(eq(scheduledTaskRunLogs.runId, runId)).orderBy(asc(scheduledTaskRunLogs.timestamp));
  });

  fastify.post('/tasks/:id/run', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [task] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).limit(1);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    // Канал/реестр адресуются по code (внутренний ключ task-движка) — не по внешнему uuid.
    await redis.publish(RUN_NOW_CHANNEL, task.code);
    return { ok: true };
  });

  fastify.post('/tasks/:id/runs/:runId/cancel', async request => {
    const { runId } = request.params as { id: string; runId: string };
    await redis.publish(CANCEL_RUN_CHANNEL, runId);
    return { ok: true };
  });
}
