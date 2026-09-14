import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { normalizePackagePath } from '@amplicada/learning-parser';
import { logger, RUN_NOW_CHANNEL } from '@amplicada/platform-core/backend';
import type {
  BackendAuthService,
  BackendDbService,
  BackendSetupContext,
  BackendStorageService,
  User,
} from '@amplicada/platform-core/contracts/backend';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PackageKind, PackageSummary } from '../../contracts/index.js';
import { type HrLearningPackageRow, hrLearningCourses, hrLearningPackages } from '../schemas/index.js';
import { INGEST_TASK_ID, incomingKey, type PackageIngestService } from '../services/package-ingest.js';

/**
 * Потолок на загрузку пакета — заметно выше глобальных 100 МБ из `createApp`: курс с видео их
 * перерастает штатно. `@fastify/multipart` разрешает поднимать лимит на месте вызова, поэтому
 * менять глобальный (и ослаблять его для всех остальных роутов) не нужно.
 */
const PACKAGE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

interface MultipartFile {
  filename: string;
  mimetype: string;
  file: Readable;
}

interface MultipartRequest extends FastifyRequest {
  file(options?: { limits?: { fileSize?: number } }): Promise<MultipartFile | undefined>;
}

interface RedisPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

export function createPackageRoutes(fastify: FastifyInstance, context: BackendSetupContext, ingest: PackageIngestService): void {
  const db = context.services.resolve<BackendDbService>('db');
  const storage = context.services.resolve<BackendStorageService>('storage');

  const currentUser = (request: FastifyRequest): User => {
    const authService = context.services.resolve<BackendAuthService>('auth-service');
    return authService.getCurrentUser(request) as User; // preHandler гарантировал аутентификацию
  };

  fastify.post('/courses/:courseId/packages', async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const { kind } = request.query as { kind?: string };

    const [course] = await db
      .select({ id: hrLearningCourses.id })
      .from(hrLearningCourses)
      .where(eq(hrLearningCourses.id, courseId))
      .limit(1);
    if (!course) return reply.code(404).send({ error: 'Курс не найден' });

    const upload = await (request as MultipartRequest).file({ limits: { fileSize: PACKAGE_MAX_BYTES } });
    if (!upload) return reply.code(400).send({ error: 'Файл не передан' });

    const filename = normalizePackagePath(upload.filename ?? '');
    if (!filename) return reply.code(400).send({ error: 'Недопустимое имя файла' });

    const packageKind = resolveKind(kind, filename);
    const [previous] = await db
      .select({ version: hrLearningPackages.version })
      .from(hrLearningPackages)
      .where(eq(hrLearningPackages.courseId, courseId))
      .orderBy(desc(hrLearningPackages.version))
      .limit(1);

    // id генерируем сами, а не полагаемся на дефолт: ключ объекта строится из него, и без этого
    // пришлось бы либо писать заглушку в sourceKey, либо заливать в бакет вслепую.
    const packageId = randomUUID();
    const sourceKey = incomingKey(packageId, filename);

    // Строку заводим до заливки: при обрыве останется `pending`, который воркер честно провалит
    // с «исходный архив не найден», а не осиротевший объект в бакете, на который ничто не ссылается.
    const [created] = await db
      .insert(hrLearningPackages)
      .values({
        id: packageId,
        courseId,
        version: (previous?.version ?? 0) + 1,
        kind: packageKind,
        status: 'pending',
        sourceKey,
        uploadedBy: currentUser(request).id,
      })
      .returning({ id: hrLearningPackages.id, version: hrLearningPackages.version });

    try {
      // Без contentLength: длину multipart-части заранее не знает никто, а вычитывать её в память
      // ради подсчёта означало бы держать весь пакет в RAM.
      await storage.putObjectStream(sourceKey, upload.file, { contentType: upload.mimetype });
    } catch (error) {
      await db.delete(hrLearningPackages).where(eq(hrLearningPackages.id, created.id));
      throw error;
    }

    await wakeWorker(context);

    // 202, а не 201: файл принят, но пакетом он станет только после распаковки. Клиент опрашивает
    // GET /packages/:id и показывает статус.
    return reply.code(202).send({ packageId: created.id, version: created.version, kind: packageKind, status: 'pending' });
  });

  /**
   * История версий курса, свежая сверху. Отдаётся целиком без пагинации: версий у курса единицы —
   * это перезаливы, а не поток данных, и админу нужен весь список сразу, чтобы выбрать текущую.
   */
  fastify.get('/courses/:courseId/packages', async request => {
    const { courseId } = request.params as { courseId: string };
    const rows = await db
      .select()
      .from(hrLearningPackages)
      .where(eq(hrLearningPackages.courseId, courseId))
      .orderBy(desc(hrLearningPackages.version));

    return { packages: rows.map(toSummary) };
  });

  fastify.get('/packages/:packageId', async (request, reply) => {
    const { packageId } = request.params as { packageId: string };
    const [row] = await db.select().from(hrLearningPackages).where(eq(hrLearningPackages.id, packageId)).limit(1);
    if (!row) return reply.code(404).send({ error: 'Пакет не найден' });

    return toSummary(row);
  });

  /** Переключение версии: явное действие админа. Автоматически подменять контент под учащимися нельзя. */
  fastify.post('/packages/:packageId/current', async (request, reply) => {
    const { packageId } = request.params as { packageId: string };
    const [row] = await db.select().from(hrLearningPackages).where(eq(hrLearningPackages.id, packageId)).limit(1);
    if (!row) return reply.code(404).send({ error: 'Пакет не найден' });
    if (row.status !== 'ready') return reply.code(409).send({ error: 'Текущим можно сделать только готовый пакет' });

    // Снимаем флаг со старого в той же транзакции: партиальный уникальный индекс не позволит
    // существовать двум текущим даже на мгновение.
    await db.transaction(async tx => {
      await tx
        .update(hrLearningPackages)
        .set({ isCurrent: false })
        .where(
          and(eq(hrLearningPackages.courseId, row.courseId), eq(hrLearningPackages.isCurrent, true), ne(hrLearningPackages.id, row.id)),
        );
      await tx.update(hrLearningPackages).set({ isCurrent: true }).where(eq(hrLearningPackages.id, row.id));
    });

    return { id: row.id, isCurrent: true };
  });

  fastify.delete('/packages/:packageId', async (request, reply) => {
    const { packageId } = request.params as { packageId: string };
    const [row] = await db.select().from(hrLearningPackages).where(eq(hrLearningPackages.id, packageId)).limit(1);
    if (!row) return reply.code(404).send({ error: 'Пакет не найден' });

    try {
      // Инвентарь уходит каскадом, попытки — нет: на них FK без каскада, и это намеренно.
      await db.delete(hrLearningPackages).where(eq(hrLearningPackages.id, packageId));
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        return reply.code(409).send({ error: 'По этому пакету есть попытки прохождения — удалить его нельзя' });
      }
      throw error;
    }

    await ingest.cleanupStorage(row);
    return reply.code(204).send();
  });
}

