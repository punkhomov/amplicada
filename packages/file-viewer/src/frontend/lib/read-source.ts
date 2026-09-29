import type { FileSource } from '../../contracts/index.js';

/** Читает файл целиком. За авторизацию URL отвечает потребитель: сессионная кука уходит на same-origin. */
export async function readSourceBytes(source: FileSource): Promise<ArrayBuffer> {
  if (source.type === 'url') {
    const response = await fetch(source.url, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const blob = source.type === 'file' ? source.file : source.blob;
  return blob.arrayBuffer();
}
