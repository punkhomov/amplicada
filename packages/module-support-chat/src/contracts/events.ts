import type { SupportAuthorRole, SupportThreadStatus } from './types.js';

export const SUPPORT_CHAT_EVENTS = {
  MESSAGE_CREATED: 'support-chat.message.created',
  THREAD_UPDATED: 'support-chat.thread.updated',
} as const;

export const SUPPORT_CHAT_EVENTS_CHANNEL = 'support-chat:events';

export const SUPPORT_CHAT_MESSAGE_MAX_LENGTH = 4000;

export interface SupportChatEventPayload {
  threadId: string;
  /** Владелец треда — по нему SSE пользователя фильтрует события. */
  userId: string;
  authorRole: SupportAuthorRole;
  status: SupportThreadStatus;
  messageId?: string;
}
