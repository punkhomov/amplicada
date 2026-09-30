import type { NotificationStatus } from '@amplicada/platform-core/contracts';
import type { BackendNotificationService, BackendSetupContext } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance } from 'fastify';
import { ADMIN_BROADCAST_KIND } from '../../contracts/notification-template.js';
import { isUuid, normalizeRecipients } from '../lib/normalize-recipients.js';

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
 *
 * Ручная рассылка по шаблону идёт через `notification.sendMany` (контракт v2): один батч, по строке
 * на получателя, без eager — доставку добирает worker-диспетчер. Шаблон резолвит ядро по id.
 */
export function createNotificationRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const notification = context.services.resolve<BackendNotificationService>('notification');

  fastify.get('/notifications', async request => {
    const query = request.query as {
      status?: string;
      kind?: string;
      userId?: string;
      batchId?: string;
      limit?: string;
      offset?: string;
    };

    return notification.listDeliveries({
      status: STATUSES.find(status => status === query.status),
      kind: query.kind?.trim() || undefined,
      userId: query.userId?.trim() || undefined,
      batchId: query.batchId?.trim() || undefined,
      limit: readInt(query.limit, LIMIT_DEFAULT, 1, LIMIT_MAX),
      offset: readInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    });
  });

  /** Имена отправителей узла — для select в редакторе шаблона. */
  fastify.get('/notifications/senders', async () => ({ senders: notification.listSenders() }));

  fastify.post('/notifications/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const retried = await notification.retry(id);
    if (!retried) return reply.code(404).send({ error: 'Доставка не найдена или уже отправлена' });
    return { ok: true };
  });

  /** Повтор всех `failed` строк батча — кнопка «Повторить батч» в логе. */
  fastify.post('/notifications/batch/:batchId/retry', async (request, reply) => {
    const { batchId } = request.params as { batchId: string };
    if (!batchId.trim()) return reply.code(400).send({ error: 'Некорректный batchId' });
    return { retried: await notification.retryBatch(batchId) };
  });

  fastify.post('/notifications/send-template', async (request, reply) => {
    const body = (request.body ?? {}) as { templateId?: unknown; userIds?: unknown };
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
    const userIds = normalizeRecipients(body.userIds);

    if (!templateId || !isUuid(templateId)) {
      return reply.code(400).send({ error: 'Некорректный templateId' });
    }
    if (userIds.length === 0) {
      return reply.code(400).send({ error: 'Не выбран ни один получатель' });
    }

    return notification.sendMany({
      userIds,
      kind: ADMIN_BROADCAST_KIND,
      content: { template: { id: templateId } },
    });
  });
}
