import { createHash } from 'node:crypto';

const ORIGIN_RE = /https?:\/\/[^\s)"'/]+/g;
const QUERY_RE = /\?[^\s)"']*/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;
const STACK_FRAME_RE = /^at\s+(.+?)\s+\(?([^()\s]+):(\d+):(\d+)\)?$/;

/** Нормализует текст ошибки: убирает origin/query/числа/id — они не должны влиять на группировку. */
export function normalizeErrorText(value: string, maxLength = 512): string {
  return value
    .slice(0, 4096)
    .replace(ORIGIN_RE, '')
    .replace(QUERY_RE, '')
    .replace(UUID_RE, '<id>')
    .replace(HEX_RE, '<hex>')
    .replace(NUMBER_RE, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Кадр стека → стабильный ключ `fn@file:line` (без origin и query). */
export function normalizeStackFrame(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ') && !/^[^\s]+\s*@/.test(trimmed)) return null;
  const match = STACK_FRAME_RE.exec(trimmed);
  if (match) {
    const [, fn, file, lineNo] = match;
    return `${fn}@${file.replace(ORIGIN_RE, '').replace(QUERY_RE, '')}:${lineNo}`;
  }
  return normalizeErrorText(trimmed, 200);
}

export interface ErrorFingerprintInput {
  type?: string;
  message?: string;
  stack?: string;
  route?: string | null;
}

export interface ErrorFingerprintResult {
  fingerprint: string;
  messageTemplate: string;
  frameKeys: string[];
}

/**
 * Группировка ошибок (подход Sentry): тип + первые кадры стека + шаблон маршрута.
 * Сообщение в fingerprint не входит — оно меняется от данных; для UI хранится отдельно.
 */
export function errorFingerprint(input: ErrorFingerprintInput): ErrorFingerprintResult {
  const frames = (input.stack ?? '')
    .split('\n')
    .map(normalizeStackFrame)
    .filter((frame): frame is string => frame !== null)
    .slice(0, 5);
  const type = (input.type ?? 'Error').slice(0, 120);
  const route = input.route ?? '';
  const basis = [type, route, ...frames].join('\n');
  return {
    fingerprint: createHash('sha256').update(basis).digest('hex'),
    messageTemplate: normalizeErrorText(input.message ?? '', 256),
    frameKeys: frames,
  };
}
