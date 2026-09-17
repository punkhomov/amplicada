/**
 * Уведомления: ядро маршрутизирует, каналы доставляют. Отправитель знает только `userId` и `kind`;
 * адрес (email, телефон) резолвит зарегистрированный канал, надёжность доставки — outbox в ядре.
 */
export interface NotificationMessage {
  userId: string;
  /** Устойчивый идентификатор повода: 'auth.password-reset' | 'task.alert' | 'learning.due-soon' | … */
  kind: string;
  subject: string;
  /** Plain text — обязателен. */
  body: string;
  /** HTML — опционален; рендерит отправитель, ядро хранит снапшот. */
  html?: string;
  locale?: string;
  /** Явный канал; без него — первый зарегистрированный, который знает адрес получателя. */
  channel?: string;
}

/** Сообщение, привязанное к каналу и адресу, — то, что получает `send()` канала. */
export interface ResolvedNotification extends Omit<NotificationMessage, 'channel'> {
  deliveryId: string;
  channel: string;
  address: string;
}

export interface NotificationChannel {
  id: string;
  /** Адресная книга канала: null — получателю этот канал недоступен. */
  resolveAddress(userId: string): Promise<string | null>;
  send(message: ResolvedNotification): Promise<void>;
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
}

export interface NotificationDeliveryListParams {
  status?: NotificationStatus;
  kind?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface BackendNotificationService {
  registerChannel(channel: NotificationChannel): void;
  /** null — канала или адреса нет; это не ошибка вызывающего, решение остаётся за ним. */
  send(message: NotificationMessage): Promise<{ id: string } | null>;
  listDeliveries(params: NotificationDeliveryListParams): Promise<{ items: NotificationDelivery[]; total: number }>;
  /** Ручной повтор: failed → pending (nextAttemptAt = now). true — если строка переведена. */
  retry(id: string): Promise<boolean>;
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
