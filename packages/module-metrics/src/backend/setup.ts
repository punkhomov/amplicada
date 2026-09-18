import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@amplicada/platform-core/backend';
import type {
  BackendAuthService,
  BackendDbService,
  BackendModule,
  BackendSecretsService,
} from '@amplicada/platform-core/contracts/backend';
import { moduleManifest } from '../contracts/manifest.js';
import { createMetricsRoutes } from './routes.js';
import { createMetricsService, type MetricsService } from './services/metrics-service.js';
import { Pseudonymizer } from './services/pseudonym.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAINTENANCE_TASK_ID = 'metrics.maintenance';
let metricsService: MetricsService | undefined;

export const metricsModule: BackendModule = {
  ...moduleManifest,

  setup(context, app) {
    context.migrations.register('metrics', join(__dirname, '..', '..', 'migrations'));

    const db = context.services.resolve<BackendDbService>('db');
    const secrets = context.services.resolve<BackendSecretsService>('secrets');
    const authService = context.services.resolve<BackendAuthService>('auth-service');

    let salt = secrets.get('metrics.pseudonym_salt');
    if (!salt) {
      salt = randomBytes(32).toString('base64url');
      logger.warn('AMPLICADA_METRICS_PSEUDONYM_SALT не задан: псевдонимы не переживут рестарт процесса');
    }

    const service = createMetricsService({ db, pseudonymizer: new Pseudonymizer(salt) });
    metricsService = service;
    context.services.register('metrics', service);

    context.tasks.register(MAINTENANCE_TASK_ID, { description: 'Метрики: партиции и retention' }, async () => {
      await service.ensurePartitions();
      const dropped = await service.prune();
      if (dropped.length > 0) logger.info({ dropped }, 'Metrics partitions pruned');
    });

    if (!app) return;

    app.register(
      async function metricsRoutes(fastify) {
        fastify.setErrorHandler((err, _request, reply) => {
          const error = err as Error & { statusCode?: number };
          const status = error.statusCode ?? 500;
          if (status >= 500) {
            // Наружу — общее сообщение: детали запроса могут содержать данные события.
            logger.error({ err: error }, 'Metrics route failed');
            return reply.code(status).send({ error: 'Internal Server Error' });
          }
          return reply.code(status).send({ error: error.message });
        });

        createMetricsRoutes(fastify, { service, authService });
      },
      { prefix: '/api/metrics' },
    );
  },

  async start() {
    await metricsService?.ensurePartitions();
  },
};
