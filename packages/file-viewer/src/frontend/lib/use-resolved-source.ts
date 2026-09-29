import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileDescriptor, FileSource, TextReadResult } from '../../contracts/index.js';
import { readSourceBytes } from './read-source.js';

export const DEFAULT_TEXT_PREVIEW_LIMIT = 512 * 1024;

export interface ResolvedSource {
  descriptor: FileDescriptor;
  /** `null`, пока object URL для `file`/`blob` ещё не создан. */
  url: string | null;
  readText(options?: { limitBytes?: number }): Promise<TextReadResult>;
  readBytes(): Promise<ArrayBuffer>;
  openExternal(): void;
}

function nameFromUrl(url: string): string {
  const withoutQuery = url.split('?')[0]?.split('#')[0] ?? url;
  const segment = withoutQuery.split('/').pop() ?? '';
  try {
    return decodeURIComponent(segment) || url;
  } catch {
    return segment || url;
  }
}

/**
 * Приводит `FileSource` к единому виду: дескриптор, URL и чтение текста.
 *
 * `file`/`blob` живут в object URL, который создаётся и отзывается вместе с источником.
 * URL-источники читаются через `fetch` с `Range`; за авторизацию отвечает потребитель —
 * сессионная кука уходит на same-origin автоматически.
 */
export function useResolvedSource(source: FileSource | null): ResolvedSource | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  const blob = useMemo<Blob | null>(() => {
    if (!source) return null;
    if (source.type === 'file') return source.file;
    if (source.type === 'blob') return source.blob;
    return null;
  }, [source]);

  useEffect(() => {
    if (!blob) {
      setObjectUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setObjectUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  const descriptor = useMemo<FileDescriptor>(() => {
    if (!source) return { name: '' };
    if (source.type === 'url') {
      return { name: source.name ?? nameFromUrl(source.url), mime: source.mime, size: source.size };
    }
    if (source.type === 'file') {
      return { name: source.file.name, mime: source.file.type || undefined, size: source.file.size };
    }
    return { name: source.name, mime: source.mime ?? (source.blob.type || undefined), size: source.size ?? source.blob.size };
  }, [source]);

  const url = source?.type === 'url' ? source.url : objectUrl;

  const readText = useCallback(
    async ({ limitBytes = DEFAULT_TEXT_PREVIEW_LIMIT }: { limitBytes?: number } = {}): Promise<TextReadResult> => {
      if (!source) throw new Error('Источник не задан');

      if (source.type === 'url') {
        const response = await fetch(source.url, {
          credentials: 'include',
          headers: { Range: `bytes=0-${Math.max(0, limitBytes - 1)}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        const total = contentRangeTotal(response.headers.get('content-range')) ?? descriptor.size;
        return { text, truncated: total !== undefined ? total > limitBytes : text.length >= limitBytes };
      }

      const local = source.type === 'file' ? source.file : source.blob;
      if (local.size > limitBytes) {
        return { text: await local.slice(0, limitBytes).text(), truncated: true };
      }
      return { text: await local.text(), truncated: false };
    },
    [source, descriptor.size],
  );

  const readBytes = useCallback((): Promise<ArrayBuffer> => {
    if (!source) return Promise.reject(new Error('Источник не задан'));
    return readSourceBytes(source);
  }, [source]);

  const openExternal = useCallback(() => {
    const target = url ?? (source?.type === 'url' ? source.url : null);
    if (target) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    if (source && (source.type === 'file' || source.type === 'blob')) {
      // Object URL ещё не готов — открываем временный и отпускаем его с запасом.
      const temp = URL.createObjectURL(source.type === 'file' ? source.file : source.blob);
      window.open(temp, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(temp), 60_000);
    }
  }, [url, source]);

  if (!source) return null;
  return { descriptor, url, readText, readBytes, openExternal };
}

/** Имя источника без его разрешения — для шапки диалога. */
export function sourceName(source: FileSource | null): string {
  if (!source) return '';
  if (source.type === 'url') return source.name ?? nameFromUrl(source.url);
  if (source.type === 'file') return source.file.name;
  return source.name;
}

export function sourceSize(source: FileSource | null): number | undefined {
  if (!source) return undefined;
  if (source.type === 'url') return source.size;
  if (source.type === 'file') return source.file.size;
  return source.size ?? source.blob.size;
}

/**
 * Открыть источник в новой вкладке, не дожидаясь рендерера. Для `file`/`blob` создаётся
 * временный object URL и отпускается с запасом — окно ещё должно успеть его загрузить.
 */
export function openSourceExternal(source: FileSource | null): void {
  if (!source) return;
  if (source.type === 'url') {
    window.open(source.url, '_blank', 'noopener,noreferrer');
    return;
  }
  const blob = source.type === 'file' ? source.file : source.blob;
  const temp = URL.createObjectURL(blob);
  window.open(temp, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(temp), 60_000);
}

/** `Content-Range: bytes 0-1023/98765` → 98765. */
function contentRangeTotal(header: string | null): number | undefined {
  const total = header?.split('/')[1];
  if (!total || total === '*') return undefined;
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : undefined;
}
