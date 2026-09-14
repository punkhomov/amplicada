import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { DocumentGroups, DocumentPages } from '@amplicada/platform-core/contracts';
import { eq } from 'drizzle-orm';
import { passwordCredential } from '../schemas/index.js';

export function extendUserDoc(docs: DocumentRegistry): void {
  docs.objects.extend('user', {
    module: 'auth-password',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.SECURITY]: {} } },
    fields: {
      passwordHash: { label: 'auth-password:field_password_hash', widget: 'text', readonly: true },
      createdAt: { label: 'auth-password:field_created_at', widget: 'datetime', readonly: true },
    },
    load: async (db, docId) => {
      const [row] = await db.select().from(passwordCredential).where(eq(passwordCredential.userId, docId)).limit(1);
      if (!row) return {};
      const { userId, ...rest } = row;
      return rest;
    },
    save: async (tx, id, data) => {
      const { passwordHash } = data as { passwordHash?: string };
      if (!passwordHash) return;
      await tx.insert(passwordCredential).values({ userId: id, passwordHash }).onConflictDoUpdate({
        target: passwordCredential.userId,
        set: { passwordHash },
      });
    },
  });
}
