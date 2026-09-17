import { extname } from 'node:path';
import type { SupportAttachmentUploadDto } from '../../contracts/index.js';

/** Корень всех объектов модуля в бакете. */
export const SUPPORT_CHAT_ATTACHMENTS_PREFIX = 'support-chat';
/** Потолок на файл в чате: переписка — не файлохранилище, 10 МБ хватает скриншотам и документам. */
export const SUPPORT_CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Префикс ключей, которые вправе загружать и прикладывать пользователь. */
export function userAttachmentPrefix(userId: string): string {
  return `${SUPPORT_CHAT_ATTACHMENTS_PREFIX}/${userId}`;
}

/**
 * Имя файла для показа и скачивания: от исходного остаётся только последний сегмент
 * (браузеры умеют присылать путь целиком), управляющие символы вырезаются, длина ограничена.
 * `null` — имя непригодно, вызывающий отвечает 400.
 */
export function sanitizeAttachmentName(raw: string | undefined): string | null {
  const base = (raw ?? '').replace(/\\/g, '/').split('/').pop()?.trim();
  if (!base) return null;

  // biome-ignore lint/suspicious/noControlCharactersInRegex: вырезаем именно управляющие символы
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').slice(0, 200);
  if (!cleaned || cleaned === '.' || cleaned === '..') return null;
  return cleaned;
}

/** Ключ объекта: `<префикс>/<uuid><расширение>` — расширение сохраняем, имя в ключ не тащим. */
export function buildAttachmentKey(prefix: string, id: string, name: string): string {
  const extension = extname(name).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
  return `${prefix}/${id}${safeExtension}`;
}

/**
 * Проверка ключа из тела запроса: прикладывать можно только объекты из «своих» префиксов.
 * Хвост обязан быть нашим uuid'ом (с необязательным расширением) — так в сообщение нельзя
 * протащить чужой объект бакета или ключ с сегментами вроде `../`.
 */
export function isAttachmentKeyAllowed(key: string, allowedPrefixes: string[]): boolean {
  return allowedPrefixes.some(prefix => {
    if (!key.startsWith(`${prefix}/`)) return false;
    const tail = key.slice(prefix.length + 1);
    return /^[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/.test(tail);
  });
}

/** Разбор вложения из JSON-тела запроса; неполный или подделанный объект — `null`. */
export function parseAttachmentInput(value: unknown): SupportAttachmentUploadDto | null {
  if (!value || typeof value !== 'object') return null;
  const { key, name, mime, size } = value as Record<string, unknown>;
  if (typeof key !== 'string' || !key) return null;
  if (typeof name !== 'string' || !name || name.length > 200) return null;
  if (typeof mime !== 'string') return null;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0 || size > SUPPORT_CHAT_ATTACHMENT_MAX_BYTES) return null;
  return { key, name, mime: mime || 'application/octet-stream', size: Math.round(size) };
}
