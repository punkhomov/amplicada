import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { BackendDbService } from '../../contracts/backend/db.js';
import type { EventBus } from '../../contracts/event-bus.js';
import {
  type BackendNotificationService,
  NOTIFICATION_EVENTS,
  type NotificationAttachment,
  type NotificationChannel,
  type NotificationContent,
  type NotificationDelivery,
  type NotificationDeliveryListParams,
  type NotificationFailedEvent,
  type NotificationMessage,
  type NotificationSentEvent,
  type NotificationStatus,
  type SendBatchResult,
  type SendManyRequest,
} from '../../contracts/notification.js';
import { logger } from '../logger.js';
import { notificationOutbox } from '../schemas/index.js';
import { renderContent } from './notification-render.js';
import { loadTemplate } from './notification-template-resolver.js';

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_BASE_MS = 30_000;
export const DEFAULT_RETENTION_DAYS = 30;

/** Потолок экспоненциального бэкоффа: бэкофф растёт, но не превращается в бесконечное ожидание. */
export const BACKOFF_CAP_MS = 60 * 60 * 1000;
/** Дольше этого доставка не может честно идти: считаем, что процесс упал между claim'ом и завершением. */
export const STALE_SENDING_THRESHOLD_MS = 5 * 60 * 1000;
const DISPATCH_BATCH_LIMIT = 20;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

export interface NotificationServiceConfig {
  maxAttempts?: number;
  retryBaseMs?: number;
  retentionDays?: number;
}

export interface NotificationServiceDeps {
  db: BackendDbService;
  eventBus: EventBus;
  config?: NotificationServiceConfig;
}

/** Пауза перед `attempts`-й по счёту повторной попыткой: base · 2^attempts, не больше часа. */
export function backoffDelayMs(attempts: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** Math.max(attempts, 0), BACKOFF_CAP_MS);
}

/**
 * Выбор канала: явный — только он; без явного — первый зарегистрированный, который знает адрес.
 * Чистая часть вынесена отдельно от похода в адресную книгу, чтобы её можно было проверить без БД.
 */
export function pickChannel(
  candidates: Array<{ channel: NotificationChannel; address: string | null }>,
  requested?: string,
): { channel: NotificationChannel; address: string } | null {
  if (requested) {
    const match = candidates.find(candidate => candidate.channel.id === requested);
    return match?.address ? { channel: match.channel, address: match.address } : null;
  }
  const first = candidates.find(candidate => candidate.address);
  if (!first?.address) return null;
  return { channel: first.channel, address: first.address };
}

export type BatchOutcome = 'queued' | 'skipped' | 'failed' | 'deduped';

/** Агрегат батча: то, что `sendMany` возвращает вызывающему (без batchId/total). */
export function countBatchOutcomes(outcomes: BatchOutcome[]): Omit<SendBatchResult, 'batchId' | 'total'> {
  const counts = { queued: 0, skipped: 0, failed: 0, deduped: 0 };
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}

/** Контент сообщения после резолва шаблона и рендера — снапшот для outbox. */
interface ResolvedContent {
  subject: string;
  body: string;
  html?: string;
  sender?: string;
  attachments?: NotificationAttachment[];
  locale?: string;
}

/**
 * Реестр каналов + outbox. Владеет маршрутизацией (кого и куда) и надёжностью (claim, ретраи,
 * ретенция). Транспорт и адресные книги — забота каналов, см. `NotificationChannel`.
 */
export class NotificationServiceImpl implements BackendNotificationService {
  private readonly channels = new Map<string, NotificationChannel>();
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retentionDays: number;
  private lastCleanupAt = 0;

  constructor(private deps: NotificationServiceDeps) {
    this.maxAttempts = deps.config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseMs = deps.config?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retentionDays = deps.config?.retentionDays ?? DEFAULT_RETENTION_DAYS;
  }

  registerChannel(channel: NotificationChannel): void {
    this.channels.set(channel.id, channel);
  }

  listSenders(): string[] {
    const names = new Set<string>();
    for (const channel of this.channels.values()) {
      for (const name of channel.listSenders?.() ?? []) names.add(name);
    }
    return [...names].sort();
  }

