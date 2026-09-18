const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
const LONG_HEX_RE = /^[0-9a-f]{16,}$/i;

/** Заменяет динамические сегменты пути на `:id`, чтобы `route` не взрывал кардинальность. */
export function normalizeRoute(pathname: string): string {
  const segments = pathname.split('/').map(segment => {
    if (segment.length === 0) return segment;
    if (UUID_RE.test(segment) || NUMERIC_RE.test(segment) || LONG_HEX_RE.test(segment)) return ':id';
    return segment;
  });
  const joined = segments.join('/');
  return joined.startsWith('/') ? joined || '/' : `/${joined}`;
}
