export type StorageFileKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';

/**
 * Каким проигрывателем открывать файл, решает расширение, а не `Content-Type` из S3: листинг
 * `ListObjectsV2` тип не отдаёт, а делать HEAD на каждую строку списка — это N запросов на папку.
 * Сам тип объекта всё равно приходит в заголовках при просмотре — здесь только выбор плеера.
 */
const KINDS_BY_EXTENSION: Record<string, StorageFileKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  svg: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  ogv: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',
  pdf: 'pdf',
  txt: 'text',
  json: 'text',
  csv: 'text',
  log: 'text',
  md: 'text',
  yml: 'text',
  yaml: 'text',
  xml: 'text',
  // HTML и JS показываем текстом, а не открываем: чужой документ не должен исполниться у нас.
  html: 'text',
  htm: 'text',
  css: 'text',
  js: 'text',
  mjs: 'text',
};

export function storageFileKind(key: string): StorageFileKind {
  const name = key.split('/').pop() ?? key;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'other';
  return KINDS_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'other';
}
