import { logger } from '@amplicada/platform-core/backend';
import { Documents, NOTIFICATION_ATTACHMENT_LIMITS, type NotificationAttachment, type NotificationStatus } from '@amplicada/platform-core/contracts';
import type {
  BackendDocumentRuntime,
  BackendNotificationService,
  BackendSetupContext,
  BackendStorageService,
} from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance } from 'fastify';
import { ADMIN_BROADCAST_KIND } from '../../contracts/notification-template.js';
import { buildAttachmentKey } from '../lib/attachment-key.js';
import { isUuid, normalizeRecipients } from '../lib/normalize-recipients.js';

interface MultipartRequest {
  file(options?: { limits?: { fileSize?: number } }): Promise<{ filename: string; mimetype: string; toBuffer(): Promise<Buffer> } | undefined>;
}

/** Манифест вложений шаблона из его extension-бакета (`core.base.attachments`). */
function readAttachments(doc: { data: Record<string, Record<string, Record<string, unknown>>> }): NotificationAttachment[] {
  const value = doc.data.core?.base?.attachments;
  return Array.isArray(value) ? (value as NotificationAttachment[]) : [];
}

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

  /**
   * Загрузка вложения шаблона: объект в storage + строка манифеста в документе. Манифест пишется
   * через document-runtime (fixture-шаблоны отклоняются guard'ом), объект при ошибке удаляется.
   */
  fastify.post('/notifications/template-attachments', async (request, reply) => {
    const query = request.query as { templateId?: string };
    const templateId = query.templateId?.trim() ?? '';
    if (!templateId || !isUuid(templateId)) return reply.code(400).send({ error: 'Некорректный templateId' });

    const runtime = context.services.resolve<BackendDocumentRuntime>('document-runtime');
    const storage = context.services.resolve<BackendStorageService>('storage');

    const doc = await runtime.getAnyById(templateId, Documents.NOTIFICATION_TEMPLATE);
    if (!doc) return reply.code(404).send({ error: 'Шаблон не найден' });
    if (doc.fixture) return reply.code(409).send({ error: 'Шаблон объявлен кодом (fixture) и не редактируется вручную' });

    let file: Awaited<ReturnType<MultipartRequest['file']>>;
    try {
      file = await (request as unknown as MultipartRequest).file({ limits: { fileSize: NOTIFICATION_ATTACHMENT_LIMITS.maxFileBytes } });
    } catch {
      return reply.code(413).send({ error: 'Файл больше 10 МиБ' });
    }
    if (!file) return reply.code(400).send({ error: 'No file provided' });

    const buffer = await file.toBuffer();
    if (buffer.length > NOTIFICATION_ATTACHMENT_LIMITS.maxFileBytes) {
      return reply.code(413).send({ error: 'Файл больше 10 МиБ' });
    }

    const current = readAttachments(doc);
    const totalBytes = current.reduce((sum, attachment) => sum + (attachment.size ?? 0), 0) + buffer.length;
    if (totalBytes > NOTIFICATION_ATTACHMENT_LIMITS.maxTotalBytes) {
      return reply.code(400).send({ error: 'Сумма вложений больше 20 МиБ' });
    }

    const storageKey = buildAttachmentKey(templateId, file.filename);
    await storage.putObject(storageKey, buffer, { contentType: file.mimetype });
    const next: NotificationAttachment[] = [
      ...current,
      { storageKey, filename: file.filename, contentType: file.mimetype, size: buffer.length },
    ];
    try {
      await runtime.update(Documents.NOTIFICATION_TEMPLATE, templateId, { core: { base: { attachments: next } } });
    } catch (err) {
      await storage.deleteObject(storageKey).catch(() => undefined);
      throw err;
    }

    return { attachments: next };
  });

  /** Снятие вложения: манифест без строки, объект из storage удаляется best-effort. */
  fastify.delete('/notifications/template-attachments', async (request, reply) => {
    const body = (request.body ?? {}) as { templateId?: unknown; storageKey?: unknown };
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
    const storageKey = typeof body.storageKey === 'string' ? body.storageKey.trim() : '';
    if (!templateId || !isUuid(templateId)) return reply.code(400).send({ error: 'Некорректный templateId' });
    if (!storageKey) return reply.code(400).send({ error: 'Некорректный storageKey' });

    const runtime = context.services.resolve<BackendDocumentRuntime>('document-runtime');
    const storage = context.services.resolve<BackendStorageService>('storage');

    const doc = await runtime.getAnyById(templateId, Documents.NOTIFICATION_TEMPLATE);
    if (!doc) return reply.code(404).send({ error: 'Шаблон не найден' });
    if (doc.fixture) return reply.code(409).send({ error: 'Шаблон объявлен кодом (fixture) и не редактируется вручную' });

    const current = readAttachments(doc);
    if (!current.some(attachment => attachment.storageKey === storageKey)) {
      return reply.code(404).send({ error: 'Вложение не найдено' });
    }
    const next = current.filter(attachment => attachment.storageKey !== storageKey);

    await runtime.update(Documents.NOTIFICATION_TEMPLATE, templateId, { core: { base: { attachments: next } } });
    await storage.deleteObject(storageKey).catch(err => {
      logger.warn({ err, key: storageKey }, 'Не удалось удалить объект вложения');
    });

    return { attachments: next };
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
