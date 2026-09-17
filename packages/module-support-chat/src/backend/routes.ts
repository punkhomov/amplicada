import type { BackendSetupContext } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  SUPPORT_CHAT_EVENTS,
  SUPPORT_CHAT_MESSAGE_MAX_LENGTH,
  type SupportChatEventPayload,
  type SupportThreadStatus,
} from '../contracts/index.js';
import { type SupportChatService, toThreadDto } from './services/support-chat-service.js';

const SSE_KEEPALIVE_MS = 20_000;
const SSE_EVENT_TYPES = [SUPPORT_CHAT_EVENTS.MESSAGE_CREATED, SUPPORT_CHAT_EVENTS.THREAD_UPDATED];

interface CurrentUser {
  id: string;
  login: string;
}

export function createSupportChatRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const service = context.services.resolve<SupportChatService>('support-chat');

  const currentUser = (request: FastifyRequest): CurrentUser => {
    const authService = context.services.resolve<{ getCurrentUser(req: unknown): CurrentUser | null }>('auth-service');
    return authService.getCurrentUser(request) as CurrentUser;
  };

  const readBody = (request: FastifyRequest, reply: FastifyReply): string | null => {
    const raw = (request.body as { body?: unknown } | undefined)?.body;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      void reply.code(400).send({ error: 'Message body is required' });
      return null;
    }
    const body = raw.trim();
    if (body.length > SUPPORT_CHAT_MESSAGE_MAX_LENGTH) {
      void reply.code(400).send({ error: `Message is too long (max ${SUPPORT_CHAT_MESSAGE_MAX_LENGTH} characters)` });
      return null;
    }
    return body;
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
    const result = await service.getUserThread(user.id);
    return { thread: result ? toThreadDto(result.thread, result.messages, 'user') : null };
  });

  fastify.post('/thread/messages', async (request, reply) => {
    const user = currentUser(request);
    const body = readBody(request, reply);
    if (!body) return reply;

    const result = await service.sendUserMessage(user.id, body);
    return { thread: toThreadDto(result.thread, result.messages, 'user') };
  });

  fastify.post('/thread/read', async request => {
    const user = currentUser(request);
    await service.markUserRead(user.id);
    return { ok: true };
  });

  fastify.get('/events', (request, reply) => {
    const user = currentUser(request);
    streamEvents(request, reply, payload => payload.userId === user.id);
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
    const body = readBody(request, reply);
    if (!body) return reply;

    const result = await service.sendAdminMessage(id, user.id, body);
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
