import type { SupportThreadDto, SupportThreadStatus } from '../../contracts/index.js';

/** Цвет бейджа статуса: в работе — заметный, ожидание — вторичное, финал — спокойное. */
export function statusBadgeVariant(status: SupportThreadStatus): 'default' | 'secondary' | 'outline' {
  switch (status) {
    case 'open':
      return 'default';
    case 'pending':
      return 'outline';
    case 'solved':
      return 'secondary';
    default:
      return 'secondary';
  }
}

/** Активные обращения — те, что ещё требуют чьего-то хода. */
export function isActiveStatus(status: SupportThreadStatus): boolean {
  return status === 'open' || status === 'pending';
}

/** «Закрыто · пользователем · Вопрос решён» для шапки и системной строки в ленте. */
export function lifecycleNote(thread: Pick<SupportThreadDto, 'status' | 'resolvedBy' | 'closeReason'>, t: (key: string) => string): string {
  if (thread.status !== 'solved' && thread.status !== 'closed') return '';
  return [
    thread.status === 'closed' ? t('portal_closed_note') : t('portal_resolved_note'),
    thread.resolvedBy ? t(`resolved_by_${thread.resolvedBy}`) : null,
    thread.closeReason ? t(`close_reason_${thread.closeReason}`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
