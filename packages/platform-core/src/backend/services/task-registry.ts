import type { ScheduledTaskOptions, TaskHandler, TaskScheduler } from '../../contracts/backend/tasks.js';

export interface TaskRegistration {
  id: string;
  options: ScheduledTaskOptions;
  handler: TaskHandler;
}

/**
 * Реестр задач из кода. Персистентность в `scheduled_tasks` + `document_index` — через generic
 * fixture-механизм (`DocumentRuntime.reconcileFixtures`): bootstrap транслирует эти регистрации в
 * fixtures типа `scheduled-task` (conflict по `code`, id авто-uuid). Свой upsert/stale тут больше не нужен.
 */
export class TaskRegistryImpl implements TaskScheduler {
  private registrations = new Map<string, TaskRegistration>();

  register(id: string, options: ScheduledTaskOptions, handler: TaskHandler): void {
    this.registrations.set(id, { id, options, handler });
  }

  getRegistrations(): TaskRegistration[] {
    return [...this.registrations.values()];
  }

  getRegistration(id: string): TaskRegistration | undefined {
    return this.registrations.get(id);
  }
}
