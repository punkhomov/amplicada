import type { Readable } from 'node:stream';
import type { BackendSetupContext, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

interface MultipartFile {
  filename: string;
  mimetype: string;
  file: Readable;
}

interface MultipartRequest extends FastifyRequest {
  file(): Promise<MultipartFile | undefined>;
}

const FOLDER_DELIMITER = '/';
const ACTIVE_CONTENT_TYPES = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml']);

export function createStorageRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const storage = context.services.resolve<BackendStorageService>('storage');

  /** Содержимое одной «папки»: объекты текущего уровня и префиксы вложенных папок. */
  fastify.get('/storage/objects', async request => {
    const prefix = folderPrefix((request.query as { prefix?: unknown }).prefix);
    const { objects, prefixes } = await storage.listObjects(prefix, { delimiter: FOLDER_DELIMITER });
    return {
      prefix,
      prefixes,
      // Объект-маркер папки (`foo/`) файлом не является: в списке ему делать нечего, а удаляется
      // он вместе с папкой. Всё остальное отдаём как есть.
      objects: objects.filter(object => object.key && object.key !== prefix && !object.key.endsWith(FOLDER_DELIMITER)),
    };
  });

  fastify.post('/storage/objects', async (request, reply) => {
    const prefix = folderPrefix((request.query as { prefix?: unknown }).prefix);
    const file = await (request as MultipartRequest).file();
    if (!file) return reply.code(400).send({ error: 'Файл не передан' });

    const name = fileName(file.filename);
    if (!name) return reply.code(400).send({ error: 'Недопустимое имя файла' });

    const key = `${prefix}${name}`;
    // Потоком, а не toBuffer(): лимит multipart — 100 МБ, и держать их в памяти процесса незачем.
    await storage.putObjectStream(key, file.file, { contentType: file.mimetype });
    return storage.headObject(key);
  });

  fastify.delete('/storage/objects', async (request, reply) => {
    const key = objectKey(request);
    if (!key) return reply.code(400).send({ error: 'Не указан ключ объекта' });
    await storage.deleteObject(key);
    return reply.code(204).send();
  });

  /** Рекурсивное удаление папки. Возвращает число снесённых объектов — его показывает UI. */
  fastify.delete('/storage/folder', async (request, reply) => {
    const prefix = folderPrefix((request.query as { prefix?: unknown }).prefix);
    if (!prefix) return reply.code(400).send({ error: 'Не указан префикс папки' });
    const deleted = await storage.deletePrefix(prefix);
    return { deleted };
  });

  // Ключ в query, а не в пути: `:key` в Fastify не матчит сегменты со слэшом, то есть на ключах
  // вида `learning/pkg/index.html` старые роуты отвечали 404. Скачивание — вложением, просмотр —
  // строчно, для превью.
  fastify.get('/storage/objects/download', async (request, reply) => sendObject(storage, request, reply, 'attachment'));
  fastify.get('/storage/objects/view', async (request, reply) => sendObject(storage, request, reply, 'inline'));
}

async function sendObject(
  storage: BackendStorageService,
  request: FastifyRequest,
  reply: FastifyReply,
  disposition: 'attachment' | 'inline',
): Promise<FastifyReply> {
  const key = objectKey(request);
  if (!key) return reply.code(400).send({ error: 'Не указан ключ объекта' });

  const info = await storage.headObject(key);
  if (!info) return reply.code(404).send({ error: 'Объект не найден' });

  // Стримом, а не getObject(): иначе каждое скачивание держит файл целиком в памяти процесса.
  // Range пробрасывается как есть — с ним браузер умеет перематывать медиа и докачивать обрыв.
  const object = await storage.getObjectStream(key, { range: request.headers.range });
  const contentType = object.contentType ?? info.contentType ?? 'application/octet-stream';

  reply.header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName(key))}`);
  reply.header('Accept-Ranges', 'bytes');
  // Ответы S3 не отсниффятся в HTML/SVG мимо заявленного типа.
  reply.header('X-Content-Type-Options', 'nosniff');
  // Встроенный просмотр SVG/HTML — единственное место, где чужой документ открывается на нашем
  // origin. `sandbox` без allow-скриптов не даёт ему исполнить код; во вложении эти типы и так
  // скачиваются, а не открываются.
  if (disposition === 'inline' && ACTIVE_CONTENT_TYPES.has(contentType.split(';')[0].trim().toLowerCase())) {
    reply.header('Content-Security-Policy', 'sandbox');
  }
  if (object.contentLength !== undefined) reply.header('Content-Length', object.contentLength);
  if (object.contentRange) {
    reply.header('Content-Range', object.contentRange);
    reply.code(206);
  }
  return reply.type(contentType).send(object.body);
}

function objectKey(request: FastifyRequest): string {
  const raw = (request.query as { key?: unknown }).key;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Префикс «папки»: без ведущих слэшей и всегда с разделителем на конце. Без него `prefix=foo`
 * захватил бы и `foobar.txt` — листинг S3 сравнивает строки, а не сегменты пути.
 */
function folderPrefix(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.replace(/^\/+/, '');
  if (!trimmed) return '';
  return trimmed.endsWith(FOLDER_DELIMITER) ? trimmed : `${trimmed}${FOLDER_DELIMITER}`;
}

/** Последний сегмент: нестандартный клиент может прислать путь, а ключ должен остаться именем. */
function fileName(raw: string): string {
  const name = raw.split(/[\\/]/).pop()?.trim() ?? '';
  return name === '.' || name === '..' ? '' : name;
}
