import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BackendAuthService, BackendSetupContext, User } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AttemptService } from '../services/attempt-service.js';

/** Адреса, которые вшиваются в страницу курса. Абсолютные пути: курс лежит на нашем же origin. */
export const COMMIT_URL = '/api/learning/runtime/commit';
export const LIBRARY_URL = '/api/learning/runtime/scorm-again.js';
export const CONTENT_PREFIX = '/api/learning/content';

/**
 * Как часто рантайм сам сохраняется. Тридцать секунд — компромисс: чаще значит запрос на каждый
 * клик по слайду, реже — потерять при закрытии вкладки заметный кусок. Завершающий коммит от
 * `LMSFinish` приходит всё равно, но на него полагаться нельзя: вкладку закрывают и без него.
 */
export const AUTOCOMMIT_SECONDS = 30;

/**
 * Роуты рантайма: приём коммитов и отдача самой библиотеки.
 *
 * Авторизация сессионная, как у всех: курс раздаётся с нашего origin, значит его запросы —
 * same-origin, и cookie к ним прикладывается сама. В том числе у завершающего коммита, который
 * `scorm-again` отправляет через `navigator.sendBeacon` уже при закрытии вкладки: заголовков он не
 * умеет, а cookie шлёт.
 */
export function createRuntimeRoutes(fastify: FastifyInstance, context: BackendSetupContext, attempts: AttemptService): void {
  const currentUser = (request: FastifyRequest): User => {
    const authService = context.services.resolve<BackendAuthService>('auth-service');
    return authService.getCurrentUser(request) as User; // preHandler гарантировал аутентификацию
  };

  // Рантайм шлёт JSON, но с типом `text/plain`: `sendBeacon` другого не умеет, а разводить два
  // формата тела ради одного из двух путей отправки — лишняя развилка на ровном месте. Тело от
  // этого не перестаёт быть JSON, просто Fastify про такой тип по умолчанию не знает.
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  fastify.post('/runtime/commit', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const attemptId = String(body.attemptId ?? '');
    const sessionId = String(body.sessionId ?? '');

    // Чья это попытка — решает сессия, а не тело запроса: иначе учащийся закрывал бы чужие попытки,
    // просто подставив id. `sessionId` из тела, наоборот, клиентский намеренно — это lease против
    // двух вкладок, а не право доступа (см. `AttemptService.applyCommit`).
    const progress = await attempts.applyCommit(attemptId, currentUser(request).id, sessionId, extractCmi(body));

    // Формат ответа задан библиотекой: она читает `result`, а не HTTP-код.
    return reply.send({ result: 'true', progress });
  });

  /**
   * Сама библиотека. Отдаётся нашим роутом, а не из пакета курса: рантайм — часть платформы, и
   * пакет о нём знать не должен. Файл иммутабелен в пределах версии зависимости, поэтому кэш
   * длинный: он грузится в каждом заходе в курс.
   */
  fastify.get('/runtime/scorm-again.js', async (_request, reply) => {
    return reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=86400')
      .send(scormAgainBundle());
  });
}

/**
 * Тело коммита. Штатно это `{ cmi: { ... } }` — так `scorm-again` сериализует состояние при
 * `dataCommitFormat: 'json'`. Форму `{ runtimeData: { cmi } }` (настройка `renderCommonCommitFields`)
 * читаем тоже: она включается одной строкой конфигурации, и молча терять из-за этого весь прогресс
 * было бы слишком дорогой ценой за экономию трёх строк.
 */
function extractCmi(body: Record<string, unknown>): Record<string, unknown> {
  const runtimeData = body.runtimeData as Record<string, unknown> | undefined;
  const cmi = (body.cmi ?? runtimeData?.cmi) as Record<string, unknown> | undefined;
  return cmi && typeof cmi === 'object' ? cmi : {};
}

let bundle: Buffer | null = null;

/**
 * UMD-сборка `scorm-again` из node_modules, разом на 1.2 и 2004 — какой из двух API создавать,
 * решает вшитая в страницу конфигурация.
 *
 * Через `createRequire`, а не `import.meta.resolve`: у пакета есть карта экспортов, и по условию
 * `import` она отдаёт ESM-сборку, которую обычным `<script src>` не подключить. Читаем один раз —
 * это 350 КБ на процесс и ноль обращений к диску на каждый заход в курс.
 */
function scormAgainBundle(): Buffer {
  if (!bundle) bundle = readFileSync(createRequire(import.meta.url).resolve('scorm-again/min'));
  return bundle;
}
