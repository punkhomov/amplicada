import type { SendBatchResult } from '@amplicada/platform-core/contracts';

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

/** Ответ рассылки — агрегат батча ядра (`sendMany`): queued/skipped/failed/deduped + batchId. */
export type SendNotificationTemplateResponse = SendBatchResult;