  async send(message: NotificationMessage): Promise<{ id: string } | null> {
    const content = await this.resolveContent(message);
    if (!content) return null;

    const resolved = await this.resolveTarget(message);
    if (!resolved) {
      logger.warn(
        { userId: message.userId, kind: message.kind, channel: message.channel },
        'Уведомление не отправлено: канал или адрес получателя не найдены',
      );
      return null;
    }

    const scheduledAt = message.scheduledAt && message.scheduledAt.getTime() > Date.now() ? message.scheduledAt : undefined;
    const result = await this.insertDelivery(message, content, resolved.channel.id, resolved.address, null, scheduledAt ?? new Date());
    if (!result) return null;

    // Eager-попытка в своём процессе: ответ вызывающему не ждёт SMTP (кроме отложенных и dedupe-повторов).
    // Ошибку глотаем — строка уже в outbox, диспетчер доделает (транспортную ошибку вернуть вызывающему
    // бессмысленно: он её не решает, а откатывать бизнес-действие из-за недоступности почты нельзя).
    if (result.inserted && !scheduledAt) {
      void this.deliver(result.id).catch(err => logger.error({ err, deliveryId: result.id }, 'Eager-доставка упала'));
    }

    return { id: result.id };
  }

  /**
   * Батч: контент резолвится один раз, строка — на каждого получателя. Без eager: доставку делает
   * worker-диспетчер (trade-off — на узле без worker-роли строки лежат `pending`).
   */
  async sendMany(request: SendManyRequest): Promise<SendBatchResult> {
    const batchId = randomUUID();
    const total = request.userIds.length;

    const content = await this.resolveContent(request);
    if (!content) {
      return { batchId, total, ...countBatchOutcomes(request.userIds.map(() => 'skipped')) };
    }

    const outcomes: BatchOutcome[] = [];
    for (const userId of request.userIds) {
      const message: NotificationMessage = { ...request, userId };
      try {
        const resolved = await this.resolveTarget(message);
        if (!resolved) {
          logger.warn({ userId, kind: request.kind, channel: request.channel }, 'Строка рассылки не отправлена: канал или адрес не найдены');
          outcomes.push('skipped');
          continue;
        }
        const scheduledAt = request.scheduledAt && request.scheduledAt.getTime() > Date.now() ? request.scheduledAt : undefined;
        const result = await this.insertDelivery(message, content, resolved.channel.id, resolved.address, batchId, scheduledAt ?? new Date());
        outcomes.push(result === null ? 'skipped' : result.inserted ? 'queued' : 'deduped');
      } catch (err) {
        logger.warn({ err, userId, kind: request.kind }, 'Строка рассылки не поставлена в outbox');
        outcomes.push('failed');
      }
    }

    return { batchId, total, ...countBatchOutcomes(outcomes) };
  }

  /** Контент сообщения: inline — как есть; шаблон — резолв и рендер `{{path}}` со снапшотом. */
  private async resolveContent(message: { kind: string; content: NotificationContent; locale?: string }): Promise<ResolvedContent | null> {
    const content = message.content;
    if (!('template' in content)) {
      return { subject: content.subject, body: content.body, ...(content.html === undefined ? {} : { html: content.html }) };
    }

    const template = await loadTemplate(this.deps.db, content.template, message.locale);
    if (!template) return null;

    const rendered = renderContent(
      { subject: template.subject, body: template.body, ...(template.html === null ? {} : { html: template.html }) },
      content.template.data ?? {},
    );
    if (rendered.missing.length) {
      logger.warn({ kind: message.kind, missing: rendered.missing }, 'В шаблоне уведомления не хватает переменных');
    }

    return {
      subject: rendered.subject,
      body: rendered.body,
      ...(rendered.html === undefined ? {} : { html: rendered.html }),
      ...(template.sender === null ? {} : { sender: template.sender }),
      attachments: template.attachments,
      ...(template.locale === null ? {} : { locale: template.locale }),
    };
  }

  private async resolveTarget(message: NotificationMessage): Promise<{ channel: NotificationChannel; address: string } | null> {
    const candidates = [...this.channels.values()];
    const requested = message.channel ? candidates.filter(channel => channel.id === message.channel) : candidates;

    return pickChannel(
      await Promise.all(requested.map(async channel => ({ channel, address: await channel.resolveAddress(message.userId) }))),
      message.channel,
    );
  }

