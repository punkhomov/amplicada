import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findDescriptor, packageRootOf } from '../archive/layout.js';
import { normalizePackagePath } from '../archive/paths.js';
import type { ZipArchive, ZipEntry } from '../archive/zip.js';
import { PackageParseError } from '../errors.js';
import { isDescriptorName } from './descriptors.js';
import type { PackageSource } from './detect.js';

/**
 * Готовые способы подать пакет разборщику.
 *
 * `parsePackage` принимает {@link PackageSource} — «список путей и как прочитать байты». Собрать
 * его из архива или каталога должна библиотека, а не каждый потребитель заново: без этого
 * разборщик учебных пакетов не умеет открыть учебный пакет.
 *
 * Здесь только сборка источника. Политика приёма (лимиты, whitelist расширений) живёт в `intake/`
 * и намеренно не участвует: библиотеке всё равно, согласен ли **ваш** LMS принять этот пакет.
 */

/** Описатель — текстовый файл на десятки килобайт. Мегабайтный `imsmanifest.xml` это не описатель. */
const DEFAULT_MAX_DESCRIPTOR_BYTES = 4 * 1024 * 1024;

export interface ZipSourceOptions {
  /**
   * Ограничить набор путей уже отобранными. Потребитель, у которого своя политика приёма
   * (`planExtraction`), передаёт сюда её результат, чтобы не фильтровать дважды.
   */
  include?: readonly string[];
  /** Потолок на чтение одного файла. По умолчанию 4 МБ — читаются только описатели. */
  maxBytes?: number;
}

/**
 * Источник поверх открытого архива.
 *
 * Архив остаётся за вызывающим: `zipSource` его не закрывает, потому что не открывал.
 */
export function zipSource(archive: ZipArchive, options: ZipSourceOptions = {}): PackageSource {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DESCRIPTOR_BYTES;
  const allowed = options.include ? new Set(options.include) : null;

  const entriesByName = new Map<string, ZipEntry>();
  for (const entry of archive.entries()) {
    if (entry.isDirectory) continue;
    // Дубли имён в ZIP формально законны. Первый выигрывает — как и при распаковке.
    if (!entriesByName.has(entry.path)) entriesByName.set(entry.path, entry);
  }

  const byPath = new Map<string, ZipEntry>();
  for (const [path, name] of packagePathsOf([...entriesByName.keys()])) {
    if (allowed && !allowed.has(path)) continue;
    const entry = entriesByName.get(name);
    if (entry) byPath.set(path, entry);
  }

  return {
    paths: [...byPath.keys()],
    // Заявленный размер, а не проверенный: сверяет его yauzl при чтении записи. Для «курс весит
    // 40 МБ» на карточке этого достаточно, а распаковывать архив ради точной цифры незачем.
    totalBytes: [...byPath.values()].reduce((sum, entry) => sum + entry.uncompressedSize, 0),
    async readBytes(path: string): Promise<Uint8Array> {
      const entry = byPath.get(path);
      if (!entry) throw new PackageParseError(`Файла "${path}" нет в архиве`);
      return archive.readFile(entry, maxBytes);
    },
  };
}

export interface DirectorySourceOptions {
  /** Потолок на чтение одного файла. По умолчанию 4 МБ. */
  maxBytes?: number;
}

/**
 * Источник поверх распакованного пакета на диске.
 *
 * Обход делается при создании: список путей `PackageSource` отдаёт целиком и сразу — на этом
 * стоит вся проверка существования файлов, она обязана быть бесплатной.
 */
export async function directorySource(root: string, options: DirectorySourceOptions = {}): Promise<PackageSource> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DESCRIPTOR_BYTES;
  const found: string[] = [];
  await walkFiles(root, '', found);

  const byPath = packagePathsOf(found);

  return {
    paths: [...byPath.keys()],
    async readBytes(path: string): Promise<Uint8Array> {
      const relative = byPath.get(path);
      if (relative === undefined) throw new PackageParseError(`Файла "${path}" нет в каталоге пакета`);

      const bytes = await readFile(join(root, ...relative.split('/')));
      if (bytes.length > maxBytes) throw new PackageParseError(`Файл "${path}" больше допустимых ${maxBytes} байт`);
      return bytes;
    },
  };
}

async function walkFiles(root: string, prefix: string, out: string[]): Promise<void> {
  const entries = await readdir(prefix ? join(root, ...prefix.split('/')) : root, { withFileTypes: true });

  for (const entry of entries) {
    // Симлинки не разворачиваем: ссылка может указывать наружу каталога, и тогда «пакет» прочитал
    // бы что угодно из файловой системы. Это тот же выход за корень, что `../` в имени записи ZIP.
    if (entry.isSymbolicLink()) continue;

    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walkFiles(root, relative, out);
    else if (entry.isFile()) out.push(relative);
  }
}

/**
 * Сырые имена файлов → пути внутри пакета. Ключ результата — путь внутри пакета, значение —
 * исходное имя, по которому это содержимое достаётся.
 *
 * Приводит к виду, который обещает {@link PackageSource}: нормализованные, с отрезанным корнем.
 * Корень — каталог описателя: пакеты часто зипуют вместе с внешней папкой, и путь `wrapper/index.html`
 * не совпал бы со ссылкой `index.html` из манифеста, лежащего рядом.
 *
 * Небезопасное имя (`..`, абсолютный путь, нулевой байт) отбрасывается молча — здесь сборка, а не
 * политика. Потребителю, которому нужен отказ вместо тишины, надо звать `planExtraction` из
 * `intake/`: он на таком архиве бросает.
 */
export function packagePathsOf(rawPaths: readonly string[]): Map<string, string> {
  const normalized: { path: string; raw: string }[] = [];
  for (const raw of rawPaths) {
    const path = normalizePackagePath(raw);
    if (path) normalized.push({ path, raw });
  }

  const descriptor = findDescriptor(
    normalized.map(entry => entry.path),
    isDescriptorName,
  );
  const root = descriptor ? packageRootOf(descriptor) : '';

  const byPath = new Map<string, string>();
  for (const { path, raw } of normalized) {
    if (root && !path.startsWith(root)) continue;
    const inside = path.slice(root.length);
    if (!inside || byPath.has(inside)) continue;
    byPath.set(inside, raw);
  }

  return byPath;
}
