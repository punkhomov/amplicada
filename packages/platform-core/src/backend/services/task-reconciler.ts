import { and, eq } from 'drizzle-orm';
import type { BackendDbService } from '../../contracts/backend/db.js';
import { scheduledTaskRuns, scheduledTasks } from '../schemas/index.js';
import type { TaskLock } from '../task-lock.js';
import { LOCK_GRACE_MS } from '../task-runner.js';

const RECONCILE_INTERVAL_MS = 30_000;

export interface TaskReconcilerDeps {
  db: BackendDbService;
  lock: TaskLock;
}

export class TaskReconciler {
  private timer: NodeJS.Timeout | undefined;

  constructor(private deps: TaskReconcilerDeps) {}

  start(): void {
    this.reconcile().catch(err => console.error('[task-reconciler] reconcile failed', err));
    this.timer = setInterval(() => {
      this.reconcile().catch(err => console.error('[task-reconciler] reconcile failed', err));
    }, RECONCILE_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcile(): Promise<void> {
    const running = await this.deps.db
      .select({
        runId: scheduledTaskRuns.id,
        taskId: scheduledTaskRuns.taskId,
        startedAt: scheduledTaskRuns.startedAt,
        timeout: scheduledTasks.timeout,
      })
      .from(scheduledTaskRuns)
      .innerJoin(scheduledTasks, eq(scheduledTaskRuns.taskId, scheduledTasks.code))
      .where(eq(scheduledTaskRuns.status, 'running'));

    for (const run of running) {
      const cutoff = run.startedAt.getTime() + run.timeout + LOCK_GRACE_MS;
      if (Date.now() < cutoff) continue;

      const stillLocked = await this.deps.lock.exists(run.taskId);
      if (stillLocked) continue;

      await this.deps.db
        .update(scheduledTaskRuns)
        .set({ status: 'orphaned', finishedAt: new Date() })
        .where(and(eq(scheduledTaskRuns.id, run.runId), eq(scheduledTaskRuns.status, 'running')));
    }
  }
}
