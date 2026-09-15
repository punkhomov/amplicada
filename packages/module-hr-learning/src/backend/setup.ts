import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BackendDbService,
  BackendDocumentRuntime,
  BackendModule,
  BackendStorageService,
} from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance } from 'fastify';
import { backendManifest } from '../contracts/manifest.js';
import { registerAttemptDocuments, registerCourseDocuments } from './documents/index.js';
import { hrLearningBackendLocales } from './locales/index.js';
import { createContentRoutes } from './routes/content.js';
import { createLaunchRoutes } from './routes/launch.js';
import { createPackageRoutes } from './routes/packages.js';
import { createRuntimeRoutes } from './routes/runtime.js';
import { AttemptService } from './services/attempt-service.js';
import { INGEST_TASK_ID, PackageIngestService } from './services/package-ingest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const hrLearningModule: BackendModule = {
  ...backendManifest,
  locales: { backend: { ru: hrLearningBackendLocales.ru, en: hrLearningBackendLocales.en } },

  setup(context, app) {
    const migrationsPath = join(__dirname, '..', '..', 'migrations');
    context.migrations.register('hr-learning', migrationsPath);

    // Курсы заводит админ через Document System; попытки — read-only просмотр того, что записал плеер.
    registerCourseDocuments(context.documents);
    registerAttemptDocuments(context.documents);

    const db = context.services.resolve<BackendDbService>('db');
    const ingest = new PackageIngestService(db, context.services.resolve<BackendStorageService>('storage'));

    // Расписание — фолбэк к eager-диспатчу из роута загрузки: подбирает пакеты, чей publish
    // потерялся из-за перезапуска, и возвращает в очередь зависшие в 'processing'.
    context.tasks.register(INGEST_TASK_ID, { description: 'Распаковка загруженных пакетов курсов' }, async ({ signal }) =>
      ingest.runPending(signal),
    );

    if (!app) return;

    const attempts = new AttemptService(db, context.services.resolve<BackendDocumentRuntime>('document-runtime'));

    app.register(
      async function hrLearningRoutes(fastify) {
        fastify.addHook('preHandler', async (request, reply) => {
          const authService = context.services.resolve<{ getCurrentUser(req: unknown): { id: string } | null }>('auth-service');
          // Проверки прав здесь нет, потому что модели прав нет в платформе: сейчас управлять
          // пакетами может любой аутентифицированный. Известный пробел, см. 00-overview.
          const user = authService.getCurrentUser(request);
          if (!user) return reply.code(401).send({ error: 'Unauthorized' });
        });

        useMessageErrors(fastify);

        createPackageRoutes(fastify, context, ingest);
        createLaunchRoutes(fastify, context, attempts);
        // Раздача контента и коммиты рантайма живут в том же скоупе и авторизуются той же сессией:
        // курс раздаётся с нашего origin, значит его запросы same-origin и cookie к ним
        // прикладывается сама. Отдельного скоупа с токеном в URL больше нет — он ничего не
        // ограничивал рядом с тем, что у курса и так есть сессия пользователя.
        createContentRoutes(fastify, context);
        createRuntimeRoutes(fastify, context, attempts);
      },
      { prefix: '/api/learning' },
    );
  },
};

/** Наружу уходит текст, а не стек: его читает человек — админ на карточке или учащийся в плеере. */
function useMessageErrors(fastify: FastifyInstance): void {
  fastify.setErrorHandler((err, _request, reply) => {
    const error = err as Error & { statusCode?: number };
    reply.code(error.statusCode ?? 500).send({ error: error.message ?? 'Internal Server Error' });
  });
}