  /**
   * Вставка строки outbox. Конфликт по `dedupeKey` (`ON CONFLICT DO NOTHING` + partial unique
   * `(kind, dedupe_key, user_id)`) возвращает существующий id с `inserted: false`; null — строку
   * поставить не удалось и существующей нет.
   */
  private async insertDelivery(
    message: NotificationMessage,
    content: ResolvedContent,
    channelId: string,
    address: string,
    batchId: string | null,
    nextAttemptAt: Date,
  ): Promise<{ id: string; inserted: boolean } | null> {
    const values = {
      userId: message.userId,
      channel: channelId,
      kind: message.kind,
      address,
      subject: content.subject,
      body: content.body,
      html: content.html ?? null,
      locale: message.locale ?? content.locale ?? null,
      sender: message.sender ?? content.sender ?? null,
      replyTo: message.replyTo ?? null,
      cc: message.cc ?? null,
      bcc: message.bcc ?? null,
      headers: message.headers ?? null,
      attachments: message.attachments ?? content.attachments ?? [],
      dedupeKey: message.dedupeKey ?? null,
      batchId,
      nextAttemptAt,
      maxAttempts: this.maxAttempts,
    };

    const insert = this.deps.db.insert(notificationOutbox).values(values);
    const [row] = message.dedupeKey
      ? await insert.onConflictDoNothing().returning({ id: notificationOutbox.id })
      : await insert.returning({ id: notificationOutbox.id });
    if (row) return { id: row.id, inserted: true };

    if (message.dedupeKey) {
      const [existing] = await this.deps.db
        .select({ id: notificationOutbox.id })
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.kind, message.kind),
            eq(notificationOutbox.dedupeKey, message.dedupeKey),
            eq(notificationOutbox.userId, message.userId),
          ),
        )
        .limit(1);
      return existing ? { id: existing.id, inserted: false } : null;
    }

    return null;
  }

  /**
   * Атомарный claim: `pending` → `sending` условным UPDATE. Два процесса не отправят письмо дважды —
   * второй UPDATE не найдёт строку в `pending`.
   */
  async deliver(id: string): Promise<void> {
    const [row] = await this.deps.db
      .update(notificationOutbox)
      .set({ status: 'sending', updatedAt: new Date() })
      .where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'pending')))
      .returning();

    if (!row) return;

    const channel = this.channels.get(row.channel);
    if (!channel) {
      await this.fail(row.id, `Канал "${row.channel}" не зарегистрирован`, row.attempts, row.maxAttempts, row);
      return;
    }

    try {
      await channel.send({
        deliveryId: row.id,
        userId: row.userId ?? '',
        kind: row.kind,
        subject: row.subject,
        body: row.body,
        html: row.html ?? undefined,
        locale: row.locale ?? undefined,
        sender: row.sender ?? undefined,
        replyTo: row.replyTo ?? undefined,
        cc: row.cc ?? undefined,
        bcc: row.bcc ?? undefined,
        headers: row.headers ?? undefined,
        attachments: row.attachments.length ? row.attachments : undefined,
        channel: row.channel,
        address: row.address,
      });

      await this.deps.db
        .update(notificationOutbox)
        .set({ status: 'sent', sentAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(notificationOutbox.id, row.id));

      this.emit<NotificationSentEvent>(NOTIFICATION_EVENTS.sent, {
        deliveryId: row.id,
        userId: row.userId,
        channel: row.channel,
        kind: row.kind,
        attempts: row.attempts,
      });
    } catch (err) {
      await this.fail(row.id, err instanceof Error ? err.message : String(err), row.attempts, row.maxAttempts, row);
    }
  }

  private async fail(
    id: string,
    reason: string,
    attempts: number,
    maxAttempts: number,
    row: { userId: string | null; channel: string; kind: string },
  ): Promise<void> {
    const nextAttempts = attempts + 1;
    const exhausted = nextAttempts >= maxAttempts;

    await this.deps.db
      .update(notificationOutbox)
      .set({
        status: exhausted ? 'failed' : 'pending',
        attempts: nextAttempts,
        lastError: reason,
        nextAttemptAt: new Date(Date.now() + backoffDelayMs(nextAttempts, this.retryBaseMs)),
        updatedAt: new Date(),
      })
      .where(eq(notificationOutbox.id, id));

    logger.warn(
      { deliveryId: id, attempts: nextAttempts, reason },
      exhausted ? 'Доставка уведомления провалена' : 'Доставка уведомления отложена',
    );

    if (exhausted) {
      this.emit<NotificationFailedEvent>(NOTIFICATION_EVENTS.failed, {
        deliveryId: id,
        userId: row.userId,
        channel: row.channel,
        kind: row.kind,
        attempts: nextAttempts,
        lastError: reason,
      });
    }
  }

  /**
   * Восстановление после краша процесса между claim'ом и завершением: `sending` старше порога
   * возвращается в очередь, а попытка засчитывается (иначе строка, роняющая процесс, крутилась бы вечно).
   */
  async requeueStaleSending(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS);
    const stale = and(eq(notificationOutbox.status, 'sending'), lt(notificationOutbox.updatedAt, staleBefore));

    await this.deps.db
      .update(notificationOutbox)
      .set({
        status: 'pending',
        attempts: sql`${notificationOutbox.attempts} + 1`,
        lastError: 'Доставка не завершилась (краш/рестарт процесса)',
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(stale, sql`${notificationOutbox.attempts} + 1 < ${notificationOutbox.maxAttempts}`));

    await this.deps.db
      .update(notificationOutbox)
      .set({
        status: 'failed',
        attempts: sql`${notificationOutbox.attempts} + 1`,
        lastError: 'Доставка не завершилась (краш/рестарт процесса), попытки исчерпаны',
        updatedAt: new Date(),
      })
      .where(and(stale, sql`${notificationOutbox.attempts} + 1 >= ${notificationOutbox.maxAttempts}`));
  }

  /**
   * Кандидаты выбираются обычным SELECT'ом без блокировки: настоящий claim происходит в `deliver`
   * условным UPDATE, поэтому гонка между несколькими воркерами безопасна.
   */
  async dispatchDue(): Promise<void> {
    const due = await this.deps.db
      .select({ id: notificationOutbox.id })
      .from(notificationOutbox)
      .where(and(eq(notificationOutbox.status, 'pending'), lte(notificationOutbox.nextAttemptAt, new Date())))
      .orderBy(notificationOutbox.nextAttemptAt)
      .limit(DISPATCH_BATCH_LIMIT);

    await Promise.allSettled(due.map(({ id }) => this.deliver(id)));
  }

  /** Ретенция: `sent`/`failed` старше окна удаляются. Диспетчер дёргает не чаще раза в час. */
  async cleanupOld(force = false): Promise<void> {
    if (!force && Date.now() - this.lastCleanupAt < CLEANUP_INTERVAL_MS) return;
    this.lastCleanupAt = Date.now();

    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    const removed = await this.deps.db
      .delete(notificationOutbox)
      .where(and(inArray(notificationOutbox.status, ['sent', 'failed']), lt(notificationOutbox.updatedAt, cutoff)))
      .returning({ id: notificationOutbox.id });

    if (removed.length) logger.info({ removed: removed.length }, 'Ретенция уведомлений: старые доставки удалены');
  }

  async listDeliveries(params: NotificationDeliveryListParams): Promise<{ items: NotificationDelivery[]; total: number }> {
    const limit = Math.min(Math.max(params.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
    const offset = Math.max(params.offset ?? 0, 0);
    const filters = [];
    if (params.status) filters.push(eq(notificationOutbox.status, params.status));
    if (params.kind) filters.push(eq(notificationOutbox.kind, params.kind));
    if (params.userId) filters.push(eq(notificationOutbox.userId, params.userId));
    if (params.batchId) filters.push(eq(notificationOutbox.batchId, params.batchId));
    const where = filters.length ? and(...filters) : undefined;

    const [rows, [total]] = await Promise.all([
      this.deps.db.select().from(notificationOutbox).where(where).orderBy(desc(notificationOutbox.createdAt)).limit(limit).offset(offset),
      this.deps.db.select({ value: count() }).from(notificationOutbox).where(where),
    ]);

    return {
      items: rows.map(row => ({
        id: row.id,
        userId: row.userId,
        channel: row.channel,
        kind: row.kind,
        address: row.address,
        subject: row.subject,
        status: row.status as NotificationStatus,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        nextAttemptAt: row.nextAttemptAt,
        lastError: row.lastError,
        createdAt: row.createdAt,
        sentAt: row.sentAt,
        batchId: row.batchId,
      })),
      total: total?.value ?? 0,
    };
  }

  /** Ручной повтор из админки: `failed` → `pending` без ожидания бэкоффа. */
  async retry(id: string): Promise<boolean> {
    const rows = await this.deps.db
      .update(notificationOutbox)
      .set({ status: 'pending', nextAttemptAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'failed')))
      .returning({ id: notificationOutbox.id });

    return rows.length > 0;
  }

  /** Повтор всех `failed` строк батча — кнопка «Повторить батч» в админке. */
  async retryBatch(batchId: string): Promise<number> {
    const rows = await this.deps.db
      .update(notificationOutbox)
      .set({ status: 'pending', nextAttemptAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(notificationOutbox.batchId, batchId), eq(notificationOutbox.status, 'failed')))
      .returning({ id: notificationOutbox.id });

    return rows.length;
  }

  private emit<T>(type: string, payload: T): void {
    this.deps.eventBus.emit(type, payload);
  }
}
