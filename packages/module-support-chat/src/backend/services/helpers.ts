import type { SupportAuthorRole, SupportCloseReason, SupportResolvedBy, SupportThreadStatus } from '../../contracts/index.js';

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

/** Сообщение пользователя возвращает обращение в работу из любого «закрытого» состояния. */
export function statusAfterUserMessage(_status: SupportThreadStatus): SupportThreadStatus {
  return 'open';
}

/** Ответ поддержки переоткрывает решённое/закрытое обращение; pending остаётся ожиданием пользователя. */
export function statusAfterAdminMessage(status: SupportThreadStatus): SupportThreadStatus {
  return status === 'solved' || status === 'closed' ? 'open' : status;
}

/** Пользователь сам закрывает своё обращение (кроме уже закрытого) и переоткрывает закрытое/решённое. */
export function canUserSetStatus(current: SupportThreadStatus, next: 'open' | 'closed'): boolean {
  if (current === next) return false;
  return current !== 'closed' || next === 'open';
}

export interface LifecycleState {
  status: SupportThreadStatus;
  resolvedAt: Date | null;
}

export interface LifecyclePatch {
  status: SupportThreadStatus;
  resolvedBy: SupportResolvedBy | null;
  closeReason: SupportCloseReason | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

/**
 * Поля жизненного цикла при смене статуса: закрытие фиксирует кто/почему, решение — момент,
 * возврат в работу очищает атрибуты закрытия (метрики потом читают историю сообщений, не только статус).
 */
export function lifecyclePatch(
  current: LifecycleState,
  next: SupportThreadStatus,
  actor: SupportResolvedBy,
  reason: SupportCloseReason | null,
  now: Date,
): LifecyclePatch {
  if (next === 'open' || next === 'pending') {
    return { status: next, resolvedBy: null, closeReason: null, resolvedAt: null, closedAt: null };
  }
  if (next === 'solved') {
    return { status: next, resolvedBy: actor, closeReason: null, resolvedAt: now, closedAt: null };
  }
  return {
    status: next,
    resolvedBy: actor,
    closeReason: reason ?? 'resolved',
    resolvedAt: current.resolvedAt ?? now,
    closedAt: now,
  };
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
