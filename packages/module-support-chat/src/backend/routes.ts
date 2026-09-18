import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { BackendSetupContext, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  SUPPORT_CHAT_EVENTS,
  SUPPORT_CHAT_MESSAGE_MAX_LENGTH,
  type SupportAttachmentUploadDto,
  type SupportChatEventPayload,
  type SupportThreadStatus,
} from '../contracts/index.js';
import {
  buildAttachmentKey,
  parseAttachmentInput,
  SUPPORT_CHAT_ATTACHMENT_MAX_BYTES,
  sanitizeAttachmentName,
  userAttachmentPrefix,
} from './services/attachments.js';
import { type SupportChatService, toThreadDto } from './services/support-chat-service.js';

const SSE_KEEPALIVE_MS = 20_000;
const SSE_EVENT_TYPES = [SUPPORT_CHAT_EVENTS.MESSAGE_CREATED, SUPPORT_CHAT_EVENTS.THREAD_UPDATED];

interface CurrentUser {
  id: string;
  login: string;
}

interface MultipartFile {
  filename: string;
  mimetype: string;
  file: Readable;
}

interface MultipartRequest extends FastifyRequest {
  file(options?: { limits?: { fileSize?: number } }): Promise<MultipartFile | undefined>;
}

interface MessageInput {
  body: string;
  attachment: SupportAttachmentUploadDto | null;
}

