export type TaskRunStatus = 'running' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'orphaned';

export type TaskRunTrigger = 'schedule' | 'manual';

export interface ScheduledTaskOptions {
  description: string;
}

export interface TaskHandlerContext {
  signal: AbortSignal;
}

export type TaskHandler = (ctx: TaskHandlerContext) => Promise<void>;

export interface ScheduledTask {
  id: string;
  description: string;
  timeout: number;
  alertOnFailure: boolean;
  schedule: string | null;
  active: boolean;
  stale: boolean;
  updatedAt: Date | null;
}

export interface TaskScheduler {
  register(id: string, options: ScheduledTaskOptions, handler: TaskHandler): void;
}

export const TASK_EVENTS = {
  started: 'task.run.started',
  succeeded: 'task.run.succeeded',
  failed: 'task.run.failed',
  alert: 'task.alert',
  log: 'task.run.log',
} as const;

export interface TaskRunStartedEvent {
  runId: string;
  taskId: string;
  workerId: string;
  startedAt: Date;
  trigger: TaskRunTrigger;
}

export interface TaskRunSucceededEvent {
  runId: string;
  taskId: string;
  finishedAt: Date;
  durationMs: number;
}

export interface TaskRunFailedEvent {
  runId: string;
  taskId: string;
  finishedAt: Date;
  durationMs: number;
  reason: 'error' | 'timeout' | 'cancelled';
  error?: { message: string; stack?: string };
}

/** Эмитится вместо/вместе с TaskRunFailedEvent, только когда task.alertOnFailure=true и исход — реальный сбой (не cancelled). Точка интеграции для будущего канала уведомлений — сама доставка вне контракта. */
export interface TaskAlertEvent {
  runId: string;
  taskId: string;
  taskDescription: string;
  reason: 'error' | 'timeout';
  error?: { message: string; stack?: string };
}

export interface TaskRunLogEvent {
  runId: string;
  taskId: string;
  timestamp: Date;
  level: 'info' | 'error';
  message: string;
}
