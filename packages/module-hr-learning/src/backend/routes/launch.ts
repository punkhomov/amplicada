import type { BackendAuthService, BackendSetupContext, User } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CourseLaunch } from '../../contracts/index.js';
import { type AttemptService, toProgress } from '../services/attempt-service.js';
import { CONTENT_PREFIX } from './runtime.js';

/**
 * Запуск курса: заводит или переиспользует попытку, выпускает ей сессию просмотра и говорит, что
 * открывать.
 */
export function createLaunchRoutes(fastify: FastifyInstance, context: BackendSetupContext, attempts: AttemptService): void {
  const currentUser = (request: FastifyRequest): User => {
    const authService = context.services.resolve<BackendAuthService>('auth-service');
    return authService.getCurrentUser(request) as User; // preHandler гарантировал аутентификацию
  };

  fastify.post('/courses/:courseId/launch', async request => {
    const { courseId } = request.params as { courseId: string };
    const user = currentUser(request);

    const { attempt, pkg, courseTitle } = await attempts.launch(courseId, user.id);

    const launch: CourseLaunch = {
      attemptId: attempt.id,
      packageId: pkg.id,
      kind: pkg.kind,
      courseTitle,
      // Относительный адрес: курс раздаётся с нашего же origin, иначе он не найдёт `window.API`
      // (см. `content-isolation.ts`). Ничего сессионного в пути нет — значит адрес одинаков от
      // захода к заходу и кэш браузера переживает перезапуск курса.
      contentUrl: `${CONTENT_PREFIX}/${pkg.id}/${pkg.entryPoint ?? ''}`,
      progress: toProgress(attempt),
    };
    return launch;
  });

  /** Прогресс попытки для шапки плеера: сам курс наружу ничего не сообщает. */
  fastify.get('/attempts/:attemptId/progress', async request => {
    const { attemptId } = request.params as { attemptId: string };
    return attempts.progress(attemptId, currentUser(request).id);
  });

  /** «Ознакомлен» для одиночного файла. Кнопку жмёт учащийся в плеере, а не курс. */
  fastify.post('/attempts/:attemptId/acknowledge', async request => {
    const { attemptId } = request.params as { attemptId: string };
    return attempts.acknowledge(attemptId, currentUser(request).id);
  });
}
