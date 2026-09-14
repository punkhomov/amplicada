import { ApiError, i18n } from '@amplicada/platform-core/frontend';
import type { PackageAccepted } from '../../../../contracts/index.js';

export interface UploadOptions {
  /** `ApiClient.baseUrl` — путь строится от него, чтобы не разъехаться с остальными запросами. */
  baseUrl: string;
  courseId: string;
  file: File;
  /** Доля отправленного, 0..1. `null` — длину сообщить нечем, полосу рисовать не по чему. */
  onProgress?: (fraction: number | null) => void;
  signal?: AbortSignal;
}

/**
 * Заливка пакета — единственный запрос модуля мимо `ApiClient`, на `XMLHttpRequest`.
 *
 * Причина одна: **прогресс**. `fetch` не сообщает, сколько отправлено, а курс с видео — это сотни
 * мегабайт; полоса «идёт загрузка» без чисел на таком файле бесполезна, а `ReadableStream` в теле
 * запроса требует HTTP/2 и поддержан не везде. Всё остальное поведение повторяет клиента: cookie
 * сессии, язык, разбор `{ error }` и тот же `ApiError` наружу — чтобы вызывающий не разбирал две
 * разные ошибки.
 */
export function uploadPackage({ baseUrl, courseId, file, onProgress, signal }: UploadOptions): Promise<PackageAccepted> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));

    const form = new FormData();
    form.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${baseUrl}/learning/courses/${encodeURIComponent(courseId)}/packages`);
    // Сессия у нас в cookie; без этого запрос уйдёт анонимным и получит 401.
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept-Language', i18n.resolvedLanguage ?? i18n.language);
    // Content-Type не ставим намеренно: его выставляет сам браузер вместе с boundary,
    // а заданный руками boundary затрёт и multipart развалится на сервере.

    xhr.upload.addEventListener('progress', event => {
      onProgress?.(event.lengthComputable ? event.loaded / event.total : null);
    });

    xhr.addEventListener('load', () => {
      const payload = parseBody(xhr);
      if (xhr.status >= 200 && xhr.status < 300) return resolve(payload as PackageAccepted);
      reject(new ApiError(xhr.status, messageOf(payload) ?? `Загрузка не удалась: ${xhr.status}`, payload));
    });

    // Сюда же приходит обрыв связи на середине заливки — сообщение браузер не даёт, поэтому своё.
    xhr.addEventListener('error', () => reject(new ApiError(0, 'Не удалось отправить файл — соединение оборвалось', null)));
    xhr.addEventListener('abort', () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')));

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

function parseBody(xhr: XMLHttpRequest): unknown {
  if (!xhr.getResponseHeader('content-type')?.includes('application/json')) return xhr.responseText || null;
  try {
    return JSON.parse(xhr.responseText);
  } catch {
    return null;
  }
}

/** Те же две формы, что разбирает `ApiClient`: `{ message }` у Fastify, `{ error }` у наших роутов. */
function messageOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  for (const key of ['message', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}
