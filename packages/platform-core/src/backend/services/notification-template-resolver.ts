import { eq } from 'drizzle-orm';
import type { BackendDbService } from '../../contracts/backend/db.js';
import type { NotificationAttachment } from '../../contracts/notification.js';
import { logger } from '../logger.js';
import { notificationTemplate } from '../schemas/index.js';

/** Ссылка на шаблон: документ по id или code-fixture по коду с локалью. */
export type TemplateRef = { id: string } | { code: string; locale?: string };

export interface LoadedTemplate {
  subject: string;
  body: string;
  html: string | null;
  sender: string | null;
  attachments: NotificationAttachment[];
  locale: string | null;
}

const TEMPLATE_COLUMNS = {
  subject: notificationTemplate.subject,
  body: notificationTemplate.body,
  html: notificationTemplate.html,
  sender: notificationTemplate.sender,
  attachments: notificationTemplate.attachments,
  locale: notificationTemplate.locale,
};

/** Локаль: точное совпадение → `ru` → любая доступная. */
export function pickTemplateLocale<T extends { locale: string | null }>(rows: T[], requested?: string): T | null {
  if (!rows.length) return null;
  if (requested) {
    const exact = rows.find(row => row.locale === requested);
    if (exact) return exact;
  }
  const fallbackRu = rows.find(row => row.locale === 'ru');
  if (fallbackRu) return fallbackRu;
  return rows[0] ?? null;
}

/** null — шаблона нет; это не ошибка вызывающего (send → null, sendMany → skipped). */
export async function loadTemplate(db: BackendDbService, ref: TemplateRef, locale?: string): Promise<LoadedTemplate | null> {
  const requested = 'id' in ref ? locale : (ref.locale ?? locale);

  const rows =
    'id' in ref
      ? await db.select(TEMPLATE_COLUMNS).from(notificationTemplate).where(eq(notificationTemplate.id, ref.id)).limit(1)
      : await db.select(TEMPLATE_COLUMNS).from(notificationTemplate).where(eq(notificationTemplate.code, ref.code));

  const picked = pickTemplateLocale(rows, requested);
  if (!picked) {
    logger.warn({ ref }, 'Шаблон уведомления не найден');
    return null;
  }
  if (requested && picked.locale !== requested) {
    logger.warn({ ref, requested, picked: picked.locale }, 'Шаблон уведомления: локаль подменена фолбэком');
  }

  return {
    subject: picked.subject,
    body: picked.body,
    html: picked.html,
    sender: picked.sender,
    attachments: picked.attachments,
    locale: picked.locale,
  };
}
