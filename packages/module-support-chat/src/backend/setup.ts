import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@amplicada/platform-core/backend';
import type { BackendDbService, BackendModule } from '@amplicada/platform-core/contracts/backend';
import { moduleManifest } from '../contracts/manifest.js';
import { createSupportChatRoutes } from './routes.js';
import { publishSupportChatEvent, SupportChatEventBridge, type SupportChatRedisClient } from './services/event-bridge.js';
import { createSupportChatService } from './services/support-chat-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let eventBridge: SupportChatEventBridge | undefined;

export const supportChatModule: BackendModule = {
  ...moduleManifest,

  setup(context, app) {
    const migrationsPath = join(__dirname, '..', '..', 'migrations');
    context.migrations.register('support-chat', migrationsPath);

    const redis = context.services.resolve<SupportChatRedisClient>('redis');
    eventBridge = new SupportChatEventBridge({ redis, eventBus: context.eventBus });

    const service = createSupportChatService({
      db: context.services.resolve<BackendDbService>('db'),
      publish: (type, payload) => {
        void publishSupportChatEvent(redis, type, payload).catch(error => {
          logger.warn({ err: error }, 'Failed to publish support chat event');
        });
      },
    });
    context.services.register('support-chat', service);

    if (!app) return;

    app.register(
      async function supportChatRoutes(fastify) {
        fastify.addHook('preHandler', async (request, reply) => {
          const authService = context.services.resolve<{ getCurrentUser(req: unknown): { id: string } | null }>('auth-service');
          const user = authService.getCurrentUser(request);
          if (!user) return reply.code(401).send({ error: 'Unauthorized' });
        });

        fastify.setErrorHandler((err, _request, reply) => {
          const error = err as Error & { statusCode?: number };
          reply.code(error.statusCode ?? 500).send({ error: error.message ?? 'Internal Server Error' });
        });

        createSupportChatRoutes(fastify, context);
      },
      { prefix: '/api/support-chat' },
    );
  },

  async start() {
    await eventBridge?.start();
  },

  async stop() {
    await eventBridge?.stop();
  },
};
