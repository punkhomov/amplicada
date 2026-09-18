import type { SupportAuthorRole, SupportThreadStatus } from '../../contracts/index.js';

export interface SupportMessageLike {
  authorRole: SupportAuthorRole;
  createdAt: Date;
}

export function countUnread(messages: SupportMessageLike[], readerRole: SupportAuthorRole, lastReadAt: Date | null): number {
  return messages.filter(message => {
    if (message.authorRole === readerRole) return false;
    // Поддержка ждёт ответа только от пользователя: ответы ai не считаются непрочитанными.
    if (readerRole === 'admin' && message.authorRole !== 'user') return false;
    return !lastReadAt || message.createdAt > lastReadAt;
  }).length;
}

export function statusAfterUserMessage(status: SupportThreadStatus): SupportThreadStatus {
  return status === 'closed' ? 'open' : status;
}

export function previewText(body: string, limit = 120): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

/** Превью для списков: текст, а если его нет — имя вложения. */
export function previewMessage(body: string, attachmentName: string | null): string {
  return body.trim() ? previewText(body) : (attachmentName ?? '');
}

/** Логины поддержки, отвечавшей в треде: «кто со мной переписывался». */
export function collectParticipants(messages: Array<{ authorRole: SupportAuthorRole; authorLogin: string | null }>): string[] {
  const logins = new Set<string>();
  for (const message of messages) {
    if (message.authorRole === 'admin' && message.authorLogin) logins.add(message.authorLogin);
  }
  return [...logins];
}
