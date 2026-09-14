import { normalizePackagePath } from './paths.js';

/**
 * Раскладка файлов внутри пакета: где лежит описатель и что считать корнем.
 *
 * Отдельно от разбора форматов намеренно — это знание нужно раньше, чем формат опознан. На этапе
 * планирования распаковки мы ещё ничего не читали, но уже должны знать, какой префикс отрезать от
 * путей.
 */

/**
 * Ищет файл пакета по имени без учёта регистра и на любой глубине, предпочитая самый мелкий.
 *
 * Регистр важен: `IMSManifest.xml` и `CMI5.xml` встречаются. Глубина важна не меньше: пакеты часто
 * зипуют вместе с внешней папкой, и отказать из-за этого значило бы отказать половине заливок.
 */
export function findDescriptor(paths: readonly string[], matches: (filename: string) => boolean): string | null {
  let best: string | null = null;
  let bestDepth = Number.POSITIVE_INFINITY;

  for (const path of paths) {
    const normalized = normalizePackagePath(path);
    if (!normalized) continue;
    if (!matches(normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase())) continue;

    const depth = normalized.split('/').length;
    if (depth < bestDepth) {
      best = normalized;
      bestDepth = depth;
    }
  }

  return best;
}

/** Каталог файла с завершающим `/` — префикс, который отрезается от всех путей архива. */
export function packageRootOf(descriptorPath: string): string {
  const cut = descriptorPath.lastIndexOf('/');
  return cut === -1 ? '' : descriptorPath.slice(0, cut + 1);
}
