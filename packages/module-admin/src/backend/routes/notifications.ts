import { logger } from '@amplicada/platform-core/backend';
import type { NotificationStatus } from '@amplicada/platform-core/contracts';
import type { BackendDbService, BackendNotificationService, BackendSetupContext } from '@amplicada/platform-core/contracts/backend';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ADMIN_BROADCAST_KIND, type SendNotificationTemplateResponse } from '../../contracts/notification-template.js';
import { isUuid, normalizeRecipients } from '../lib/normalize-recipients.js';
import { adminNotificationTemplate } from '../schemas/index.js';

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
 * Здесь же ручная рассылка по шаблону: админка — первый вызывающий `notification.send()`.
 * Получатели выбираются явно, но контракт ядра не трогается: каждый получатель уходит отдельным
 * `send({ userId, … })`, а канал и адрес по-прежнему резолвит канальный модуль.
 */
export function createNotificationRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const notification = context.services.resolve<BackendNotificationService>('notification');
  const db = context.services.resolve<BackendDbService>('db');

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

    const [template] = await db.select().from(adminNotificationTemplate).where(eq(adminNotificationTemplate.id, templateId)).limit(1);
    if (!template) return reply.code(404).send({ error: 'Шаблон не найден' });

    const results = await Promise.allSettled(
      userIds.map(userId =>
        notification.send({
          userId,
          kind: ADMIN_BROADCAST_KIND,
          subject: template.subject,
          body: template.body,
          html: template.html?.trim() ? template.html : undefined,
          locale: template.locale ?? undefined,
        }),
      ),
    );

    const queued = results.filter(result => result.status === 'fulfilled' && result.value !== null).length;
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed > 0) {
      const reasons = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => (result.reason instanceof Error ? result.reason.message : String(result.reason)));
      logger.warn({ templateId, failed, reasons }, 'Рассылка по шаблону: часть отправок упала с ошибкой');
    }

    const response: SendNotificationTemplateResponse = {
      total: userIds.length,
      queued,
      skipped: userIds.length - queued - failed,
      failed,
    };
    return response;
  });
}
