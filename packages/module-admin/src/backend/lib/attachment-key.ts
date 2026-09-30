import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

/** Всё, что не буква/цифра/`_`, точка, скобки, пробел или дефис, схлопывается в `_`. */
const UNSAFE = /[^\w.() -]+/g;

/**
 * Ключ вложения шаблона: `notification-templates/<templateId>/<uuid>-<safe-name>`.
 * basename отсекает пути, uuid исключает коллизии одинаковых имён.
 */
export function buildAttachmentKey(templateId: string, filename: string): string {
  const safe = basename(filename).replace(UNSAFE, '_') || 'file';
  return `notification-templates/${templateId}/${randomUUID()}-${safe}`;
}
