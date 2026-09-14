import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import session from '@fastify/session';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { createClient } from 'redis';
import {
  type BackendDbService,
  type BackendDocumentRuntime,
  type BackendModule,
  type BackendSetupContext,
  TASK_EVENTS,
  type TaskAlertEvent,
} from '../contracts/backend/index.js';
import { Documents } from '../contracts/documents.js';
import { registerCoreDocuments } from './documents/index.js';
import { DocumentRegistryImpl } from './documents.js';
import { EventBusImpl } from './event-bus.js';
import { ExtensionPointRegistryImpl } from './extension-point.js';
import { createI18n, getFixedT, type LocaleResources, resolveLanguage } from './lib/i18n.js';
import { LifecycleImpl } from './lifecycle.js';
import { coreBackendLocales } from './locales/index.js';
import { logger } from './logger.js';
import { MigrationRegistryImpl } from './migration.js';
import { BackendModuleRegistryImpl } from './module-registry.js';
import { PipelineImpl } from './pipeline.js';
import { RegistryImpl } from './registry.js';
import { isWorkerRole } from './role.js';
import { RouteRegistryImpl } from './route-registry.js';
import { ServiceRegistryImpl } from './service-registry.js';
import { AuthLogServiceImpl } from './services/auth-log-service.js';
import { AuthServiceImpl } from './services/auth-service.js';
import { DocumentRuntime } from './services/document-runtime.js';
import { ensureBucket, StorageServiceImpl } from './services/storage-service.js';
import { TaskEventBridge } from './services/task-event-bridge.js';
import { TaskReconciler } from './services/task-reconciler.js';
import { TaskRegistryImpl } from './services/task-registry.js';
import { TaskScheduler } from './services/task-scheduler.js';
import { WorkerHeartbeat } from './services/worker-heartbeat.js';
import { RedisStore } from './session/redis-store.js';
import { TaskLock } from './task-lock.js';
import { TaskRunner } from './task-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface App {
  app: FastifyInstance;
  context: BackendSetupContext;
}

export async function createApp(): Promise<App> {
  // Каст к FastifyBaseLogger — не сужение возможностей: logger реально реализует полный pino.Logger
  // (это честный Proxy, не урезанный объект), но без каста TS специализирует generic-параметр
  // FastifyInstance<..., Logger, ...> под конкретный pino.Logger, а не под дефолтный FastifyBaseLogger,
  // из-за чего App.app: FastifyInstance (с дефолтным генериком) перестаёт быть совместим.
  // NB: у Fastify предел на именованный параметр пути — 100 символов, и превышение даёт молчаливый
  // **404**, а не внятный отказ. Если понадобится класть в путь что-то длиннее (подписанный токен,
  // например), поднимать `maxParamLength` надо здесь: ни в опциях маршрута, ни в опциях `register`
  // эта настройка не работает.
  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger });

  const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379',
  });
  await redisClient.connect();
  logger.info('Redis connected');

  await app.register(cookie);
  await app.register(session, {
    store: new RedisStore({
      client: redisClient,
      ttl: 3600,
    }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production-at-least-32-chars!!',
    cookie: {
      secure: 'auto',
      httpOnly: true,
      maxAge: 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/',
    },
    saveUninitialized: false,
    rolling: true,
  });
  await app.register(cors, {
    origin: 'http://localhost:5173',
    credentials: true,
  });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

  const registry = new RegistryImpl();
  const eventBus = new EventBusImpl();
  const lifecycle = new LifecycleImpl();
  const pipeline = new PipelineImpl();
  const services = new ServiceRegistryImpl();
  const routes = new RouteRegistryImpl();
  const extensions = new ExtensionPointRegistryImpl();
  const migrations = new MigrationRegistryImpl();
  const documents = new DocumentRegistryImpl();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://amplicada:amplicada@postgres:5432/amplicada',
  });
  const db = drizzle(pool);
  services.register('db', db);

  const authLog = new AuthLogServiceImpl(db);
  services.register('auth-log', authLog);
  const authService = new AuthServiceImpl(authLog);
  services.register('auth-service', authService);

  const documentRuntime = new DocumentRuntime(db, documents);
  services.register('document-runtime', documentRuntime);
  services.register('pg-pool', pool);
  services.register('redis', redisClient);

  const s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://seaweedfs:8333',
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || 'amplicada',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'amplicada',
    },
  });
  const storageBucket = process.env.S3_BUCKET || 'amplicada';
  services.register('storage', new StorageServiceImpl(s3Client, storageBucket));
  services.register('s3-client', s3Client);

  const tasks = new TaskRegistryImpl();
  services.register('task-registry', tasks);

  const workerId = randomUUID();
  const taskLock = new TaskLock(redisClient);
  const taskRunner = new TaskRunner({ db, redis: redisClient, lock: taskLock, workerId });
  const taskScheduler = new TaskScheduler({ db, registry: tasks, runner: taskRunner, redis: redisClient });
  services.register('task-scheduler', taskScheduler);

  const taskReconciler = new TaskReconciler({ db, lock: taskLock });
  services.register('task-reconciler', taskReconciler);

  const workerHeartbeat = new WorkerHeartbeat(redisClient, workerId);
  services.register('worker-heartbeat', workerHeartbeat);

  const taskEventBridge = new TaskEventBridge({ redis: redisClient, eventBus });
  services.register('task-event-bridge', taskEventBridge);

  const context: BackendSetupContext = {
    services,
    routes,
    extensions,
    registry,
    modules: new BackendModuleRegistryImpl(),
    eventBus,
    lifecycle,
    pipeline,
    migrations,
    documents,
    tasks,
  };

  return { app, context };
}

