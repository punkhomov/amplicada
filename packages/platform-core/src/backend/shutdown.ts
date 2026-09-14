import type { FastifyInstance } from 'fastify';
import type { BackendModule } from '../contracts/backend/module.js';
import type { Lifecycle } from '../contracts/lifecycle.js';

interface ShutdownStep {
  name: string;
  run(): void | Promise<void>;
}

interface ShutdownOptions {
  lifecycle: Lifecycle;
  modules: Pick<BackendModule, 'id' | 'stop'>[];
  stopBackground: ShutdownStep[];
  closeResources: ShutdownStep[];
}

/** onClose runs after HTTP requests finish; shared resources stay available to module stop hooks. */
export function registerShutdown(app: FastifyInstance, options: ShutdownOptions): void {
  app.addHook('onClose', async () => {
    const steps: ShutdownStep[] = [
      { name: 'shutdown:before', run: () => options.lifecycle.execute('shutdown') },
      ...options.stopBackground,
      ...[...options.modules].reverse().map(mod => ({ name: `module:${mod.id}`, run: () => mod.stop?.() })),
      { name: 'shutdown:after', run: () => options.lifecycle.executeAfter('shutdown') },
      ...options.closeResources,
    ];
    const errors: Error[] = [];
    for (const step of steps) {
      try {
        await step.run();
      } catch (cause) {
        const error = new Error(`Shutdown step "${step.name}" failed`, { cause });
        app.log.error({ err: error }, error.message);
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Application shutdown failed');
    app.log.info('Application shutdown completed');
  });
}
