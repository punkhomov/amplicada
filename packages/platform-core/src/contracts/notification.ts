/**
 * Уведомления: ядро маршрутизирует, каналы доставляют. Отправитель знает только `userId` и `kind`;
 * адрес (email, телефон) резолвит зарегистрированный канал, надёжность доставки — outbox в ядре.
 *
 * Контракт v2 (ADR-07): контент — union (inline | code-шаблон | документ-шаблон), рендер и снапшот
 * в ядре; батчи (`sendMany`), идемпотентность (`dedupeKey`), расписание (`scheduledAt`), конверты
 * (`cc/bcc/replyTo/headers`), вложения, именованные отправители.
 */

/** Контент сообщения: готовый текст, code-шаблон (fixture) или документ-шаблон (админка). */
export type NotificationContent =
  | { subject: string; body: string; html?: string }
  | { template: { code: string; data?: Record<string, unknown>; locale?: string } }
  | { template: { id: string; data?: Record<string, unknown> } };

/** Вложение: объект в storage, к которому канал стримит письмо. */
export interface NotificationAttachment {
  storageKey: string;
  filename: string;
  contentType?: string;
  size?: number;
}

/**
 * Потолки вложений: 10 МиБ на файл, 20 МиБ на письмо. Маршруты загрузки режут по ним сразу,
 * канал проверяет реальный размер объекта (`storage.headObject`) при отправке.
 */
export const NOTIFICATION_ATTACHMENT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
} as const;

export interface NotificationMessage {
  userId: string;
  /** Устойчивый идентификатор повода: 'auth.password-reset' | 'task.alert' | 'admin.broadcast' | … */
  kind: string;
  content: NotificationContent;
  /** Имя отправителя узла ('no-reply' | 'support'); резолвит канал. */
  sender?: string;
  /** Явный канал; без него — первый зарегистрированный, который знает адрес получателя. */
  channel?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  attachments?: NotificationAttachment[];
  /** В будущем — без eager-попытки, `next_attempt_at = scheduledAt`. */
  scheduledAt?: Date;
  /** Идемпотентность бизнес-действия: повтор с тем же ключом не создаёт вторую доставку. */
  dedupeKey?: string;
  locale?: string;
}

export interface SendManyRequest extends Omit<NotificationMessage, 'userId'> {
  userIds: string[];
}

export interface SendBatchResult {
  batchId: string;
  total: number;
  queued: number;
  skipped: number;
  failed: number;
  /** Совпало с уже существующей доставкой по `dedupeKey`. */
  deduped: number;
}

/** Сообщение, привязанное к каналу и адресу, — то, что получает `send()` канала. */
export interface ResolvedNotification {
  deliveryId: string;
  userId: string;
  kind: string;
  channel: string;
  address: string;
  subject: string;
  body: string;
  html?: string;
  locale?: string;
  sender?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  attachments?: NotificationAttachment[];
}

export interface NotificationChannel {
  id: string;
  /** Адресная книга канала: null — получателю этот канал недоступен. */
  resolveAddress(userId: string): Promise<string | null>;
  send(message: ResolvedNotification): Promise<void>;
  /** Имена отправителей, которые канал умеет резолвить (для UI админки). */
  listSenders?(): string[];
}

export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface NotificationDelivery {
  id: string;
  userId: string | null;
  channel: string;
  kind: string;
  address: string;
  subject: string;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  /** Батч `sendMany`; null — одиночная отправка. */
  batchId: string | null;
}

export interface NotificationDeliveryListParams {
  status?: NotificationStatus;
  kind?: string;
  userId?: string;
  batchId?: string;
  limit?: number;
  offset?: number;
}

export interface BackendNotificationService {
  registerChannel(channel: NotificationChannel): void;
  /** Объединение имён отправителей зарегистрированных каналов. */
  listSenders(): string[];
  /** null — канала, адреса или шаблона нет; это не ошибка вызывающего, решение остаётся за ним. */
  send(message: NotificationMessage): Promise<{ id: string } | null>;
  /** Батч: одна строка на получателя, без eager — доставку делает worker-диспетчер. */
  sendMany(request: SendManyRequest): Promise<SendBatchResult>;
  listDeliveries(params: NotificationDeliveryListParams): Promise<{ items: NotificationDelivery[]; total: number }>;
  /** Ручной повтор: failed → pending (nextAttemptAt = now). true — если строка переведена. */
  retry(id: string): Promise<boolean>;
  /** Повтор всех `failed` строк батча; возвращает число переведённых. */
  retryBatch(batchId: string): Promise<number>;
}

export const NOTIFICATION_EVENTS = {
  sent: 'notification.delivery.sent',
  failed: 'notification.delivery.failed',
} as const;

export interface NotificationSentEvent {
  deliveryId: string;
  userId: string | null;
  channel: string;
  kind: string;
  attempts: number;
}

export interface NotificationFailedEvent extends NotificationSentEvent {
  lastError: string | null;
}
