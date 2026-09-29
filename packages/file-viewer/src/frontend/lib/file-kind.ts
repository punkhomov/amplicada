import type { FileDescriptor, FileKind } from '../../contracts/index.js';

const KINDS_BY_MIME: Record<string, FileKind> = {
  'application/pdf': 'pdf',
  'application/json': 'text',
  'application/xml': 'text',
  'application/x-yaml': 'text',
  'application/yaml': 'text',
  'application/javascript': 'text',
  'application/typescript': 'text',
  'application/sql': 'text',
  'image/svg+xml': 'image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-word.document.macroEnabled.12': 'word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12': 'spreadsheet',
};

const KINDS_BY_EXTENSION: Record<string, FileKind> = {
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
  docx: 'word',
  docm: 'word',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
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

export function fileExtension(name: string): string {
  const base = name.split('/').pop()?.split('\\').pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Тип файла. `mime` главнее расширения (у blob/file он есть и точнее), но у листинга S3 типа
 * нет — тогда решает расширение.
 */
export function fileKindOf(descriptor: FileDescriptor): FileKind {
  const mime = descriptor.mime?.split(';')[0].trim().toLowerCase();
  if (mime) {
    if (KINDS_BY_MIME[mime]) return KINDS_BY_MIME[mime];
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('text/')) return 'text';
  }
  return KINDS_BY_EXTENSION[fileExtension(descriptor.name)] ?? 'other';
}
