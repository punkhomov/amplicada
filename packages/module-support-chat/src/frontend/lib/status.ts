import type { SupportThreadStatus } from '../../contracts/index.js';

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