/**
 * Строка пакета наружу. Явным перечислением, а не `row` целиком: в таблице лежит `sourceKey` —
 * ключ объекта в бакете, — а раздавать внутреннюю раскладку хранилища клиенту незачем.
 */
function toSummary(row: HrLearningPackageRow): PackageSummary {
  return {
    id: row.id,
    courseId: row.courseId,
    version: row.version,
    kind: row.kind,
    status: row.status,
    error: row.error,
    notes: row.notes,
    isCurrent: row.isCurrent,
    entryPoint: row.entryPoint,
    title: row.title,
    scormVersion: row.scormVersion,
    totalFiles: row.totalFiles,
    totalSize: row.totalSize,
    // Приводим здесь, а не полагаемся на сериализатор: `PackageSummary` — это форма **после** JSON,
    // и молчаливое расхождение типа с тем, что реально уедет по проводу, ловить потом дорого.
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `.zip` — курс, всё прочее — одиночный файл. Явный `?kind=` перебивает догадку.
 *
 * Для архива это именно догадка: версию SCORM знает только манифест внутри, а распаковка ещё не
 * начиналась. Настоящее значение проставит `PackageIngestService` — до статуса `ready` полю верить
 * нельзя, и `scorm12` здесь означает лишь «архив, разбираться будем потом».
 */
function resolveKind(requested: string | undefined, filename: string): PackageKind {
  if (requested === 'file' || requested === 'scorm12' || requested === 'scorm2004') return requested;
  return filename.toLowerCase().endsWith('.zip') ? 'scorm12' : 'file';
}

/**
 * Будим воркер сразу, не дожидаясь расписания. Если Redis недоступен — не беда: пакет останется
 * в `pending` и его подберёт задача по расписанию. Ронять из-за этого загрузку нельзя.
 */
async function wakeWorker(context: BackendSetupContext): Promise<void> {
  try {
    const redis = context.services.resolve<RedisPublisher>('redis');
    await redis.publish(RUN_NOW_CHANNEL, INGEST_TASK_ID);
  } catch (error) {
    logger.warn({ err: error }, 'Не удалось разбудить воркер распаковки — пакет подберёт расписание');
  }
}
