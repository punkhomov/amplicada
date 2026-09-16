import type { NotificationStatus } from '@amplicada/platform-core/contracts';
import type { BackendNotificationService, BackendSetupContext } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance } from 'fastify';

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;
const STATUSES: NotificationStatus[] = ['pending', 'sending', 'sent', 'failed'];

function readInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/**
 * Лог доставок уведомлений: без него ретраи слепые — «письмо не пришло» не отличить от «канал не
 * настроен», «адрес не подтверждён» и «SMTP отбил». Отсюда же ручной повтор строки `failed`.
 */
export function createNotificationRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const notification = context.services.resolve<BackendNotificationService>('notification');

  fastify.get('/notifications', async request => {
    const query = request.query as {
      status?: string;
      kind?: string;
      userId?: string;
      limit?: string;
      offset?: string;
    };

    return notification.listDeliveries({
      status: STATUSES.find(status => status === query.status),
      kind: query.kind?.trim() || undefined,
      userId: query.userId?.trim() || undefined,
      limit: readInt(query.limit, LIMIT_DEFAULT, 1, LIMIT_MAX),
      offset: readInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    });
  });

  fastify.post('/notifications/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const retried = await notification.retry(id);
    if (!retried) return reply.code(404).send({ error: 'Доставка не найдена или уже отправлена' });
    return { ok: true };
  });
}
