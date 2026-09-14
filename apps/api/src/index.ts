import { adminModule } from '@amplicada/module-admin/backend';
import { authPasswordModule } from '@amplicada/module-auth-password/backend';
import { hrModule } from '@amplicada/module-hr/backend';
import { hrLearningModule } from '@amplicada/module-hr-learning/backend';
import { hrPollModule } from '@amplicada/module-hr-poll/backend';
import { hrRequestsModule } from '@amplicada/module-hr-request/backend';
import { workflowModule } from '@amplicada/module-workflow/backend';
import { bootstrap, configureLogger, createApp } from '@amplicada/platform-core/backend';

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
  await bootstrap(
    app,
    [authPasswordModule, workflowModule, hrModule, hrRequestsModule, hrPollModule, hrLearningModule, adminModule],
    context,
  );

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
