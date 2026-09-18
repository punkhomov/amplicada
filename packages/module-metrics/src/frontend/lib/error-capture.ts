import type { ClientEventInput, MetricAttrValue } from '../../contracts/index.js';

const ORIGIN_RE = /https?:\/\/[^\s)"'/]+/g;
const QUERY_RE = /\?[^\s)"']*/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const MAX_STACK_LINES = 10;

/** Нормализация текста на клиенте: без origin/query/uuid — как на сервере, но раньше. */
export function normalizeClientErrorText(value: string, maxLength: number): string {
  return value
    .replace(ORIGIN_RE, '')
    .replace(QUERY_RE, '')
    .replace(UUID_RE, '<id>')
    .replace(HEX_RE, '<hex>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Стек нормализуется построчно: origin и query убираются, структура кадров сохраняется. */
export function normalizeClientStack(stack: string): string {
  return stack
    .split('\n')
    .slice(0, MAX_STACK_LINES)
    .map(line => line.replace(ORIGIN_RE, '').replace(QUERY_RE, '').replace(UUID_RE, '<id>').trim())
    .filter(line => line.length > 0)
    .join('\n')
    .slice(0, 4096);
}

export interface ErrorContext {
  source: string;
  route: string;
  sessionId: string;
  componentStack?: string;
}

/** Ошибка из любого источника → событие `error.frontend` с нормализованными атрибутами. */
export function errorEventFromUnknown(error: unknown, context: ErrorContext): ClientEventInput {
  const base = error instanceof Error ? error : null;
  const type = base?.name ?? (typeof error === 'string' ? 'Error' : 'UnknownError');
  const rawMessage = base?.message ?? (typeof error === 'string' ? error : safelyStringify(error)) ?? 'Unknown error';

  const attributes: Record<string, MetricAttrValue> = {
    'error.type': type.slice(0, 120),
    'error.message': normalizeClientErrorText(rawMessage, 256),
    source: context.source,
  };
  if (base?.stack) attributes['error.stack'] = normalizeClientStack(base.stack);
  if (context.componentStack) {
    attributes['error.component_stack'] = normalizeClientStack(context.componentStack);
  }

  return {
    id: crypto.randomUUID(),
    name: 'error.frontend',
    kind: 'error',
    occurredAt: new Date().toISOString(),
    sessionId: context.sessionId,
    context: {
      route: context.route,
      url: window.location.pathname,
      referrer: document.referrer || undefined,
    },
    attributes,
  };
}

function safelyStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
