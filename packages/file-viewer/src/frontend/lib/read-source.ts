import type { FileSource, TextReadResult } from '../../contracts/index.js';
import { utf8CompletePrefix } from './utf8.js';

/** Читает файл целиком. За авторизацию URL отвечает потребитель: сессионная кука уходит на same-origin. */
export async function readSourceBytes(source: FileSource): Promise<ArrayBuffer> {
  if (source.type === 'url') {
    const response = await fetch(source.url, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${source.url}`);
    return response.arrayBuffer();
  }
  const blob = source.type === 'file' ? source.file : source.blob;
  return blob.arrayBuffer();
}

export interface ReadSourceTextOptions {
  /** Максимум байт за одно окно. */
  limitBytes: number;
  /** Смещение начала окна в файле, байт. */
  offsetBytes: number;
}

/**
 * Читает окно текста `[offsetBytes, offsetBytes + limitBytes)`.
 *
 * Хвост окна, разрезавший многобайтный символ, отбрасывается, а `nextOffsetBytes`
 * указывает на его начало: следующий вызов дочитает символ целиком — без пропусков,
 * дублей и `U+FFFD` на стыке. `truncated` — «после этого окна остались байты».
 */
export async function readSourceText(source: FileSource, { limitBytes, offsetBytes }: ReadSourceTextOptions): Promise<TextReadResult> {
  if (source.type === 'url') {
    const response = await fetch(source.url, {
      credentials: 'include',
      headers: { Range: `bytes=${offsetBytes}-${offsetBytes + limitBytes - 1}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // На Range со смещением сервер обязан ответить 206/Content-Range. 200 значит, что Range
    // проигнорирован и тело начинается с нуля: догрузка вклеила бы весь файл заново.
    if (offsetBytes > 0 && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    // Байты, а не .text(): границу кодовой точки ищем сами, иначе разрезанный символ
    // станет U+FFFD ещё до нашей логики.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const total = contentRangeTotal(response.headers.get('content-range')) ?? source.size;
    const truncated = total !== undefined ? offsetBytes + bytes.length < total : bytes.length >= limitBytes;
    return windowResult(bytes, offsetBytes, truncated);
  }

  const local = source.type === 'file' ? source.file : source.blob;
  const end = offsetBytes + limitBytes;
  const bytes = new Uint8Array(await local.slice(offsetBytes, end).arrayBuffer());
  return windowResult(bytes, offsetBytes, local.size > end);
}

/** Декодирует окно по границе кодовой точки; `nextOffsetBytes` — только пока есть что дочитывать. */
function windowResult(bytes: Uint8Array, offsetBytes: number, truncated: boolean): TextReadResult {
  const decoder = new TextDecoder();
  const complete = utf8CompletePrefix(bytes);
  if (!truncated) {
    // Последнее окно: незавершённый хвост уже некому дочитать — U+FFFD честнее потери.
    return { text: decoder.decode(bytes), truncated: false };
  }
  if (complete === 0 && bytes.length > 0) {
    // Окно открывается невалидным байтом, и `utf8CompletePrefix` на нём замирает: без
    // принудительного шага «Показать ещё» запрашивало бы тот же offset бесконечно.
    // Уступаем один байт как U+FFFD — файл всё равно битый, зато offset строго растёт.
    return { text: decoder.decode(bytes.subarray(0, 1)), truncated: true, nextOffsetBytes: offsetBytes + 1 };
  }
  return { text: decoder.decode(bytes.subarray(0, complete)), truncated: true, nextOffsetBytes: offsetBytes + complete };
}

/** `Content-Range: bytes 0-1023/98765` → 98765. */
function contentRangeTotal(header: string | null): number | undefined {
  const total = header?.split('/')[1];
  if (!total || total === '*') return undefined;
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : undefined;
}
