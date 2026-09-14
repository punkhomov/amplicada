import { normalizePackagePath } from '@amplicada/learning-parser';
import { identityUser } from '@amplicada/platform-core/backend';
import type {
  BackendAuthService,
  BackendDbService,
  BackendSetupContext,
  BackendStorageService,
  User,
} from '@amplicada/platform-core/contracts/backend';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isScormKind } from '../../contracts/index.js';
import { hrLearningAttempts, hrLearningPackageFiles, hrLearningPackages } from '../schemas/index.js';
import { contentSecurityPolicy } from '../services/content-isolation.js';
import { contentKey } from '../services/package-ingest.js';
import { buildLaunchCmi, injectRuntime, renderRuntimeSnippet } from '../services/runtime-bootstrap.js';
import { AUTOCOMMIT_SECONDS, COMMIT_URL, LIBRARY_URL } from './runtime.js';

/**
 * Раздача файлов пакета.
 *
 * В пути только id пакета и путь внутри него — ничего сессионного. Относительные ссылки курса
 * (`./js/main.js`, `../media/intro.mp4`) браузер резолвит относительно текущего URL, поэтому
 * префикс они тащат сами и переписывать чужой HTML не нужно; переписывание чужой разметки
 * регулярками и было бы главным источником «у нас курс не открывается».
 *
 * Авторизация — обычная сессия, как у всех остальных роутов. Отдельного токена здесь больше нет:
 * контент раздаётся с нашего origin, то есть JS курса и так может дёрнуть любой наш роут с
 * правами вошедшего, и рядом с этим токен не ограничивал ничего. Зато стоил дорого — bearer-кредитив
 * в адресной строке и в логах, и промах кэша на каждый заход, потому что URL менялся вместе с ним.
 * Когда изоляция вернётся (`plans/2026-08-11-content-isolation.md`), токен вернётся вместе с ней:
 * там cookie до курса не дойдёт.
 */
export function createContentRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const db = context.services.resolve<BackendDbService>('db');
  const storage = context.services.resolve<BackendStorageService>('storage');

  const currentUser = (request: FastifyRequest): User => {
    const authService = context.services.resolve<BackendAuthService>('auth-service');
    return authService.getCurrentUser(request) as User; // preHandler гарантировал аутентификацию
  };

  fastify.get('/content/:packageId/*', async (request, reply) => {
    const { packageId } = request.params as { packageId: string };

    const rel = requestedPath(request.params as Record<string, string>);
    if (!rel) return reply.code(404).send({ error: 'Файл не найден' });

    // Ключ в бакете собирается ТОЛЬКО после того, как путь найден строкой в инвентаре. Это и
    // закрывает traversal и чтение соседних объектов: чего нет в `package_files` — того нет вовсе.
    const [file] = await db
      .select()
      .from(hrLearningPackageFiles)
      .where(and(eq(hrLearningPackageFiles.packageId, packageId), eq(hrLearningPackageFiles.path, rel)))
      .limit(1);
    if (!file) return reply.code(404).send({ error: 'Файл не найден' });

    const [pkg] = await db.select().from(hrLearningPackages).where(eq(hrLearningPackages.id, packageId)).limit(1);
    if (!pkg) return reply.code(404).send({ error: 'Пакет не найден' });

    isolate(reply);
    reply.header('Content-Type', file.contentType);

    if (isScormKind(pkg.kind) && rel === pkg.entryPoint) {
      const user = currentUser(request);
      const attempt = await currentAttempt(db, packageId, user.id);
      if (!attempt) return reply.code(409).send({ error: 'Попытка не начата — откройте курс через плеер' });

      const entry = await storage.getObject(contentKey(packageId, rel));
      const snippet = renderRuntimeSnippet({
        kind: pkg.kind,
        attemptId: attempt.attempt.id,
        sessionId: attempt.attempt.sessionId ?? '',
        commitUrl: COMMIT_URL,
        libraryUrl: LIBRARY_URL,
        cmi: buildLaunchCmi({
          kind: pkg.kind,
          stored: attempt.attempt.cmi,
          totalTimeSeconds: attempt.attempt.totalTimeSeconds,
          userId: user.id,
          userLogin: attempt.login,
        }),
        autocommitSeconds: AUTOCOMMIT_SECONDS,
      });

      // Единственная страница пакета, которую нельзя кэшировать: в неё вшито стартовое состояние
      // попытки. Всё остальное иммутабельно — префикс содержит packageId.
      reply.header('Cache-Control', 'no-store');

      // `latin1` — не догадка о кодировке страницы, а отказ её угадывать: это единственное
      // однобайтовое отображение без потерь, поэтому байты курса возвращаются ровно теми же. Курс
      // в windows-1251, прочитанный как UTF-8 и записанный обратно, превратился бы в кракозябры,
      // а объявленной кодировке в `<meta>` верить нельзя — она врёт ровно в тех пакетах, где это
      // важно. Вставка при этом чисто ASCII (см. `renderRuntimeSnippet`), а `<head>` ищется среди
      // ASCII-символов, одинаковых во всех однобайтовых кодировках и в UTF-8.
      return reply.send(Buffer.from(injectRuntime(entry.toString('latin1'), snippet), 'latin1'));
    }

    // Теперь это работает по-настоящему: URL больше не меняется от захода к заходу, так что кэш
    // переживает и перезапуск курса, и новую сессию. Раньше в путь входил токен и всё промахивалось.
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');

    const object = await storage.getObjectStream(contentKey(packageId, rel), { range: request.headers.range });
    if (object.contentRange) {
      reply.code(206).header('Content-Range', object.contentRange);
    }
    if (object.contentLength !== undefined) reply.header('Content-Length', object.contentLength);
    return reply.send(object.body);
  });
}

