import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { eq } from 'drizzle-orm';
import { userEmail } from '../schemas/index.js';

/**
 * Адрес электронной почты — вклад модуля в карточку пользователя, рядом с паролем (группа security).
 * Ручные `load`/`save`: сохранение админом — это подтверждение адреса, поэтому `verified_at`
 * вычисляется здесь, а не приходит из формы (`readonly`).
 */
export function extendUserDoc(docs: DocumentRegistry): void {
  docs.objects.extend('user', {
    module: 'notification-email',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.SECURITY]: {} } },
    fields: {
      email: { label: 'notification-email:field_email', widget: 'text', placeholder: 'user@example.com' },
      verifiedAt: { label: 'notification-email:field_verified_at', widget: 'datetime', readonly: true },
    },
    load: async (db, docId) => {
      const [row] = await db.select().from(userEmail).where(eq(userEmail.userId, docId)).limit(1);
      if (!row) return {};
      const { userId, ...rest } = row;
      return rest;
    },
    save: async (tx, id, data) => {
      const { email } = data as { email?: string };
      if (!email) return;

      const normalized = email.trim().toLowerCase();
      const now = new Date();
      await tx
        .insert(userEmail)
        .values({ userId: id, email: normalized, verifiedAt: now })
        .onConflictDoUpdate({
          target: userEmail.userId,
          set: { email: normalized, verifiedAt: now, updatedAt: now },
        });
    },
  });
}
