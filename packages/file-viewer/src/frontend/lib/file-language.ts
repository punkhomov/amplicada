import type { FileDescriptor } from '../../contracts/index.js';
import { fileExtension } from './file-kind.js';

/** Расширение/mime → идентификатор языка Monaco. Неизвестное — `plaintext`. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  php: 'php',
  cs: 'csharp',
  cpp: 'cpp',
  cc: 'cpp',
  c: 'c',
  h: 'c',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  env: 'ini',
  log: 'plaintext',
  csv: 'plaintext',
  txt: 'plaintext',
};

const LANGUAGE_BY_MIME: Record<string, string> = {
  'application/json': 'json',
  'application/xml': 'xml',
  'application/xhtml+xml': 'xml',
  'application/javascript': 'javascript',
  'application/typescript': 'typescript',
  'application/x-yaml': 'yaml',
  'application/yaml': 'yaml',
  'text/html': 'html',
  'text/css': 'css',
  'text/markdown': 'markdown',
  'text/xml': 'xml',
};

export function monacoLanguageOf(descriptor: FileDescriptor): string {
  const mime = descriptor.mime?.split(';')[0].trim().toLowerCase();
  if (mime && LANGUAGE_BY_MIME[mime]) return LANGUAGE_BY_MIME[mime];
  return LANGUAGE_BY_EXTENSION[fileExtension(descriptor.name)] ?? 'plaintext';
}