/**
 * Попытка, в которую пишет этот заход: незавершённая, а если её нет — последняя начатая.
 *
 * Ищется по паре «пакет + пользователь», а не передаётся в URL, и это не экономия символов: id
 * попытки в адресе означал бы, что клиент называет, куда писать. Незавершённая попытка на курс
 * ровно одна (частичный уникальный индекс `idx_attempts_one_open`), так что выбор однозначен.
 *
 * Двумя запросами, а не сортировкой по `completion`: порядок статусов как строк — совпадение, на
 * которое нельзя опираться, а переименование значения молча перевернуло бы выбор.
 */
async function currentAttempt(db: BackendDbService, packageId: string, userId: string) {
  const mine = and(eq(hrLearningAttempts.packageId, packageId), eq(hrLearningAttempts.userId, userId));
  const select = () =>
    db
      .select({ attempt: hrLearningAttempts, login: identityUser.login })
      .from(hrLearningAttempts)
      .innerJoin(identityUser, eq(identityUser.id, hrLearningAttempts.userId));

  const [open] = await select()
    .where(and(mine, ne(hrLearningAttempts.completion, 'completed')))
    .limit(1);
  if (open) return open;

  // Пройденный курс открывают заново, а новую попытку заводит только запуск: сюда попадаем, когда
  // страницу перезагрузили внутри уже завершённого прохождения.
  const [latest] = await select().where(mine).orderBy(desc(hrLearningAttempts.startedAt)).limit(1);
  return latest ?? null;
}

/**
 * Путь запроса без id пакета. `null` — путь ведёт наружу пакета или пуст.
 *
 * Декодирование своё: `%20` в именах файлов внутри курсов встречается постоянно, а сравнивать надо
 * с инвентарём, где лежит настоящее имя.
 */
function requestedPath(params: Record<string, string>): string | null {
  const raw = params['*'] ?? '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Битая процентная последовательность — не наш файл. Пусть ищется как есть и не найдётся.
  }
  return normalizePackagePath(decoded);
}

/** Заголовки раздачи. Что именно мы изолируем, а что нет и почему — в `content-isolation.ts`. */
function isolate(reply: FastifyReply): void {
  reply.header('Content-Security-Policy', contentSecurityPolicy());
  // `.txt` внутри пакета не должен отсниффиться как HTML.
  reply.header('X-Content-Type-Options', 'nosniff');
  // Адреса файлов курса наружу не утекают по внешним ссылкам из него же.
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Accept-Ranges', 'bytes');
}
