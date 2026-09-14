import { Cron } from 'croner';
import { eq } from 'drizzle-orm';
import type { createClient } from 'redis';
import type { BackendDbService } from '../../contracts/backend/db.js';
import type { TaskRunTrigger } from '../../contracts/backend/tasks.js';
import { documentIndex, scheduledTasks } from '../schemas/index.js';
import type { TaskRunner } from '../task-runner.js';
import type { TaskRegistryImpl } from './task-registry.js';

const POLL_INTERVAL_MS = 5_000;

export const RUN_NOW_CHANNEL = 'task:run-now';
export const CANCEL_RUN_CHANNEL = 'task:cancel-run';

type RedisClient = ReturnType<typeof createClient>;

interface ScheduledJob {
  job: Cron;
  schedule: string;
}

export interface TaskSchedulerDeps {
  db: BackendDbService;
  registry: TaskRegistryImpl;
  runner: TaskRunner;
  redis: RedisClient;
}

export function validateCronSchedule(schedule: string): string | null {
  try {
    new Cron(schedule);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid cron schedule';
  }
}

export class TaskScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private pollTimer: NodeJS.Timeout | undefined;
  private subscriber: RedisClient | undefined;

  constructor(private deps: TaskSchedulerDeps) {}

  async start(): Promise<void> {
    await this.reconcileTimers();
    this.pollTimer = setInterval(() => {
      this.reconcileTimers().catch(err => console.error('[task-scheduler] reconcile failed', err));
    }, POLL_INTERVAL_MS);

    this.subscriber = this.deps.redis.duplicate();
    await this.subscriber.connect();
    await this.subscriber.subscribe(RUN_NOW_CHANNEL, taskId => {
      this.triggerNow(taskId, 'manual').catch(err => console.error(`[task-scheduler] manual run failed for "${taskId}"`, err));
    });
    await this.subscriber.subscribe(CANCEL_RUN_CHANNEL, runId => {
      this.deps.runner.cancel(runId);
    });
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const { job } of this.jobs.values()) job.stop();
    this.jobs.clear();

    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = undefined;
    }
  }

  async triggerNow(taskId: string, trigger: TaskRunTrigger): Promise<void> {
    // `stale` (код больше не объявляет задачу) переехал в document_index — отсюда джойн.
    const [row] = await this.deps.db
      .select({ task: scheduledTasks, stale: documentIndex.stale })
      .from(scheduledTasks)
      .innerJoin(documentIndex, eq(documentIndex.id, scheduledTasks.id))
      .where(eq(scheduledTasks.code, taskId))
      .limit(1);
    const task = row?.task;
    if (!task?.active || row.stale) return;

    const registration = this.deps.registry.getRegistration(taskId);
    if (!registration) return;

    await this.deps.runner.run({ task, registration, trigger });
  }

  private async reconcileTimers(): Promise<void> {
    const joined = await this.deps.db
      .select({ task: scheduledTasks, stale: documentIndex.stale })
      .from(scheduledTasks)
      .innerJoin(documentIndex, eq(documentIndex.id, scheduledTasks.id));
    const activeIds = new Set<string>();

    for (const { task: row, stale } of joined) {
      if (stale || !row.active || !row.schedule) continue;

      const registration = this.deps.registry.getRegistration(row.code);
      if (!registration) continue;

      activeIds.add(row.code);
      const existing = this.jobs.get(row.code);
      if (existing && existing.schedule === row.schedule) continue;

      existing?.job.stop();
      const job = new Cron(row.schedule, { catch: true }, () => {
        this.triggerNow(row.code, 'schedule').catch(err => console.error(`[task-scheduler] run failed for "${row.code}"`, err));
      });
      this.jobs.set(row.code, { job, schedule: row.schedule });
    }

    for (const [id, { job }] of this.jobs) {
      if (activeIds.has(id)) continue;
      job.stop();
      this.jobs.delete(id);
    }
  }
}
