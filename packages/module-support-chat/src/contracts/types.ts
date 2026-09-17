export type SupportThreadStatus = 'open' | 'closed';
export type SupportAuthorRole = 'user' | 'admin' | 'ai';

export interface SupportMessageDto {
  id: string;
  /** null для ролей без пользователя-автора (ai). */
  authorId: string | null;
  authorRole: SupportAuthorRole;
  body: string;
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
