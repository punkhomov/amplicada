import { primaryKey, uuid } from 'drizzle-orm/pg-core';
import { coreSchema } from './_schema.js';
import { identityUser } from './identity-user.js';
import { userGroups } from './user-groups.js';

export const groupUsers = coreSchema.table(
  'group_users',
  {
    groupId: uuid('group_id').references(() => userGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => identityUser.id, { onDelete: 'cascade' }),
  },
  t => [primaryKey({ columns: [t.groupId, t.userId] })],
);
