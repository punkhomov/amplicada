import './types/fastify.js';

export type { App } from './app.js';
export { bootstrap, createApp } from './app.js';
export { DocumentRegistryImpl } from './documents.js';
export { EventBusImpl } from './event-bus.js';
export { ExtensionPointRegistryImpl } from './extension-point.js';
export { createI18n, getFixedT, type LocaleResources, resolveLanguage } from './lib/i18n.js';
export { LifecycleImpl } from './lifecycle.js';
export type { TaskLogContext, TaskLogSink } from './logger.js';
export { configureLogger, logger, runWithTaskLogger } from './logger.js';
export { MigrationRegistryImpl } from './migration.js';
export { BackendModuleRegistryImpl } from './module-registry.js';
export { PipelineImpl } from './pipeline.js';
export { RegistryImpl } from './registry.js';
export type { ProcessRole } from './role.js';
export { getRole, isWebRole, isWorkerRole } from './role.js';
export { RouteRegistryImpl } from './route-registry.js';
export type {
  AuthLog,
  IdentityUser,
  NewAuthLog,
  NewScheduledTaskRow,
  NewScheduledTaskRunLogRow,
  ScheduledTaskRow,
  ScheduledTaskRunLogRow,
  ScheduledTaskRunRow,
} from './schemas/index.js';
export {
  authLog,
  documentCustomFields,
  documentIndex,
  identityUser,
  scheduledTaskRunLogs,
  scheduledTaskRuns,
  scheduledTasks,
} from './schemas/index.js';
export { ServiceRegistryImpl } from './service-registry.js';
export { AuthLogServiceImpl, requestAuthMeta } from './services/auth-log-service.js';
export {
  type AuthMethodResolver,
  AuthNodeServiceImpl,
  resolveAuthMethodFromEnv,
} from './services/auth-node-service.js';
export { AuthServiceImpl } from './services/auth-service.js';
export type { DbOperation, PgDriverError } from './services/db-errors.js';
export {
  findPgError,
  isPgErrorCode,
  mapDbError,
  PG_CHECK_VIOLATION,
  PG_EXCLUSION_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_NOT_NULL_VIOLATION,
  PG_UNIQUE_VIOLATION,
  withDbErrors,
} from './services/db-errors.js';
export { DocumentRuntime, DocumentRuntimeError } from './services/document-runtime.js';
export { ensureBucket, StorageServiceImpl } from './services/storage-service.js';
export type { TaskEventBridgeDeps } from './services/task-event-bridge.js';
export { TaskEventBridge } from './services/task-event-bridge.js';
export type { TaskReconcilerDeps } from './services/task-reconciler.js';
export { TaskReconciler } from './services/task-reconciler.js';
export type { TaskRegistration } from './services/task-registry.js';
export { TaskRegistryImpl } from './services/task-registry.js';
export type { TaskSchedulerDeps } from './services/task-scheduler.js';
export { CANCEL_RUN_CHANNEL, RUN_NOW_CHANNEL, TaskScheduler, validateCronSchedule } from './services/task-scheduler.js';
export { WORKER_HEARTBEAT_PREFIX, WorkerHeartbeat } from './services/worker-heartbeat.js';
export { RedisStore } from './session/redis-store.js';
export { emitTaskEvent, TASK_EVENTS_CHANNEL } from './task-events.js';
export type { TaskLockHandle } from './task-lock.js';
export { TaskLock } from './task-lock.js';
export { LOCK_GRACE_MS, type RunTaskParams, TaskRunner, type TaskRunnerDeps } from './task-runner.js';