export function createSupportChatRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const service = context.services.resolve<SupportChatService>('support-chat');
  const storage = context.services.resolve<BackendStorageService>('storage');

  const currentUser = (request: FastifyRequest): CurrentUser => {
    const authService = context.services.resolve<{ getCurrentUser(req: unknown): CurrentUser | null }>('auth-service');
    return authService.getCurrentUser(request) as CurrentUser;
  };

  /**
   * Текст необязателен, если есть вложение; вложение необязательно, если есть текст.
   * Принадлежность ключа разговору проверяет сервис — там уже известен владелец треда.
   */
  const readMessageInput = (request: FastifyRequest, reply: FastifyReply): MessageInput | null => {
    const payload = (request.body ?? {}) as { body?: unknown; attachment?: unknown };

    let attachment: SupportAttachmentUploadDto | null = null;
    if (payload.attachment !== undefined && payload.attachment !== null) {
      attachment = parseAttachmentInput(payload.attachment);
      if (!attachment) {
        void reply.code(400).send({ error: 'Invalid attachment' });
        return null;
      }
    }

    const raw = payload.body;
    const body = typeof raw === 'string' ? raw.trim() : '';
    if (!body && !attachment) {
      void reply.code(400).send({ error: 'Message body or attachment is required' });
      return null;
    }
    if (body.length > SUPPORT_CHAT_MESSAGE_MAX_LENGTH) {
      void reply.code(400).send({ error: `Message is too long (max ${SUPPORT_CHAT_MESSAGE_MAX_LENGTH} characters)` });
      return null;
    }
    return { body, attachment };
  };

  const streamEvents = (request: FastifyRequest, reply: FastifyReply, matches: (payload: SupportChatEventPayload) => boolean): void => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const handlers = SSE_EVENT_TYPES.map(type => {
      const handler = (event: { payload: SupportChatEventPayload }) => {
        if (!matches(event.payload)) return;
        reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      };
      context.eventBus.on(type, handler);
      return { type, handler };
    });

    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), SSE_KEEPALIVE_MS);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      for (const { type, handler } of handlers) context.eventBus.off(type, handler);
      reply.raw.end();
    });
  };

  fastify.get('/thread', async request => {
    const user = currentUser(request);
    const [result, unreadTotal] = await Promise.all([service.getActiveUserThread(user.id), service.getUserUnreadTotal(user.id)]);
    return { thread: result ? toThreadDto(result.thread, result.messages, 'user') : null, unreadTotal };
  });

  fastify.post('/thread/messages', async (request, reply) => {
    const user = currentUser(request);
    const input = readMessageInput(request, reply);
    if (!input) return reply;

    const result = await service.sendUserMessage(user.id, input.body, input.attachment);
    return { thread: toThreadDto(result.thread, result.messages, 'user') };
  });

  fastify.post('/thread/read', async request => {
    const user = currentUser(request);
    await service.markUserRead(user.id);
    return { ok: true };
  });

  // Страница «Мои обращения»: список всех обращений пользователя и работа с конкретным.
  // Виджет рядом пишет в активное (свежее) обращение — эти маршруты его не трогают.

  fastify.get('/threads', async request => {
    const user = currentUser(request);
    return service.listUserThreads(user.id);
  });

  fastify.post('/threads', async (request, reply) => {
    const user = currentUser(request);
    const input = readMessageInput(request, reply);
    if (!input) return reply;

    const result = await service.createUserThread(user.id, input.body, input.attachment);
    return { thread: toThreadDto(result.thread, result.messages, 'user') };
  });

  fastify.get('/threads/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const result = await service.getUserThreadById(user.id, id);
    if (!result) return reply.code(404).send({ error: 'Thread not found' });
    return { thread: toThreadDto(result.thread, result.messages, 'user') };
  });

  fastify.post('/threads/:id/messages', async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const input = readMessageInput(request, reply);
    if (!input) return reply;

    const result = await service.sendUserThreadMessage(user.id, id, input.body, input.attachment);
    return { thread: toThreadDto(result.thread, result.messages, 'user') };
  });

  fastify.post('/threads/:id/read', async request => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    await service.markUserThreadRead(user.id, id);
    return { ok: true };
  });

  fastify.get('/events', (request, reply) => {
    const user = currentUser(request);
    streamEvents(request, reply, payload => payload.userId === user.id);
  });

  /**
   * Загрузка файла: multipart-часть `file`, ответ — токен для отправки сообщения.
   * Лимит поднимается на месте вызова: в чате файлы на порядок меньше курсовых пакетов,
   * а глобальные 100 МБ из `createApp` тут ни к чему.
   */
  fastify.post('/attachments', async (request, reply) => {
    const user = currentUser(request);
    const upload = await (request as MultipartRequest).file({ limits: { fileSize: SUPPORT_CHAT_ATTACHMENT_MAX_BYTES } });
    if (!upload) return reply.code(400).send({ error: 'File is required' });

    const name = sanitizeAttachmentName(upload.filename);
    if (!name) return reply.code(400).send({ error: 'Invalid file name' });

    const key = buildAttachmentKey(userAttachmentPrefix(user.id), randomUUID(), name);
    await storage.putObjectStream(key, upload.file, { contentType: upload.mimetype });
    const info = await storage.headObject(key);

    return { key, name, mime: upload.mimetype, size: info?.size ?? 0 };
  });

  /**
   * Скачивание вложения сообщения. Доступ — как у админских роутов: любой аутентифицированный
   * (ролей в платформе пока нет). Картинки и PDF отдаём inline, остальное — как файл.
   */
  fastify.get('/attachments/:messageId', async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    const attachment = await service.getMessageAttachment(messageId);
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' });

    const object = await storage.getObjectStream(attachment.key);
    const disposition = attachment.mime.startsWith('image/') || attachment.mime === 'application/pdf' ? 'inline' : 'attachment';

    reply
      .header('Content-Type', attachment.mime)
      .header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`)
      .header('Cache-Control', 'private, max-age=3600');
    if (object.contentLength !== undefined) reply.header('Content-Length', String(object.contentLength));

    return reply.send(object.body);
  });

  fastify.get('/admin/threads', async () => service.listThreads());

  fastify.get('/admin/threads/:id', async request => {
    const { id } = request.params as { id: string };
    const result = await service.getThread(id);
    return {
      thread: toThreadDto(result.thread, result.messages, 'admin'),
      userId: result.thread.userId,
      userLogin: result.userLogin,
    };
  });

  fastify.post('/admin/threads/:id/messages', async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const input = readMessageInput(request, reply);
    if (!input) return reply;

    const result = await service.sendAdminMessage(id, user.id, input.body, input.attachment);
    return { thread: toThreadDto(result.thread, result.messages, 'admin') };
  });

  fastify.post('/admin/threads/:id/read', async request => {
    const { id } = request.params as { id: string };
    await service.markAdminRead(id);
    return { ok: true };
  });

  fastify.patch('/admin/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status?: string };
    if (status !== 'open' && status !== 'closed') {
      return reply.code(400).send({ error: "Status must be 'open' or 'closed'" });
    }

    const result = await service.setStatus(id, status as SupportThreadStatus);
    return { thread: toThreadDto(result.thread, result.messages, 'admin') };
  });

  fastify.get('/admin/events', (request, reply) => {
    streamEvents(request, reply, () => true);
  });
}
