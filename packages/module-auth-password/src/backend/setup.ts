import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@amplicada/platform-core/backend';
import type {
  BackendAuthLogService,
  BackendAuthNodeService,
  BackendAuthService,
  BackendDbService,
  BackendModule,
} from '@amplicada/platform-core/contracts/backend';
import { moduleManifest } from '../contracts/manifest.js';
import { PASSWORD_LOGIN_PATH } from '../contracts/paths.js';
import { extendUserDoc } from './documents/index.js';
import { authBackendLocales } from './locales/index.js';
import { createHashPasswordHandler, createLoginHandler } from './routes.js';
import { PasswordAuthProvider } from './services/plugin.js';
import { someFunction } from './test.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const authPasswordModule: BackendModule = {
  ...moduleManifest,
  locales: { backend: { ru: authBackendLocales.ru, en: authBackendLocales.en } },

  setup(context) {
    const migrationsPath = join(__dirname, '..', '..', 'migrations');
    context.migrations.register('auth-password', migrationsPath);

    const db = context.services.resolve<BackendDbService>('db');
    const provider = new PasswordAuthProvider(db);
    context.services.register('auth-provider:password', provider);

    const authService = context.services.resolve<BackendAuthService>('auth-service');
    authService.registerProvider(provider);

    const authLog = context.services.resolve<BackendAuthLogService>('auth-log');

    const authNode = context.services.resolve<BackendAuthNodeService>('auth-node');
    authNode.registerMethod({ id: 'password', loginUrl: PASSWORD_LOGIN_PATH });

    context.routes.register('post', '/api/auth/login', createLoginHandler(provider, authService, authLog));
    context.routes.register('post', '/api/auth/hash-password', createHashPasswordHandler());

    context.tasks.register(
      'auth-password-demo',
      {
        description: 'Демо-задача планировщика: имитирует фоновую работу и пишет в лог',
      },
      async () => {
        logger.info('Начали имитацию работы...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        logger.info('Шаг 1/2 сделан');
        await new Promise(resolve => setTimeout(resolve, 2000));
        logger.info('Шаг 2/2 сделан');
        await new Promise(resolve => setTimeout(resolve, 2000));
        someFunction();
        logger.info('Готово');
      },
    );

    extendUserDoc(context.documents);
  },
};
