import { DocumentRuntimeError } from '@amplicada/platform-core/backend';
import { DashboardTopics } from '@amplicada/platform-core/contracts';
import type { BackendModule } from '@amplicada/platform-core/contracts/backend';
import { moduleManifest } from '../contracts/manifest.js';
import { adminBackendLocales } from './locales/index.js';
import { createDocumentRoutes } from './routes/documents.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { createRegistryRoutes } from './routes/registry.js';
import { createStorageRoutes } from './routes/storage.js';
import { createTaskRoutes } from './routes/tasks.js';

const adminModule: BackendModule = {
  ...moduleManifest,
  locales: { backend: { ru: adminBackendLocales.ru, en: adminBackendLocales.en } },
  setup(context, app) {
    context.documents.dashboard.registerTopic(DashboardTopics.SYSTEM, { label: 'admin:dashboard_topic_system', order: 1 });
    context.documents.dashboard.registerLink('modules', {
      module: 'admin',
      topic: DashboardTopics.SYSTEM,
      label: 'admin:dashboard_link_modules',
      path: '/admin/modules',
    });
    context.documents.dashboard.registerLink('storage', {
      module: 'admin',
      topic: DashboardTopics.SYSTEM,
      label: 'admin:dashboard_link_storage',
      path: '/admin/storage',
    });
    context.documents.dashboard.registerLink('notifications', {
      module: 'admin',
      topic: DashboardTopics.SYSTEM,
      label: 'admin:dashboard_link_notifications',
      path: '/admin/notifications',
      order: 30,
    });

    if (!app) return;

    app.register(
      async function adminRoutes(fastify) {
        fastify.addHook('preHandler', async (request, reply) => {
          const authService = context.services.resolve<{ getCurrentUser(req: unknown): { id: string } | null }>('auth-service');
          const user = authService.getCurrentUser(request);
          if (!user) return reply.code(401).send({ error: 'Unauthorized' });
          // request.user is intentionally not set here.
          // Доступ к текущему пользователю — через authService.getCurrentUser(request).
          // Если понадобится прокидывать user вниз (например, для системы прав),
          // использовать Fastify канон: decorateRequest + declare module.
        });

        fastify.setErrorHandler((err, _request, reply) => {
          const error = err as Error & { statusCode?: number };
          if (error instanceof DocumentRuntimeError) {
            // details — машиночитаемые подробности (напр. FilterIssue[] от невалидного фильтра),
            // чтобы UI мог подсветить конкретное условие, а не только показать общий текст.
            return reply.code(error.status).send({ error: error.message, ...(error.details ? { details: error.details } : {}) });
          }
          const statusCode = error.statusCode ?? 500;
          reply.code(statusCode).send({ error: error.message ?? 'Internal Server Error' });
        });

        createRegistryRoutes(fastify, context);
        createDocumentRoutes(fastify, context);
        createTaskRoutes(fastify, context);
        createStorageRoutes(fastify, context);
        createNotificationRoutes(fastify, context);
      },
      { prefix: '/api/admin' },
    );
  },
};

export { adminModule as module };
