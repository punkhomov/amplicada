import { extensionOf } from '../archive/paths.js';

/**
 * Тип содержимого считается один раз — при распаковке — и ложится в `package_files.content_type`.
 * При отдаче он берётся оттуда и НЕ сниффится: в прокси-режиме MIME задаём мы, и это снимает
 * самую частую причину «SCORM не работает» (см. 00-overview, «Чем мы отличаемся»).
 *
 * Список одновременно служит whitelist'ом: расширения вне его в бакет не попадают.
 */
const CONTENT_TYPES: Record<string, string> = {
  // Разметка и код курса
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  xsd: 'application/xml; charset=utf-8',
  // `.dtd` ездит вместе с `.xsd`: сборщики кладут в пакет схемы, на которые ссылается манифест
  // (`XMLSchema.dtd`, `datatypes.dtd` рядом с `imscp_rootv1p1p2.xsd`). В корпусе такие файлы у
  // 6 пакетов из 209 — и без этой строки все шесть отвергались целиком.
  dtd: 'application/xml-dtd',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  // Изображения
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  // Медиа
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  // Шрифты
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  // Документы (в основном для kind='file')
  pdf: 'application/pdf',
  // Описатели AICC: текстовые файлы с собственными расширениями. Без них AICC-пакет отвергался бы
  // на проверке расширений ещё до того, как его успели бы опознать.
  crs: 'text/plain; charset=utf-8',
  au: 'text/plain; charset=utf-8',
  des: 'text/plain; charset=utf-8',
  cst: 'text/plain; charset=utf-8',
  ort: 'text/plain; charset=utf-8',
  pre: 'text/plain; charset=utf-8',
  cmp: 'text/plain; charset=utf-8',
};

export const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

/**
 * `undefined` — расширение не в whitelist. При распаковке это повод отвергнуть файл,
 * при отдаче (если что-то всё же просочилось) — отдать как `application/octet-stream` вложением.
 *
 * `.swf` в списке нет намеренно: Flash мёртв, а исполняемый контент в пакете нам не нужен.
 */
export function contentTypeFor(path: string): string | undefined {
  return CONTENT_TYPES[extensionOf(path)];
}

export function isAllowedPackageFile(path: string): boolean {
  return contentTypeFor(path) !== undefined;
}
