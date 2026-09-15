import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BackendAuthService,
  BackendDbService,
  BackendDocumentRuntime,
  BackendModule,
  TaskScheduler,
} from '@amplicada/platform-core/contracts/backend';
import { backendManifest } from '../contracts/manifest.js';
import { WORKFLOW_ENGINE_TOKEN, WORKFLOW_REGISTRY_TOKEN } from '../contracts/registry.js';
import { processInitiatorProvider } from './delegates.js';
import { registerWorkflowDocuments } from './documents/index.js';
import {
  ForbiddenActionError,
  InvalidActionError,
  ValidatorFailedError,
  WorkflowNotFoundError,
  WorkflowValidationError,
} from './errors.js';
import { workflowBackendLocales } from './locales/index.js';
import { createAdminRoutes } from './routes/admin.js';
import { createProcessRoutes } from './routes/processes.js';
import { createWorkflowTaskRoutes } from './routes/tasks.js';
import { WorkflowEngine } from './services/engine.js';
import { WorkflowRegistryImpl } from './services/registry.js';
import { WorkflowAutomationWorker } from './services/workflow-automation-worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const workflowModule: BackendModule = {
  ...backendManifest,
  locales: { backend: { ru: workflowBackendLocales.ru, en: workflowBackendLocales.en } },

  setup(context, app) {
    const migrationsPath = join(__dirname, '..', '..', 'migrations');
    context.migrations.register('workflow', migrationsPath);

    const registry = new WorkflowRegistryImpl();
    context.services.register(WORKFLOW_REGISTRY_TOKEN, registry);
    registry.registerAssigneeProvider('process-initiator', 'Инициатор заявки', processInitiatorProvider);

    registerWorkflowDocuments(context.documents);

    // Движок — сервис независимо от наличия HTTP: программные потребители (module-hr-request)
    // вызывают startProcess/executeAction in-process через resolve(WORKFLOW_ENGINE_TOKEN).
    const db = context.services.resolve<BackendDbService>('db');
    const documentRuntime = context.services.resolve<BackendDocumentRuntime>('document-runtime');
    const engine = new WorkflowEngine({ db, registry, documentRuntime });
    context.services.register(WORKFLOW_ENGINE_TOKEN, engine);

    // Периодический фолбэк над eager-диспатчем asyncTask-джоб (ретраи после сбоя, восстановление
    // после краша) — интервал не захардкожен, задаётся расписанием задачи в админке task-scheduler'а.
    const worker = new WorkflowAutomationWorker(db, engine);
    const taskScheduler = context.services.resolve<TaskScheduler>('task-registry');
    taskScheduler.register(
      'workflow-automation-worker',
      { description: 'Ретраи и восстановление джоб асинхронной автоматики workflow' },
      () => worker.run(),
    );

    if (!app) return;

    app.register(
      async function workflowRoutes(fastify) {
        fastify.addHook('preHandler', async (request, reply) => {
          const authService = context.services.resolve<BackendAuthService>('auth-service');
          const user = authService.getCurrentUser(request);
          if (!user) return reply.code(401).send({ error: 'Unauthorized' });
        });

        fastify.setErrorHandler((err, _request, reply) => {
          if (err instanceof WorkflowValidationError) {
            return reply.code(400).send({ error: err.message, errors: err.errors });
          }
          if (err instanceof InvalidActionError || err instanceof ValidatorFailedError) {
            return reply.code(400).send({ error: err.message });
          }
          if (err instanceof ForbiddenActionError) return reply.code(403).send({ error: err.message });
          if (err instanceof WorkflowNotFoundError) return reply.code(404).send({ error: err.message });
          const error = err as Error & { statusCode?: number };
          reply.code(error.statusCode ?? 500).send({ error: error.message ?? 'Internal Server Error' });
        });

        createProcessRoutes(fastify, context, engine);
        createWorkflowTaskRoutes(fastify, context);
        createAdminRoutes(fastify, context, engine, registry);
      },
      { prefix: '/api/workflows' },
    );
  },
};
