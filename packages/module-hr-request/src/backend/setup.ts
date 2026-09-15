import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ForbiddenActionError,
  InvalidActionError,
  ValidatorFailedError,
  type WorkflowEngine,
  WorkflowNotFoundError,
  WorkflowValidationError,
} from '@amplicada/module-workflow/backend';
import { WORKFLOW_ENGINE_TOKEN } from '@amplicada/module-workflow/contracts';
import type { BackendModule } from '@amplicada/platform-core/contracts/backend';
import { backendManifest } from '../contracts/manifest.js';
import { registerRequestTypeDocuments } from './documents/index.js';
import { hrRequestBackendLocales } from './locales/index.js';
import { createHrRequestRoutes } from './routes.js';
import { WorkflowConfigCache } from './status.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const hrRequestsModule: BackendModule = {
  ...backendManifest,
  locales: { backend: { ru: hrRequestBackendLocales.ru, en: hrRequestBackendLocales.en } },

  setup(context, app) {
    const migrationsPath = join(__dirname, '..', '..', 'migrations');
    context.migrations.register('hr-requests', migrationsPath);

    // Типы заявок управляются админом через Document System (таблица hr_requests.request_types), не кодом
    registerRequestTypeDocuments(context.documents);

    if (!app) return;

    // Required-зависимость (ADR-02): падает на старте, если module-workflow не подключен раньше
    const engine = context.services.resolve<WorkflowEngine>(WORKFLOW_ENGINE_TOKEN);
    const configCache = new WorkflowConfigCache(engine);

    app.register(
      async function hrRequestRoutes(fastify) {
        fastify.addHook('preHandler', async (request, reply) => {
          const authService = context.services.resolve<{ getCurrentUser(req: unknown): { id: string } | null }>('auth-service');
          const user = authService.getCurrentUser(request);
          if (!user) return reply.code(401).send({ error: 'Unauthorized' });
        });

        // Ошибки движка (submit/actions зовут его in-process) — те же коды, что в module-workflow
        fastify.setErrorHandler((err, _request, reply) => {
          if (err instanceof WorkflowValidationError) return reply.code(400).send({ error: err.message, errors: err.errors });
          if (err instanceof InvalidActionError || err instanceof ValidatorFailedError) {
            return reply.code(400).send({ error: err.message });
          }
          if (err instanceof ForbiddenActionError) return reply.code(403).send({ error: err.message });
          if (err instanceof WorkflowNotFoundError) return reply.code(404).send({ error: err.message });
          const error = err as Error & { statusCode?: number };
          reply.code(error.statusCode ?? 500).send({ error: error.message ?? 'Internal Server Error' });
        });

        createHrRequestRoutes(fastify, context, { engine, configCache });
      },
      { prefix: '/api/hr-requests' },
    );
  },
};
