import { eq } from 'drizzle-orm';
import type { DocumentRegistry } from '../../contracts/documents.js';
import { DocumentGroups, DocumentPages, Documents } from '../../contracts/documents.js';
import { groupUsers, identityUser, userGroups } from '../schemas/index.js';

export function registerUserGroupDoc(docs: DocumentRegistry): void {
  docs.register(Documents.USER_GROUP, {
    module: 'core',
    label: 'core:user_group_label',
    softDelete: true,
  });

  docs.objects.registerGroup(DocumentGroups.MEMBERS, {
    document: Documents.USER_GROUP,
    page: DocumentPages.DEFAULT,
    label: 'core:group_members',
    order: 1,
  });

  docs.objects.extend(Documents.USER_GROUP, {
    module: 'core',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.DEFAULT]: {} } },
    fields: {
      id: { label: 'core:field_id', widget: 'text', readonly: true },
      name: { label: 'core:field_name', widget: 'text' },
      description: { label: 'core:field_description', widget: 'text' },
      createdAt: { label: 'core:field_created_at', widget: 'datetime', readonly: true },
    },
    schema: userGroups,
    idColumn: 'id',
  });

  docs.lists.extend(Documents.USER_GROUP, {
    module: 'core',
    schema: userGroups,
    foreignKey: 'id',
    fields: {
      id: { label: 'core:field_id', type: 'text', size: 80 },
      name: { label: 'core:field_name', type: 'text', size: 240 },
      createdAt: { label: 'core:field_created_at', type: 'datetime', size: 200 },
    },
  });

  docs.objects.extend(Documents.USER_GROUP, {
    module: 'core-members',
    layout: { [DocumentPages.DEFAULT]: { [DocumentGroups.MEMBERS]: { rows: [[{ component: 'user-group-members' }]] } } },
    load: async (db, docId) => {
      const rows = await db
        .select({ userId: groupUsers.userId, login: identityUser.login })
        .from(groupUsers)
        .innerJoin(identityUser, eq(groupUsers.userId, identityUser.id))
        .where(eq(groupUsers.groupId, docId));
      return { members: rows };
    },
  });
}
