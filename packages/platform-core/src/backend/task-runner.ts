import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { RedisClientType } from 'redis';
import type { BackendDbService } from '../contracts/backend/db.js';
import { TASK_EVENTS, type TaskRunStatus, type TaskRunTrigger } from '../contracts/backend/tasks.js';
import { runWithTaskLogger, type TaskLogSink } from './logger.js';
import { type ScheduledTaskRow, scheduledTaskRunLogs, scheduledTaskRuns } from './schemas/index.js';
import type { TaskRegistration } from './services/task-registry.js';
import { emitTaskEvent } from './task-events.js';
import type { TaskLock } from './task-lock.js';

export const LOCK_GRACE_MS = 15_000;
const LOCK_EXTEND_DIVISOR = 3;

export interface TaskRunnerDeps {
  db: BackendDbService;
  redis: RedisClientType;
  lock: TaskLock;
  workerId: string;
}

export interface RunTaskParams {
  task: ScheduledTaskRow;
  registration: TaskRegistration;
  trigger: TaskRunTrigger;
}

export class TaskRunner {
  private inFlight = new Map<string, AbortController>();
  private cancelledRuns = new Set<string>();

  constructor(private deps: TaskRunnerDeps) {}

  /** Кооперативная отмена: помечает run как cancelled и абортит signal. Не гарантирует, что handler реально остановится. */
  cancel(runId: string): boolean {
    const controller = this.inFlight.get(runId);
    if (!controller) return false;
    this.cancelledRuns.add(runId);
    controller.abort();
    return true;
  }

  async run({ task, registration, trigger }: RunTaskParams): Promise<void> {
    const runId = randomUUID();
    const token = `${this.deps.workerId}:${runId}`;
    const ttlMs = task.timeout + LOCK_GRACE_MS;

    const handle = await this.deps.lock.acquire(task.code, token, ttlMs);
    if (!handle) return;

    try {
      await this.execute({ task, registration, trigger, runId, ttlMs, handle });
    } finally {
      await this.deps.lock.release(handle);
    }
  }

  private async execute({
    task,
    registration,
    trigger,
    runId,
    ttlMs,
    handle,
  }: RunTaskParams & { runId: string; ttlMs: number; handle: Awaited<ReturnType<TaskLock['acquire']>> }): Promise<void> {
    if (!handle) return;

    const startedAt = new Date();
    await this.deps.db.insert(scheduledTaskRuns).values({
      id: runId,
      taskId: task.code,
      status: 'running',
      trigger,
      instanceId: this.deps.workerId,
      startedAt,
    });

    emitTaskEvent(this.deps.redis, TASK_EVENTS.started, {
      runId,
      taskId: task.code,
      workerId: this.deps.workerId,
      startedAt,
      trigger,
    });

    const extendTimer = setInterval(
      () => {
        this.deps.lock.extend(handle, ttlMs).catch(() => {});
      },
      Math.floor(ttlMs / LOCK_EXTEND_DIVISOR),
    );

    const controller = new AbortController();
    this.inFlight.set(runId, controller);
    const taskLogger = this.createTaskLogger(task.code, runId);
    const startedAtMs = Date.now();

    let status: TaskRunStatus;
    let reason: 'error' | 'timeout' | 'cancelled' | undefined;
    let error: { message: string; stack?: string } | undefined;

    try {
      const timedOut = Symbol('timeout');
      const handlerRun = runWithTaskLogger({ taskId: task.code, runId, taskLogger }, () =>
        registration.handler({ signal: controller.signal }),
      ).then(() => 'success' as const);
      // timeout=0 — без ограничения по времени (ручная настройка конкретного контура).
      const outcome =
        task.timeout > 0
          ? await Promise.race([handlerRun, new Promise<typeof timedOut>(resolve => setTimeout(() => resolve(timedOut), task.timeout))])
          : await handlerRun;

      if (outcome === timedOut) {
        controller.abort();
        status = 'timeout';
        reason = 'timeout';
      } else {
        status = 'success';
      }
    } catch (err) {
      status = 'failed';
      reason = 'error';
      error = { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined };
    } finally {
      clearInterval(extendTimer);
      this.inFlight.delete(runId);
    }

    if (this.cancelledRuns.delete(runId)) {
      status = 'cancelled';
      reason = 'cancelled';
    }

    const finishedAt = new Date();
    const durationMs = Date.now() - startedAtMs;

    await this.deps.db
      .update(scheduledTaskRuns)
      .set({
        status,
        finishedAt,
        durationMs,
        reason,
        error: error ? JSON.stringify(error) : null,
      })
      .where(eq(scheduledTaskRuns.id, runId));

    if (status === 'success') {
      emitTaskEvent(this.deps.redis, TASK_EVENTS.succeeded, { runId, taskId: task.code, finishedAt, durationMs });
    } else {
      emitTaskEvent(this.deps.redis, TASK_EVENTS.failed, {
        runId,
        taskId: task.code,
        finishedAt,
        durationMs,
        reason,
        error,
      });

      if (task.alertOnFailure && (reason === 'error' || reason === 'timeout')) {
        emitTaskEvent(this.deps.redis, TASK_EVENTS.alert, {
          runId,
          taskId: task.code,
          taskDescription: task.description,
          reason,
          error,
        });
      }
    }
  }

  /** Sink для лога run'а: пишет в scheduled_task_run_logs (история) и публикует task.run.log (live через SSE). Fire-and-forget — TaskLogSink не async. Не ходит через platform-логгер во избежание рекурсии (это и есть его цель — ambient-перехват в TaskRunner.runWithTaskLogger пишет именно сюда). */
  private createTaskLogger(taskId: string, runId: string): TaskLogSink {
    const write = (level: 'info' | 'error', message: string): void => {
      const timestamp = new Date();
      console[level === 'error' ? 'error' : 'log'](`[task:${taskId}:${runId}] ${message}`);
      this.deps.db
        .insert(scheduledTaskRunLogs)
        .values({ runId, timestamp, level, message })
        .catch(() => {});
      emitTaskEvent(this.deps.redis, TASK_EVENTS.log, { runId, taskId, timestamp, level, message });
    };

    return {
      info: message => write('info', message),
      error: message => write('error', message),
    };
  }
}
