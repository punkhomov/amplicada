import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, eq, lt, lte, sql } from 'drizzle-orm';
import { workflowAutomationJobs } from '../schemas/index.js';
import type { WorkflowEngine } from './engine.js';

/** Дольше этого джоба не может честно исполняться (внешний вызов) — считаем, что воркер, забравший её, упал. */
const STALE_RUNNING_THRESHOLD_MS = 5 * 60 * 1000;
const CLAIM_BATCH_LIMIT = 20;

/**
 * Периодический фолбэк поверх eager-диспатча движка (см. WorkflowEngine.runAutomationJob): подбирает
 * ретраи после сбоя и восстанавливает джобы, зависшие в running из-за краша процесса между claim'ом
 * и завершением — единственный путь для второго случая (push здесь невозможен в принципе: некому
 * опубликовать событие, если сам публикатор умер).
 */
export class WorkflowAutomationWorker {
  constructor(
    private db: BackendDbService,
    private engine: WorkflowEngine,
  ) {}

  async run(): Promise<void> {
    await this.requeueStaleRunning();
    await this.dispatchDueJobs();
  }

  private async requeueStaleRunning(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS);
    const staleCondition = and(eq(workflowAutomationJobs.status, 'running'), lt(workflowAutomationJobs.updatedAt, staleBefore));

    // Есть ещё попытки — назад в pending (poison-pill защита: инкремент attempts даже за зависание,
    // иначе джоба, которая сама роняет воркер, крутилась бы вечно).
    await this.db
      .update(workflowAutomationJobs)
      .set({
        status: 'pending',
        attempts: sql`${workflowAutomationJobs.attempts} + 1`,
        nextAttemptAt: new Date(),
        lastError: 'Воркер не завершил джобу вовремя (краш/рестарт)',
        updatedAt: new Date(),
      })
      .where(and(staleCondition, sql`${workflowAutomationJobs.attempts} + 1 < ${workflowAutomationJobs.maxAttempts}`));

    // Попытки исчерпаны — сразу failed, не гоняя по кругу requeue → мгновенный повторный фейл.
    await this.db
      .update(workflowAutomationJobs)
      .set({
        status: 'failed',
        attempts: sql`${workflowAutomationJobs.attempts} + 1`,
        lastError: 'Воркер не завершил джобу вовремя (краш/рестарт), попытки исчерпаны',
        updatedAt: new Date(),
      })
      .where(and(staleCondition, sql`${workflowAutomationJobs.attempts} + 1 >= ${workflowAutomationJobs.maxAttempts}`));
  }

  /**
   * Обнаружение кандидатов — обычный SELECT, без FOR UPDATE SKIP LOCKED: реальный атомарный claim
   * происходит внутри engine.runAutomationJob (условный UPDATE по id) — гонка между несколькими
   * воркерами тут безопасна и без блокировки строк на этапе выборки (см. WorkflowEngine.runAutomationJob).
   */
  private async dispatchDueJobs(): Promise<void> {
    const due = await this.db
      .select({ id: workflowAutomationJobs.id })
      .from(workflowAutomationJobs)
      .where(and(eq(workflowAutomationJobs.status, 'pending'), lte(workflowAutomationJobs.nextAttemptAt, new Date())))
      .limit(CLAIM_BATCH_LIMIT);

    await Promise.allSettled(due.map(({ id }) => this.engine.runAutomationJob(id)));
  }
}
