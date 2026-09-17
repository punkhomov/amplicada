import type { SupportAttachmentUploadDto, SupportAuthorRole, SupportMessageDto, SupportThreadStatus } from './types.js';

export interface SupportChatAppendMessageInput {
  threadId: string;
  authorRole: SupportAuthorRole;
  body: string;
  authorId?: string | null;
  attachment?: SupportAttachmentUploadDto | null;
}

export interface SupportChatThreadMessagesDto {
  threadId: string;
  status: SupportThreadStatus;
  messages: SupportMessageDto[];
}

/**
 * Публичный backend-сервис модуля (токен `support-chat`). Точка подключения
 * будущих ответчиков (например, AI-провайдера): `appendMessage` пишет сообщение
 * от произвольной роли и сам публикует SSE-события.
 */
export interface SupportChatBackendService {
  appendMessage(input: SupportChatAppendMessageInput): Promise<SupportMessageDto>;
  getThreadMessages(threadId: string): Promise<SupportChatThreadMessagesDto>;
}
