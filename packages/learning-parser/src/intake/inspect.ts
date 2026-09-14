import { findDescriptor, packageRootOf } from '../archive/layout.js';
import { normalizePackagePath } from '../archive/paths.js';
import type { ZipEntry } from '../archive/zip.js';
import { isDescriptorName } from '../formats/descriptors.js';
import { isAllowedPackageFile } from './content-types.js';

/**
 * Проверка инвентаря архива до того, как хоть один байт будет распакован.
 *
 * Функция чистая: на вход — список записей из central directory, на выход — либо готовый план
 * распаковки, либо причина отказа. Никаких обращений к хранилищу здесь нет, поэтому вся эта
 * логика проверяется тестами без S3.
 *
 * Это **политика приёма, а не часть формата**. Спецификации не запрещают ни архив на терабайт, ни
 * файл с расширением `.exe` внутри; запрещаем их мы. Потребителю с другими правилами полагается
 * передать свои {@link ArchiveLimits} либо не звать эту функцию вовсе — разбору она не нужна,
 * `parsePackage` обходится источником пакета.
 */

export interface ArchiveLimits {
  /** Сколько файлов допускаем в пакете. Защита от архива из миллиона пустых записей. */
  maxFiles: number;
  /** Суммарный распакованный размер. Основная защита от zip-бомбы. */
  maxTotalBytes: number;
  /** Потолок на один файл — чтобы одна запись не съела весь лимит пакета. */
  maxFileBytes: number;
  /**
   * Предел «во сколько раз запись разжимается». Классическая бомба — 40 КБ, разворачивающиеся
   * в терабайты, то есть отношение в миллионы. Нормальный HTML/JS жмётся раз в 5–10, видео вообще
   * не жмётся, так что запас можно брать большой.
   */
  maxCompressionRatio: number;
}

/**
 * Пример лимитов, а не требование формата. Числа взяты из наших загрузок: курс на два гигабайта уже
 * подозрителен, десять тысяч файлов — тоже. У другого LMS они будут другими, и это нормально.
 */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxFiles: 10_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
};

/** Файл, который будет записан в бакет: откуда взять и под каким путём положить. */
export interface PlannedFile {
  /** Запись архива. */
  entry: ZipEntry;
  /** Путь внутри пакета: нормализованный и с отрезанным корнем. Он же ключ в инвентаре. */
  path: string;
}

export interface ArchivePlan {
  files: PlannedFile[];
  /**
   * Пути, которые в пакет не поедут: расширение вне whitelist'а. Отдаются, а не проглатываются —
   * потребитель обязан сказать о них человеку, иначе курс молча приедет неполным.
   */
  skipped: string[];
  /** Префикс архива, который отрезан у всех путей. Пусто, если описатель лежал в корне. */
  root: string;
  /** Путь файла-описателя внутри пакета — уже после отрезания корня. `null` для одиночного файла. */
  descriptorPath: string | null;
  totalBytes: number;
}

export class ArchiveRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveRejected';
  }
}

/**
 * @param requireDescriptor — для архива с курсом. Пакет без файла-описателя курсом не является,
 *   и лучше сказать это на загрузке, чем отдать учащемуся пустой плеер.
 */
export function planExtraction(
  entries: readonly ZipEntry[],
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
  requireDescriptor = true,
): ArchivePlan {
  const descriptorPath = findDescriptor(
    entries.filter(entry => !entry.isDirectory).map(entry => entry.path),
    isDescriptorName,
  );
  if (requireDescriptor && !descriptorPath) {
    throw new ArchiveRejected('В архиве нет описания курса: ни imsmanifest.xml, ни cmi5.xml, ни tincan.xml, ни .crs');
  }

  // Пакеты часто зипуют вместе с внешней папкой. Корнем считаем каталог описателя, всё остальное
  // ниже него — содержимое пакета; файлы вне этого каталога в пакет не входят.
  const root = descriptorPath ? packageRootOf(descriptorPath) : '';

  const files: PlannedFile[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (entry.isEncrypted) throw new ArchiveRejected(`Запись "${entry.path}" зашифрована — такие пакеты не поддерживаются`);

    const normalized = normalizePackagePath(entry.path);
    // `..`, абсолютный путь, нулевой байт — zip-slip. Не пропускаем даже мимо: архив, который это
    // содержит, целиком считается вредоносным.
    if (!normalized) throw new ArchiveRejected(`Небезопасный путь в архиве: "${entry.path}"`);

    if (root && !normalized.startsWith(root)) continue;
    const path = normalized.slice(root.length);
    if (!path) continue;

    // Расширение вне whitelist'а — пропускаем файл, а не отвергаем архив.
    //
    // Отказ здесь ничего не защищал: в бакет файл не попадает ни в том, ни в другом случае, а
    // разница только в том, теряет ли админ загрузку целиком. Настоящие пакеты сплошь и рядом несут
    // мусор сборщика — схемы, файлы редактора, `Thumbs.db`; в нашем корпусе на этом падало 7 пакетов
    // из 209, и ни в одном пропущенный файл не был объявлен в манифесте.
    //
    // Если объявленный файл всё-таки окажется пропущен, курс неполон — но скажет об этом разбор
    // (`common.file-missing`), которому виднее: он знает, что манифест объявлял.
    if (!isAllowedPackageFile(path)) {
      skipped.push(path);
      continue;
    }
    if (seen.has(path)) {
      // Дубли путей в ZIP формально законны, но для нас путь — первичный ключ инвентаря.
      throw new ArchiveRejected(`Путь "${path}" встречается в архиве дважды`);
    }
    if (entry.uncompressedSize > limits.maxFileBytes) {
      throw new ArchiveRejected(`Файл "${path}" больше допустимых ${limits.maxFileBytes} байт`);
    }
    if (exceedsRatio(entry, limits.maxCompressionRatio)) {
      throw new ArchiveRejected(`Файл "${path}" подозрительно сильно сжат — похоже на zip-бомбу`);
    }

    seen.add(path);
    files.push({ entry, path });
    totalBytes += entry.uncompressedSize;

    if (files.length > limits.maxFiles) {
      throw new ArchiveRejected(`В архиве больше ${limits.maxFiles} файлов`);
    }
    if (totalBytes > limits.maxTotalBytes) {
      throw new ArchiveRejected(`Распакованный пакет больше допустимых ${limits.maxTotalBytes} байт`);
    }
  }

  // Отказ остаётся, но по факту, а не по одному файлу: пропустили всё — распаковывать нечего.
  if (!files.length) {
    throw new ArchiveRejected(
      skipped.length
        ? `Ни один файл архива не пригоден: ${skipped.length} шт. с недопустимыми расширениями (${skipped.slice(0, 5).join(', ')})`
        : 'В архиве нет ни одного пригодного файла',
    );
  }

  return { files, skipped, root, descriptorPath: descriptorPath ? descriptorPath.slice(root.length) : null, totalBytes };
}

/**
 * Заявленным размерам верить нельзя — их пишет тот, кто собирал архив. Здесь это только дешёвый
 * отсев; настоящая защита в том, что при чтении yauzl сверяет фактический размер с заявленным
 * (`validateEntrySizes`), а вызывающий всё равно ограничивает записанное в бакет.
 */
function exceedsRatio(entry: ZipEntry, maxRatio: number): boolean {
  // Мелочь пропускаем: у файла в сотню байт отношение скачет от служебных заголовков, а вреда нет.
  if (entry.compressedSize <= 0 || entry.uncompressedSize < 1024 * 1024) return false;
  return entry.uncompressedSize / entry.compressedSize > maxRatio;
}
