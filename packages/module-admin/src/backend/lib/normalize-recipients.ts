import { ADMIN_BROADCAST_MAX_RECIPIENTS } from '../../contracts/notification-template.js';

/**
 * Нормализация списка получателей рассылки: только непустые uuid, без дублей, с потолком.
 * Потолок — защита от случайной рассылки на всю базу: `send()` создаёт по строке outbox на каждого.
 * Не-uuid отбрасываются здесь: получатель — id документа `user`, иначе запрос канала упадёт на касте.
 */
export function normalizeRecipients(userIds: unknown, max = ADMIN_BROADCAST_MAX_RECIPIENTS): string[] {
  if (!Array.isArray(userIds)) return [];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of userIds) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || seen.has(id) || !isUuid(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= max) break;
  }
  return unique;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Строковый id документа в форме uuid — чтобы не гонять заведомо невалидный id в SQL. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
