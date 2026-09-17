/** Типы документов, которыми владеет module-admin. */
export const AdminDocuments = {
  NOTIFICATION_TEMPLATE: 'notification-template',
} as const;

export type AdminDocumentId = (typeof AdminDocuments)[keyof typeof AdminDocuments];

/** kind ручной рассылки из админки — отличает её от писем auth/workflow в логе доставок. */
export const ADMIN_BROADCAST_KIND = 'admin.broadcast';

/** Потолок получателей одного запуска: защита от случайной рассылки на всю базу. */
export const ADMIN_BROADCAST_MAX_RECIPIENTS = 200;

export interface SendNotificationTemplateRequest {
  templateId: string;
  userIds: string[];
}

export interface SendNotificationTemplateResponse {
  /** Уникальных получателей после нормализации. */
  total: number;
  /** Строк outbox создано (канал и подтверждённый адрес найдены). */
  queued: number;
  /** Получателей без канала/адреса — send() вернул null, это не ошибка. */
  skipped: number;
  /** Неожиданные ошибки отправки (БД/резолв адреса); подробности — в логе сервера. */
  failed: number;
}
