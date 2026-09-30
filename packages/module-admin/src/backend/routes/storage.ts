import type { Readable } from 'node:stream';
import type { BackendSetupContext, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { StorageCreateFolderRequest, StorageDeleteRequest, StorageMoveRequest } from '../../contracts/storage.js';

interface MultipartFile {
  filename: string;
  mimetype: string;
  file: Readable;
}

interface MultipartRequest extends FastifyRequest {
  file(): Promise<MultipartFile | undefined>;
}

interface MovePlan {
  key: string;
  target: string;
  isFolder: boolean;
}

const FOLDER_DELIMITER = '/';
/** Дефолт страницы: дерево и диалог перемещения курсор не шлют — им нужна первая страница целиком. */
const DEFAULT_PAGE_LIMIT = 200;
/** Потолок страницы: больше S3 за один `ListObjectsV2` всё равно не отдаст, а буфер ответа раздуется. */
const MAX_PAGE_LIMIT = 1000;
const ACTIVE_CONTENT_TYPES = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml']);
/** Маркер папки: в S3 директорий нет, папка — пустой объект с ключом на `/`. */
const DIRECTORY_CONTENT_TYPE = 'application/x-directory';
/** Лимит S3 на имя сегмента: длиннее — уже не имя папки, а склеенный путь. */
const MAX_FOLDER_NAME_LENGTH = 255;

export function createStorageRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const storage = context.services.resolve<BackendStorageService>('storage');
  // Правка выключена по умолчанию. Флаг читается один раз при регистрации: когда выключено,
  // роута сохранения нет вовсе — спрятать только кнопку в UI мало, эндпоинт остался бы открыт.
  const editEnabled = process.env.STORAGE_EDIT_ENABLED === 'true';

  /** Возможности страницы для фронта: сейчас — только флаг правки. */
  fastify.get('/storage/config', async () => ({ editEnabled }));

  /**
   * Страница содержимого одной «папки»: объекты текущего уровня и префиксы вложенных папок.
   * `cursor` — токен из `nextToken` предыдущей страницы; без него отдаётся первая страница.
   */
  fastify.get('/storage/objects', async (request, reply) => {
    const query = request.query as { prefix?: unknown; cursor?: unknown; limit?: unknown };
    const prefix = folderPrefix(query.prefix);
    const cursor = pageCursor(query.cursor);
    if (cursor === null) return reply.code(400).send({ error: 'Недопустимый курсор' });
    const limit = pageLimit(query.limit);
    if (limit === null) return reply.code(400).send({ error: 'Недопустимый размер страницы' });

    const { objects, prefixes, nextToken } = await storage.listObjects(prefix, {
      delimiter: FOLDER_DELIMITER,
      maxKeys: limit,
      // Первая страница — это тоже токен, просто `undefined`: форма вызова одна на оба случая.
      continuationToken: cursor,
    });
    return {
      prefix,
      prefixes,
      // Объект-маркер папки (`foo/`) файлом не является: в списке ему делать нечего, а удаляется
      // он вместе с папкой. Всё остальное отдаём как есть.
      objects: objects.filter(object => object.key && object.key !== prefix && !object.key.endsWith(FOLDER_DELIMITER)),
      nextToken,
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

  /** Создание папки: кладём пустой объект-маркер, иначе в листинге папка не появится. */
  fastify.post('/storage/folder', async (request, reply) => {
    const prefix = folderPrefix((request.query as { prefix?: unknown }).prefix);
    const { name: rawName } = (request.body ?? {}) as Partial<StorageCreateFolderRequest>;
    const name = folderName(rawName);
    if (!name) return reply.code(400).send({ error: 'Недопустимое имя папки' });

    const key = folderKey(prefix, name);
    // Одного `headObject` мало: папка без маркера существует, пока под префиксом есть объекты.
    if (await folderExists(storage, key)) return reply.code(409).send({ error: 'Папка уже существует' });

    await storage.putObject(key, '', { contentType: DIRECTORY_CONTENT_TYPE });
    return storage.headObject(key);
  });

  if (editEnabled) {
    fastify.put('/storage/objects', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
      const key = objectKey(request);
      if (!key) return reply.code(400).send({ error: 'Не указан ключ объекта' });
      const { content } = (request.body ?? {}) as { content?: unknown };
      if (typeof content !== 'string') return reply.code(400).send({ error: 'Не передано содержимое' });
      const info = await storage.headObject(key);
      if (!info) return reply.code(404).send({ error: 'Объект не найден' });
      await storage.putObject(key, content, { contentType: info.contentType ?? 'text/plain; charset=utf-8' });
      return storage.headObject(key);
    });
  }

  /**
   * Перемещение в S3 — это copy + delete: переименовать префикс одним запросом нельзя.
   * Ответ `moved` считает верхнеуровневые элементы, а не объекты поддерева.
   */
  fastify.post('/storage/move', async (request, reply) => {
    const { keys: rawKeys, destination: rawDestination, name: rawName } = (request.body ?? {}) as Partial<StorageMoveRequest>;
    const keys = [...new Set(bodyKeys(rawKeys))];
    if (!keys.length) return reply.code(400).send({ error: 'Не указаны ключи для перемещения' });
    if (typeof rawDestination !== 'string' || !rawDestination.trim()) {
      return reply.code(400).send({ error: 'Не указана папка назначения' });
    }
    // Новое имя — хвост одного ключа, поэтому к нескольким ключам сразу оно неприменимо.
    if (rawName !== undefined && keys.length > 1) {
      return reply.code(400).send({ error: 'Новое имя допустимо только для одного элемента' });
    }
    const name = rawName === undefined ? undefined : folderName(rawName);
    if (rawName !== undefined && !name) return reply.code(400).send({ error: 'Недопустимое новое имя' });

    // `/` нормализуется в корень бакета (`''`) — явная корневая папка валидна, пустая строка нет.
    const destination = folderPrefix(rawDestination.trim());
    if (hasParentSegment(destination)) return reply.code(400).send({ error: 'Недопустимый путь назначения' });

    const plans: MovePlan[] = [];
    for (const key of keys) {
      const isFolder = key.endsWith(FOLDER_DELIMITER);
      const target = moveTargetOf(key, destination, name);
      if (!target) return reply.code(400).send({ error: 'Недопустимый ключ' });
      if (isFolder && (target === key || isDescendant(target, key))) {
        return reply.code(400).send({ error: 'Папку нельзя переместить в себя или в свою подпапку' });
      }
      plans.push({ key, target, isFolder });
    }

    // Два разных источника могут сойтись в одном целевом ключе (например, `x/f.txt` и `y/f.txt`
    // в одну папку): второй copy молча перезапишет первый. Лучше отказать до копирования.
    const targets = new Set<string>();
    for (const plan of plans) {
      if (targets.has(plan.target)) return reply.code(400).send({ error: 'Несколько элементов перемещаются в один ключ' });
      targets.add(plan.target);
    }

    // Сначала проверяем все источники и коллизии, потом двигаем: транзакций в S3 нет, и частично
    // выполненный перенос из-за ошибки в середине списка хуже, чем отказ до первого копирования.
    for (const plan of plans) {
      if (plan.isFolder) {
        if (!(await folderExists(storage, plan.key))) return reply.code(400).send({ error: 'Папка не найдена' });
        if (await folderExists(storage, plan.target)) return reply.code(409).send({ error: 'Папка уже существует' });
      } else {
        if (!(await storage.headObject(plan.key))) return reply.code(400).send({ error: 'Объект не найден' });
        if (await storage.headObject(plan.target)) return reply.code(409).send({ error: 'Объект уже существует' });
      }
    }

    for (const plan of plans) {
      if (!plan.isFolder) {
        await storage.copyObject(plan.key, plan.target);
        await storage.deleteObject(plan.key);
        continue;
      }
      const { objects } = await storage.listObjects(plan.key);
      // Маркер самой папки не среди содержимого: его копировать не нужно, у цели будет свой.
      const children = objects.filter(object => object.key !== plan.key);
      for (const child of children) {
        await storage.copyObject(child.key, `${plan.target}${child.key.slice(plan.key.length)}`);
      }
      // Пустая папка на новом месте должна остаться папкой — ставим маркер цели.
      await storage.putObject(plan.target, '', { contentType: DIRECTORY_CONTENT_TYPE });
      // Старое поддерево сносим пачками: поштучно на большом пакете — тысячи round-trip'ов.
      await storage.deleteObjects(children.map(child => child.key));
      await storage.deleteObject(plan.key);
    }

    return { moved: plans.length };
  });

  /** Пакетное удаление: ключи приходят из мультивыбора в UI, по одному ходить незачем. */
  fastify.delete('/storage/objects', async (request, reply) => {
    const { keys: rawKeys } = (request.body ?? {}) as Partial<StorageDeleteRequest>;
    const keys = bodyKeys(rawKeys);
    if (!keys.length) return reply.code(400).send({ error: 'Не указаны ключи для удаления' });
    const deleted = await storage.deleteObjects(keys);
    return { deleted };
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

/**
 * Размер страницы из query. Мусор отвергаем, а не чиним молча: клиент, приславший `limit=abc`,
 * иначе счёл бы ответ запрошенной страницей. `null` — сигнал роуту ответить 400.
 */
function pageLimit(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_PAGE_LIMIT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return limit >= 1 && limit <= MAX_PAGE_LIMIT ? limit : null;
}

/**
 * Курсор страницы. Токен opaque — содержимое не разбираем, но пустая строка и дубль параметра
 * (массив) курсором не являются: вернуть на них молча первую страницу значило бы отдать не то,
 * чего ждёт клиент. `null` — сигнал роуту ответить 400.
 */
function pageCursor(raw: unknown): string | undefined | null {
  if (raw === undefined) return undefined;
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/** Последний сегмент: нестандартный клиент может прислать путь, а ключ должен остаться именем. */
function fileName(raw: string): string {
  const name = raw.split(/[\\/]/).pop()?.trim() ?? '';
  return name === '.' || name === '..' ? '' : name;
}

/** Ключи из тела запроса: не-массив, пустой элемент или сегмент `..` — сигнал невалидного запроса. */
function bodyKeys(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const keys: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return [];
    const key = item.trim().replace(/^\/+/, '');
    if (!key || hasParentSegment(key)) return [];
    keys.push(key);
  }
  return keys;
}

/** `..` отдельным сегментом: наружу из папки S3-ключом не выйти, и UI такого не генерирует. */
function hasParentSegment(path: string): boolean {
  return path.split(FOLDER_DELIMITER).includes('..');
}

/** Имя папки или нового имени элемента — ровно один сегмент: разделитель пути увёл бы его в чужую папку. */
function folderName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const name = raw.trim();
  if (!name || name === '.' || name === '..') return '';
  if (name.includes(FOLDER_DELIMITER) || name.includes('\\')) return '';
  return name.length > MAX_FOLDER_NAME_LENGTH ? '' : name;
}

/** Ключ-маркер папки: `folderKey('a/', 'docs')` → `'a/docs/'`. */
export function folderKey(prefix: string, name: string): string {
  return `${prefix}${name}${FOLDER_DELIMITER}`;
}

/**
 * Целевой ключ перемещения: к папке назначения добавляется последний сегмент исходного ключа.
 * С `name` хвост заменяется целиком — так выражается переименование.
 */
export function moveTargetOf(key: string, destination: string, name?: string): string {
  if (key.endsWith(FOLDER_DELIMITER)) {
    const base = name ?? key.slice(0, -1).split(FOLDER_DELIMITER).pop() ?? '';
    return base ? folderKey(destination, base) : '';
  }
  const base = name ?? fileName(key);
  return base ? `${destination}${base}` : '';
}

/** Цель лежит внутри папки; сама папка потомком не считается. */
export function isDescendant(target: string, folder: string): boolean {
  return target !== folder && target.startsWith(folder);
}

/** Папка «есть», если найден маркер или хоть один объект (префикс) под ним. */
async function folderExists(storage: BackendStorageService, key: string): Promise<boolean> {
  if (await storage.headObject(key)) return true;
  const { objects, prefixes } = await storage.listObjects(key, { delimiter: FOLDER_DELIMITER });
  return objects.length > 0 || prefixes.length > 0;
}
