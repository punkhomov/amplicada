export type SupportThreadStatus = 'open' | 'closed';
export type SupportAuthorRole = 'user' | 'admin' | 'ai';

export interface SupportAttachmentDto {
  name: string;
  mime: string;
  size: number;
}

/** Ответ на загрузку файла: `key` — токен, который передаётся при отправке сообщения. */
export interface SupportAttachmentUploadDto extends SupportAttachmentDto {
  key: string;
}

export interface SupportMessageDto {
  id: string;
  /** null для ролей без пользователя-автора (ai). */
  authorId: string | null;
  /** Логин автора; null, когда автора-пользователя нет (ai). */
  authorLogin: string | null;
  authorRole: SupportAuthorRole;
  body: string;
  attachment: SupportAttachmentDto | null;
  createdAt: string;
}

export interface SupportThreadDto {
  id: string;
  status: SupportThreadStatus;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  messages: SupportMessageDto[];
}

/** Строка списка «Мои обращения»: без сообщений, но со сводкой по ним. */
export interface SupportUserThreadSummaryDto {
  id: string;
  status: SupportThreadStatus;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  messageCount: number;
  lastMessagePreview: string | null;
  /** Логины поддержки, которые отвечали в этом обращении. */
  participants: string[];
}

export interface SupportAdminThreadDto {
  id: string;
  userId: string;
  userLogin: string;
  status: SupportThreadStatus;
  updatedAt: string;
  unreadCount: number;
  lastMessagePreview: string | null;
}

export interface SupportAdminThreadDetailDto {
  thread: SupportThreadDto;
  userId: string;
  userLogin: string;
}
