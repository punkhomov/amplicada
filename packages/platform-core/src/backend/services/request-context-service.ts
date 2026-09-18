import { AsyncLocalStorage } from 'node:async_hooks';
import type { BackendRequestContext, BackendRequestContextService } from '../../contracts/backend/request-context.js';

export class RequestContextService implements BackendRequestContextService {
  private readonly storage = new AsyncLocalStorage<BackendRequestContext>();

  current(): BackendRequestContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Для core: обернуть продолжение жизненного цикла запроса. Вызывается из callback-хука
   * `onRequest` как `run(context, done)` — Fastify продолжает lifecycle синхронно внутри
   * этого контекста, поэтому ALS доживает до хендлера и его асинхронной работы.
   */
  run<T>(context: BackendRequestContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }
}
