import { date, uuid, varchar } from 'drizzle-orm/pg-core';
import { hrSchema } from './_schema.js';

export const hrVirtualTeamNode = hrSchema.table('virtual_team_node', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  // Бизнес-даты команды как проекта — не путать с validFrom/validTo версии (период действия конфигурации).
  projectStartDate: date('project_start_date'),
  projectEndDate: date('project_end_date'),
});

export type HrVirtualTeamNode = typeof hrVirtualTeamNode.$inferSelect;
export type NewHrVirtualTeamNode = typeof hrVirtualTeamNode.$inferInsert;
