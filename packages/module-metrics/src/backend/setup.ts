import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@amplicada/platform-core/backend';
import type {
  BackendAuthService,
  BackendDbService,
  BackendModule,
  BackendRequestContextService,
  BackendSecretsService,
} from '@amplicada/platform-core/contracts/backend';
import { moduleManifest } from '../contracts/manifest.js';
import { DEFAULT_COLLECTOR_CONFIG } from './collectors/config.js';
import { createHttpObserver } from './collectors/http-observer.js';
import { MeasurementFlusher } from './collectors/measurement-flusher.js';
import { type PgPoolLike, SqlCollector } from './collectors/sql-collector.js';
import { createTaskCollector } from './collectors/task-collector.js';
import { createMetricsRoutes } from './routes.js';
import { MeasurementBuffer } from './services/measurement-buffer.js';
import { createMetricsService, type MetricsService } from './services/metrics-service.js';
import { Pseudonymizer } from './services/pseudonym.js';
import { IngestRateLimiter, type RateLimiterRedis } from './services/rate-limiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAINTENANCE_TASK_ID = 'metrics.maintenance';

let metricsService: MetricsService | undefined;
let sqlCollector: SqlCollector | undefined;
let flusher: MeasurementFlusher | undefined;
let taskCollectorDeps: { buffer: MeasurementBuffer; eventBus: import('@amplicada/platform-core/contracts/backend').EventBus } | undefined;
let unsubscribeTasks: (() => void) | undefined;

export const metricsModule: BackendModule = {
  ...moduleManifest,

  setup(context, app) {
    context.migrations.register('metrics', join(__dirname, '..', '..', 'migrations'));

    const db = context.services.resolve<BackendDbService>('db');
    const redis = context.services.resolve<RateLimiterRedis>('redis');
    const secrets = context.services.resolve<BackendSecretsService>('secrets');
    const authService = context.services.resolve<BackendAuthService>('auth-service');

    let salt = secrets.get('metrics.pseudonym_salt');
    if (!salt) {
      salt = randomBytes(32).toString('base64url');
      logger.warn('AMPLICADA_METRICS_PSEUDONYM_SALT не задан: псевдонимы не переживут рестарт процесса');
    }

    const service = createMetricsService({
      db,
      pseudonymizer: new Pseudonymizer(salt),
      limiter: new IngestRateLimiter(redis),
    });
    metricsService = service;
    context.services.register('metrics', service);

    // HTTP-метрики: наблюдатель видит все роуты (core ставит root-хуки до регистрации модулей).
    const buffer = new MeasurementBuffer();
    const collectorConfig = { ...DEFAULT_COLLECTOR_CONFIG };
    context.extensions.contribute('http:observer', createHttpObserver({ buffer }));

    if (app) {
      const pool = context.services.resolve<PgPoolLike>('pg-pool');
      const requestContext = context.services.resolve<BackendRequestContextService>('request-context');
      sqlCollector = new SqlCollector({ pool, buffer, config: collectorConfig, requestContext });
      flusher = new MeasurementFlusher({
        buffer,
        config: collectorConfig,
        sink: {
          writeMeasurements: points => service.writeMeasurements(points),
          upsertSqlFingerprints: entries => service.upsertSqlFingerprints(entries),
          insertSlowQueries: rows => service.insertSlowQueries(rows),
        },
        updateConfig: () => service.getCollectorConfig(),
        drains: {
          drainFingerprints: () => sqlCollector?.drainFingerprints() ?? [],
          drainSlowQueries: () => sqlCollector?.drainSlowQueries() ?? [],
        },
        logger,
      });
    }

    taskCollectorDeps = { buffer, eventBus: context.eventBus };

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
    // SQL-обёртка ставится после миграций и до старта трафика.
    sqlCollector?.attach();
    if (taskCollectorDeps) unsubscribeTasks = createTaskCollector(taskCollectorDeps);
    flusher?.start();
  },

  async stop() {
    unsubscribeTasks?.();
    await flusher?.stop();
  },
};
