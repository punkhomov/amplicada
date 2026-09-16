import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackendModule } from '@amplicada/platform-core/contracts/backend';
import { moduleManifest } from '../contracts/manifest.js';
import { registerPollDocuments, registerPollResponseDocuments } from './documents/index.js';
import { hrPollBackendLocales } from './locales/index.js';
import { createHrPollRoutes } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const hrPollModule: BackendModule = {
  ...moduleManifest,
  locales: { backend: { ru: hrPollBackendLocales.ru, en: hrPollBackendLocales.en } },

  setup(context, app) {
    const migrationsPath = join(__dirname, '..', '..', 'migrations');
    context.migrations.register('hr-poll', migrationsPath);

    // Опросы управляются админом через Document System (таблица hr_poll.polls), не кодом
    registerPollDocuments(context.documents);
    // Read-only просмотр ответов (кто и когда ответил) — без агрегации, см. план
    registerPollResponseDocuments(context.documents);

    if (!app) return;

    app.register(
      async function hrPollRoutes(fastify) {
        fastify.addHook('preHandler', async (request, reply) => {
          const authService = context.services.resolve<{ getCurrentUser(req: unknown): { id: string } | null }>('auth-service');
          const user = authService.getCurrentUser(request);
          if (!user) return reply.code(401).send({ error: 'Unauthorized' });
        });

        fastify.setErrorHandler((err, _request, reply) => {
          const error = err as Error & { statusCode?: number };
          reply.code(error.statusCode ?? 500).send({ error: error.message ?? 'Internal Server Error' });
        });

        createHrPollRoutes(fastify, context);
      },
      { prefix: '/api/hr-polls' },
    );
  },
};