export async function bootstrap(app: FastifyInstance, modules: BackendModule[], context: BackendSetupContext): Promise<void> {
  const db = context.services.resolve<BackendDbService>('db');
  const pool = context.services.resolve<Pool>('pg-pool');
  const redisClient = context.services.resolve<ReturnType<typeof createClient>>('redis');
  const s3Client = context.services.resolve<S3Client>('s3-client');

  registerCoreDocuments(context.documents);

  const localeResources: LocaleResources = {};
  for (const mod of modules) {
    if (mod.locales?.backend) {
      for (const [lang, strings] of Object.entries(mod.locales.backend)) {
        localeResources[lang] ??= {};
        localeResources[lang][mod.id] = strings;
      }
    }
  }
  for (const [lang, strings] of Object.entries(coreBackendLocales)) {
    localeResources[lang] ??= {};
    localeResources[lang].core = strings;
  }
  await createI18n(localeResources);
  app.addHook('onRequest', async request => {
    request.t = getFixedT(resolveLanguage(request.headers['accept-language']));
  });

  for (const mod of modules) {
    context.modules.register({ id: mod.id, name: mod.name, version: mod.version, dependencies: mod.dependencies });
    await mod.setup(context, app);
  }

  const coreMigrationsPath = join(__dirname, '..', '..', 'migrations');
  await migrate(db, {
    migrationsFolder: coreMigrationsPath,
    migrationsTable: 'core_migrations',
  });
  logger.info('Core migrations applied');

  const taskRegistry = context.services.resolve<TaskRegistryImpl>('task-registry');
  const documentRuntime = context.services.resolve<BackendDocumentRuntime>('document-runtime');

  const allMigrations = context.migrations.getAll();
  for (const { moduleId, migrationsPath } of allMigrations) {
    await migrate(db, {
      migrationsFolder: migrationsPath,
      migrationsTable: `${moduleId}_migrations`,
    });
    logger.info(`Module migrations applied: ${moduleId}`);
  }

  // Бэкфилла document_index здесь больше нет: базовые таблицы ссылаются на индекс внешним ключом,
  // поэтому строка без lookup-записи существовать не может. Разовый бэкфилл для уже накопленных
  // данных сделан миграциями (по одной на модуль — FK объявляется там же, где живёт таблица).

  await ensureBucket(s3Client, process.env.S3_BUCKET || 'amplicada');

  // Задачи из кода — fixtures типа scheduled-task (conflict по code, id авто-uuid). Persist + stale +
  // document_index через generic fixture-механизм (заменил бывший TaskRegistryImpl.reconcile).
  for (const reg of taskRegistry.getRegistrations()) {
    context.documents.fixtures.register({
      type: Documents.SCHEDULED_TASK,
      key: { column: 'code', value: reg.id },
      values: { description: reg.options.description },
    });
  }
  await documentRuntime.reconcileFixtures(db);
  logger.info('Document fixtures reconciled');

  const routes = context.routes.getAll();
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.path,
      handler: route.handler,
    });
  }

  for (const mod of modules) {
    await mod.start?.();
  }

  context.eventBus.on<TaskAlertEvent>(TASK_EVENTS.alert, event => {
    logger.error(
      { taskAlert: event.payload },
      `[task-alert] "${event.payload.taskId}" (${event.payload.taskDescription}) failed: ${event.payload.reason}`,
    );
  });

  // Мост — на каждой роли: единственный путь наполнения локального eventBus task-событиями
  // (TaskRunner сам эмитит только в Redis, см. emitTaskEvent). Запускаем до scheduler/reconciler,
  // чтобы он был готов слушать раньше, чем что-либо могло опубликовать первое событие.
  const taskEventBridge = context.services.resolve<TaskEventBridge>('task-event-bridge');
  await taskEventBridge.start();
  logger.info('Task event bridge started');

  const taskScheduler = context.services.resolve<TaskScheduler>('task-scheduler');
  const taskReconciler = context.services.resolve<TaskReconciler>('task-reconciler');
  const workerHeartbeat = context.services.resolve<WorkerHeartbeat>('worker-heartbeat');
  if (isWorkerRole()) {
    await taskScheduler.start();
    taskReconciler.start();
    workerHeartbeat.start();
    logger.info('Task scheduler, reconciler and heartbeat started');
  }

  context.lifecycle.register({
    name: 'shutdown',
    phase: 'after',
    handler: async () => {
      await taskScheduler.stop();
      taskReconciler.stop();
      workerHeartbeat.stop();
      await taskEventBridge.stop();
      await redisClient.quit();
      await pool.end();
      s3Client.destroy();
      logger.info('Redis + Database pool closed');
    },
  });

  app.addHook('onClose', async () => {
    await context.lifecycle.execute('shutdown');
  });
}
