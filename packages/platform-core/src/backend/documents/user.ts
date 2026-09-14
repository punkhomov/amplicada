import { desc, eq } from 'drizzle-orm';
import type { DocumentRegistry } from '../../contracts/documents.js';
import { DocumentGroups, DocumentPages, Documents } from '../../contracts/documents.js';
import { authLog, identityUser } from '../schemas/index.js';

export function registerUserDoc(docs: DocumentRegistry): void {
  docs.register(Documents.USER, {
    module: 'core',
    label: 'core:user_label',
    softDelete: true,
  });

  docs.objects.registerPage(DocumentPages.USER_ACCESS, {
    document: Documents.USER,
    label: 'core:page_user_access',
    icon: 'lock',
  });
  docs.objects.registerPage(DocumentPages.USER_LOG, {
    document: Documents.USER,
    label: 'core:page_user_log',
    icon: 'history',
  });

  docs.objects.registerGroup(DocumentGroups.SECURITY, {
    document: Documents.USER,
    page: DocumentPages.DEFAULT,
    label: 'core:group_security',
    order: 1,
  });
  docs.objects.registerGroup(DocumentGroups.ACCESS_RIGHTS, {
    document: '*',
    page: DocumentPages.USER_ACCESS,
    label: 'core:group_access_rights',
    order: 0,
  });
  docs.objects.registerGroup(DocumentGroups.AUTH_LOG, {
    document: Documents.USER,
    page: DocumentPages.USER_LOG,
    label: 'core:group_auth_log',
    order: 0,
  });

  docs.objects.extend(Documents.USER, {
    module: 'core',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      id: { label: 'core:field_id', widget: 'text', readonly: false },
      login: { label: 'core:field_login', widget: 'text' },
      createdAt: {
        label: 'core:field_created_at',
        widget: 'datetime',
        readonly: false,
      },
    },
    schema: identityUser,
    idColumn: 'id',
  });

  docs.lists.extend(Documents.USER, {
    module: 'core',
    schema: identityUser,
    foreignKey: 'id',
    fields: {
      id: { label: 'core:field_id', type: 'text', size: 80 },
      login: { label: 'core:field_login', type: 'text', size: 140 },
      createdAt: { label: 'core:field_created_at', type: 'datetime', size: 200 },
    },
  });

  docs.objects.extend(Documents.USER, {
    module: 'core-auth-log',
    layout: { [DocumentPages.USER_LOG]: { [DocumentGroups.AUTH_LOG]: { rows: [[{ component: 'user-auth-log' }]] } } },
    load: async (db, docId) => {
      const events = await db
        .select({
          id: authLog.id,
          action: authLog.action,
          success: authLog.success,
          reason: authLog.reason,
          ipAddress: authLog.ipAddress,
          userAgent: authLog.userAgent,
          createdAt: authLog.createdAt,
        })
        .from(authLog)
        .where(eq(authLog.userId, docId))
        .orderBy(desc(authLog.createdAt))
        .limit(50);
      return { events };
    },
  });
}
