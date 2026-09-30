/**
 * Рендер шаблонов уведомлений: подстановка `{{path}}` по dot-path.
 * subject/body — как есть, html — с экранированием подстановок.
 */

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export interface RenderedContent {
  subject: string;
  body: string;
  html?: string;
  missing: string[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char);
}

function resolvePath(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Подставляет `{{path}}`; отсутствующая переменная — пустая строка и путь в `missing`. */
export function interpolate(
  template: string,
  data: Record<string, unknown>,
  opts?: { escapeHtml?: boolean },
): { value: string; missing: string[] } {
  const missing: string[] = [];
  const value = template.replace(PLACEHOLDER_RE, (_match, path: string) => {
    const resolved = resolvePath(data, path);
    if (resolved === null || resolved === undefined) {
      missing.push(path);
      return '';
    }
    const text = typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved);
    return opts?.escapeHtml ? escapeHtml(text) : text;
  });
  return { value, missing };
}

export function renderContent(
  content: { subject: string; body: string; html?: string },
  data: Record<string, unknown>,
): RenderedContent {
  const subject = interpolate(content.subject, data);
  const body = interpolate(content.body, data);
  const html = content.html === undefined ? undefined : interpolate(content.html, data, { escapeHtml: true });
  const missing = [...new Set([...subject.missing, ...body.missing, ...(html?.missing ?? [])])];
  return { subject: subject.value, body: body.value, ...(html === undefined ? {} : { html: html.value }), missing };
}
