export type SupportThreadStatus = 'open' | 'pending' | 'solved' | 'closed';
export type SupportThreadKind = 'question' | 'incident';
export type SupportIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SupportResolvedBy = 'user' | 'admin' | 'ai';
export type SupportCloseReason = 'resolved' | 'not_relevant' | 'duplicate';
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
  kind: SupportThreadKind;
  severity: SupportIncidentSeverity | null;
  /** Связанный инцидент для обращений-дублей. */
  incidentThreadId: string | null;
  resolvedBy: SupportResolvedBy | null;
  closeReason: SupportCloseReason | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  messages: SupportMessageDto[];
}

/** Строка списка «Мои обращения»: без сообщений, но со сводкой по ним. */
export interface SupportUserThreadSummaryDto {
  id: string;
  status: SupportThreadStatus;
  kind: SupportThreadKind;
  severity: SupportIncidentSeverity | null;
  incidentThreadId: string | null;
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
  kind: SupportThreadKind;
  severity: SupportIncidentSeverity | null;
  incidentThreadId: string | null;
  /** Отвечала ли уже поддержка: разделяет «вопросы» и «обращения» в списке. */
  hasSupportReply: boolean;
  updatedAt: string;
  unreadCount: number;
  lastMessagePreview: string | null;
}

export interface SupportAdminThreadDetailDto {
  thread: SupportThreadDto;
  userId: string;
  userLogin: string;
  /** Обращения, привязанные к этому инциденту. */
  linkedThreads: Array<{ id: string; userLogin: string; status: SupportThreadStatus }>;
}

/** Действия пользователя над своим обращением: закрыть или переоткрыть. */
export interface SupportUserStatusPatch {
  status: 'open' | 'closed';
  closeReason?: SupportCloseReason;
}

/** Что поддержка может менять в обращении: статус, вид и привязку к инциденту. */
export interface SupportAdminThreadPatch {
  status?: SupportThreadStatus;
  closeReason?: SupportCloseReason;
  kind?: SupportThreadKind;
  severity?: SupportIncidentSeverity | null;
  incidentThreadId?: string | null;
}

/** Провайдеры, из которых можно выбрать ассистента (ответчик появится вместе с AI-модулем). */
export const SUPPORT_AI_PROVIDERS = ['openai', 'anthropic', 'google', 'local'] as const;
export type SupportAiProvider = (typeof SUPPORT_AI_PROVIDERS)[number];

export interface SupportSettingsDto {
  aiEnabled: boolean;
  aiProvider: SupportAiProvider | null;
  aiModel: string | null;
  aiSystemPrompt: string | null;
  updatedAt: string;
}

export interface SupportSettingsPatch {
  aiEnabled?: boolean;
  aiProvider?: SupportAiProvider | null;
  aiModel?: string | null;
  aiSystemPrompt?: string | null;
}
