/**
 * Нормализация путей внутри пакета — общая и для распаковки (02), и для раздачи (03).
 *
 * Один и тот же код по обе стороны намеренно: путь, записанный при распаковке, должен совпадать
 * байт-в-байт с тем, что придёт в запросе, иначе файл просто не найдётся в инвентаре.
 */

/** Каталоги внутри архива — записи, оканчивающиеся на `/`. Файлами не являются, инвентарь их не хранит. */
export function isDirectoryEntry(rawPath: string): boolean {
  return rawPath.endsWith('/') || rawPath.endsWith('\\');
}

/**
 * Приводит путь записи архива (или хвост URL) к каноничному относительному виду.
 * `null` — путь небезопасен или бессмысленен; вызывающий обязан отвергнуть запись/запрос.
 *
 * Отвергается: абсолютные пути (unix и windows), UNC, любой сегмент `..`, нулевой байт, пустой путь.
 *
 * Процентное декодирование здесь НЕ делается — на входе ожидается уже декодированная строка
 * (Fastify отдаёт параметры роута декодированными). Декодировать повторно нельзя: `%252e%252e`
 * превратилось бы в `..` уже после проверки.
 */
export function normalizePackagePath(rawPath: string): string | null {
  if (!rawPath) return null;
  if (rawPath.includes('\0')) return null;

  const unified = rawPath.replace(/\\/g, '/');

  // Абсолютный путь и UNC (`//server/share`) — не относительный путь внутри пакета.
  if (unified.startsWith('/')) return null;
  // Windows-диск: `C:/...`, `c:...`.
  if (/^[a-zA-Z]:/.test(unified)) return null;

  const segments: string[] = [];
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue;
    // Выход за корень пакета. Не «схлопываем» с предыдущим сегментом намеренно: любой `..`
    // в архиве — признак вредоносного пакета, а не небрежной упаковки.
    if (segment === '..') return null;
    segments.push(segment);
  }

  if (!segments.length) return null;
  return segments.join('/');
}

/**
 * Разрешает ссылку **из описателя** относительно корня пакета, схлопывая `.` и `..`.
 * `null` — ссылка уводит выше корня.
 *
 * Отличается от {@link normalizePackagePath} ровно обращением с `..`, и различие принципиальное:
 *
 * - в **имени записи архива** любой `..` — это zip-slip, схлопывать его нечего, запись отвергается;
 * - в **ссылке из манифеста** `..` совершенно законен. При `xml:base="content/"` href
 *   `../shared/player.html` означает `shared/player.html` — так собирают курсы, где несколько
 *   модулей делят общий проигрыватель. Отвергать такое значило бы отвергать исправные пакеты.
 *
 * Граница при этом не размывается: сложенный путь всё равно обязан остаться внутри пакета, и
 * `../../etc/passwd` даёт `null` так же, как раньше.
 */
export function resolveRelativePath(rawPath: string): string | null {
  if (!rawPath) return null;
  if (rawPath.includes('\0')) return null;

  const unified = rawPath.replace(/\\/g, '/');
  if (unified.startsWith('/')) return null;
  if (/^[a-zA-Z]:/.test(unified)) return null;

  const segments: string[] = [];
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // Подниматься выше корня пакета нельзя — снаружи для нас ничего не существует.
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (!segments.length) return null;
  return segments.join('/');
}

/** Расширение в нижнем регистре, без точки. Пустая строка — расширения нет. */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  // `.htaccess` — точка в начале это не расширение, а скрытый файл.
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * `href` из imsmanifest.xml может нести query и фрагмент (`index.html?x=1#top`) — в инвентаре
 * лежит только путь, поэтому хвост отбрасывается.
 */
export function stripQueryAndFragment(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
}
