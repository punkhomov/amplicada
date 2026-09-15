import { bootstrap, configureLogger, createApp } from '@amplicada/platform-core/backend';
import { modules } from './generated/backend-modules.js';

configureLogger({
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: { colorize: true },
        level: 'debug',
      },
    ],
  },
});

async function main() {
  const { app, context } = await createApp();
  await bootstrap(app, modules, context);

  app.get('/api/health', async () => {
    return { ok: true };
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`API running on http://localhost:${port}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
