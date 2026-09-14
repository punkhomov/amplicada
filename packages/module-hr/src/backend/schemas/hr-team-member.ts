import { date, integer, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';
import { hrVirtualTeamNode } from './hr-virtual-team-node.js';

export const hrTeamMember = hrSchema.table('team_member', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamNodeId: uuid('team_node_id')
    .notNull()
    .references(() => hrVirtualTeamNode.id),
  userId: uuid('user_id').notNull(),
  roleInTeam: varchar('role_in_team', { length: 100 }),
  participationPercent: integer('participation_percent'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
});

export type HrTeamMember = typeof hrTeamMember.$inferSelect;
export type NewHrTeamMember = typeof hrTeamMember.$inferInsert;
