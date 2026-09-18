import { boolean, text, timestamp } from 'drizzle-orm/pg-core';
import { supportChatSchema } from './_schema.js';

/** Синглтон-настройки поддержки: строка всегда одна (`id = 'default'`). */
export const supportChatSettings = supportChatSchema.table('settings', {
  id: text('id').primaryKey().default('default'),
  aiEnabled: boolean('ai_enabled').notNull().default(false),
  aiProvider: text('ai_provider'),
  aiModel: text('ai_model'),
  aiSystemPrompt: text('ai_system_prompt'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SupportChatSettingsRow = typeof supportChatSettings.$inferSelect;
