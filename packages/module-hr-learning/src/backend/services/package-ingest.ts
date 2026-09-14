import {
  type ArchiveLimits,
  ArchiveRejected,
  contentTypeFor,
  DEFAULT_ARCHIVE_LIMITS,
  FALLBACK_CONTENT_TYPE,
  isAllowedPackageFile,
  normalizePackagePath,
  type PackageFormat,
  PackageParseError,
  parsePackage,
  planExtraction,
  ZipArchive,
  zipSource,
} from '@amplicada/learning-parser';
import { logger } from '@amplicada/platform-core/backend';
import type { BackendDbService, BackendStorageService } from '@amplicada/platform-core/contracts/backend';
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import type { PackageKind, PackageNote } from '../../contracts/index.js';
import { type HrLearningPackageRow, hrLearningPackageFiles, hrLearningPackages } from '../schemas/index.js';
import { storageSource } from './storage-source.js';

/** Код задачи планировщика. Его же публикуем в RUN_NOW_CHANNEL, чтобы не ждать расписания. */
export const INGEST_TASK_ID = 'learning-package-ingest';

/** Дольше этого распаковка честно не идёт — значит, воркер, забравший пакет, не пережил её. */
const STALE_PROCESSING_MS = 30 * 60 * 1000;

/** Манифест — текстовый файл на десятки килобайт. Мегабайтный `imsmanifest.xml` это не манифест. */
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;

/** `package_files` пишем пачками: одна вставка на несколько тысяч строк упирается в лимит параметров. */
const INVENTORY_BATCH = 500;

/** Сколько раз пробуем взять следующего кандидата, проиграв гонку за предыдущего. */
const CLAIM_RETRIES = 5;

export const PACKAGE_LIMITS: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS;

export function incomingKey(packageId: string, filename: string): string {
  return `learning/_incoming/${packageId}/${filename}`;
}

export function contentPrefix(packageId: string): string {
  return `learning/${packageId}/`;
}

export function contentKey(packageId: string, path: string): string {
  return `${contentPrefix(packageId)}${path}`;
}

interface IngestResult {
  /**
   * Чем пакет оказался на самом деле. При заливке известно только расширение, а версию SCORM знает
   * лишь манифест внутри — до распаковки в строке стоит догадка, и здесь она заменяется фактом.
   */
  kind: PackageKind;
  entryPoint: string;
  title: string | null;
  scormVersion: string | null;
  totalFiles: number;
  totalSize: number;
  /** Пакет принят, но с оговорками. Пустой список — принят чисто. */
  notes: PackageNote[];
}

/**
 * Приём пакета: от строки `pending` до разложенных в бакет файлов и заполненного инвентаря.
 *
 * Работа идёт в фоне, а не в запросе: распаковка сотен файлов длится дольше любого разумного
 * таймаута HTTP, а загрузивший админ всё равно смотрит на статус на карточке курса.
 */
export class PackageIngestService {
  constructor(
    private readonly db: BackendDbService,
    private readonly storage: BackendStorageService,
  ) {}

  /**
   * Разбирает очередь до конца. Задача запускается и по расписанию, и по publish из роута загрузки;
   * несколько воркеров безопасны — каждый пакет достаётся ровно одному (см. `claimNext`).
   */
  async runPending(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const claimed = await this.claimNext();
      if (!claimed) return;

      try {
        await this.process(claimed);
      } catch (error) {
        // Ошибка одного пакета не должна останавливать очередь: следующий может быть исправным.
        await this.fail(claimed, error);
      }
    }
  }

  /**
   * Атомарный захват: кандидат выбирается обычным SELECT, а забирается условным UPDATE. Если
   * между ними пакет взял другой воркер, условие уже не выполнится и вернётся ноль строк —
   * блокировать строки на этапе выборки для этого не нужно (тот же приём, что в
   * `WorkflowAutomationWorker`).
   *
   * В кандидаты попадают и зависшие `processing`: их некому разбудить publish'ем — публикатор
   * и есть тот процесс, который умер.
   */
  private async claimNext(): Promise<HrLearningPackageRow | null> {
    for (let attempt = 0; attempt < CLAIM_RETRIES; attempt++) {
      const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
      const claimable = or(
        eq(hrLearningPackages.status, 'pending'),
        and(
          eq(hrLearningPackages.status, 'processing'),
          or(isNull(hrLearningPackages.claimedAt), lt(hrLearningPackages.claimedAt, staleBefore)),
        ),
      );

      const [candidate] = await this.db
        .select({ id: hrLearningPackages.id })
        .from(hrLearningPackages)
        .where(claimable)
        .orderBy(asc(hrLearningPackages.createdAt))
        .limit(1);
      if (!candidate) return null;

      const [claimed] = await this.db
        .update(hrLearningPackages)
        .set({ status: 'processing', claimedAt: new Date(), error: null })
        .where(and(eq(hrLearningPackages.id, candidate.id), claimable))
        .returning();

      // Ноль строк — кандидата увёл другой воркер. Не выходим: следующий в очереди может быть
      // свободен, а выход означал бы, что при двух воркерах половина очереди ждёт расписания.
      if (claimed) return claimed;
    }
    return null;
  }

  private async process(pkg: HrLearningPackageRow): Promise<void> {
    const result = pkg.kind === 'file' ? await this.ingestFile(pkg) : await this.ingestScorm(pkg);

    await this.db
      .update(hrLearningPackages)
      .set({
        status: 'ready',
        error: null,
        kind: result.kind,
        notes: result.notes,
        entryPoint: result.entryPoint,
        title: result.title,
        scormVersion: result.scormVersion,
        totalFiles: result.totalFiles,
        totalSize: result.totalSize,
      })
      .where(eq(hrLearningPackages.id, pkg.id));

    await this.makeCurrentIfFirst(pkg);

    // Исходник больше не нужен: всё, что из него требовалось, лежит распакованным.
    await this.storage.deleteObject(pkg.sourceKey).catch(error => {
      logger.warn({ err: error, key: pkg.sourceKey }, 'Не удалось удалить исходный архив пакета');
    });

    logger.info({ packageId: pkg.id, files: result.totalFiles }, 'Пакет курса готов');
  }

  private async ingestScorm(pkg: HrLearningPackageRow): Promise<IngestResult> {
    const source = await this.storage.headObject(pkg.sourceKey);
    if (!source) throw new ArchiveRejected('Исходный архив не найден в хранилище');

    const archive = await ZipArchive.open(storageSource(this.storage, pkg.sourceKey, source.size));
    try {
      // requireDescriptor: архив без описания курса — просто архив с HTML.
      const plan = planExtraction(archive.entries(), PACKAGE_LIMITS, true);
      // `include` — чтобы разбор видел ровно то, что прошло нашу политику приёма: библиотека
      // фильтровать по расширениям и лимитам не обязана, это не её дело.
      const source = zipSource(archive, {
        include: plan.files.map(file => file.path),
        maxBytes: MANIFEST_MAX_BYTES,
      });
      const { metadata, report } = await parsePackage(source);

      // Опознаём все ходовые форматы, а проигрывать умеем два. Отказ на приёме честнее, чем
      // «Готов» на карточке и пустой экран у учащегося: cmi5 и xAPI требуют LRS, AICC — HACP.
      if (metadata.format !== 'scorm12' && metadata.format !== 'scorm2004') {
        throw new PackageParseError(`Пакет распознан как ${FORMAT_NAMES[metadata.format]}, а проигрывать мы умеем SCORM 1.2 и SCORM 2004`);
      }
      // Ошибки разбора (нечего запускать, объявленного файла нет в архиве) отдаём все сразу:
      // чинить пакет по одной за перезаливку гигабайтного архива — это часы вместо минут.
      if (!report.ok) {
        throw new PackageParseError(report.errors.map(issue => `${issue.message} (${issue.location})`).join('; '));
      }
      // Внешний контент в прокси-режиме не поддерживается по построению: раздаём мы только то,
      // что лежит у нас в бакете. Для библиотеки это предупреждение — решает потребитель, и вот он.
      if (!metadata.entryPoint) {
        throw new PackageParseError(`Курс запускается с внешнего адреса (${metadata.entryUrl}) — такие пакеты не поддерживаются`);
      }

      // Замечания приёму не мешают, но молчать о них нельзя: выброшенный файл и осиротевший ресурс —
      // это ровно то, что потом выглядит как «курс странно себя ведёт». Раньше они уходили только в
      // лог, и админ на карточке видел «Готов», не зная, что из пакета выкинули полтора десятка
      // файлов; теперь едут в `notes` и показываются рядом с версией.
      const notes: PackageNote[] = [
        ...plan.skipped.map(path => noteSkipped(path)),
        ...report.warnings.map(issue => ({ kind: 'parser' as const, message: issue.message, location: issue.location ?? null })),
      ];
      if (notes.length) logger.warn({ packageId: pkg.id, notes }, 'Пакет принят с замечаниями');

      const inventory: { packageId: string; path: string; contentType: string; size: number }[] = [];
      // Последовательно, а не параллельно: смысл всей конструкции в том, чтобы в памяти в каждый
      // момент был один файл, а не весь пакет.
      for (const file of plan.files) {
        const contentType = contentTypeFor(file.path) ?? FALLBACK_CONTENT_TYPE;
        const stream = await archive.openStream(file.entry);
        await this.storage.putObjectStream(contentKey(pkg.id, file.path), stream, {
          contentLength: file.entry.uncompressedSize,
          contentType,
        });
        inventory.push({ packageId: pkg.id, path: file.path, contentType, size: file.entry.uncompressedSize });
      }

      await this.writeInventory(pkg.id, inventory);

      return {
        kind: metadata.format,
        entryPoint: metadata.entryPoint,
        title: metadata.title,
        scormVersion: metadata.schemaVersion,
        totalFiles: inventory.length,
        totalSize: plan.totalBytes,
        notes,
      };
    } finally {
      await archive.close();
    }
  }

  /**
   * `kind: 'file'` — PDF или видео вместо курса. Распаковывать нечего: файл переносится в контент
   * как единственная запись инвентаря, точка входа — он сам.
   */
  private async ingestFile(pkg: HrLearningPackageRow): Promise<IngestResult> {
    const source = await this.storage.headObject(pkg.sourceKey);
    if (!source) throw new ArchiveRejected('Исходный файл не найден в хранилище');

    const filename = normalizePackagePath(pkg.sourceKey.slice(pkg.sourceKey.lastIndexOf('/') + 1));
    if (!filename) throw new ArchiveRejected('Имя файла непригодно для использования в пакете');
    if (!isAllowedPackageFile(filename)) throw new ArchiveRejected(`Файл "${filename}" имеет недопустимое расширение`);

    const contentType = contentTypeFor(filename) ?? FALLBACK_CONTENT_TYPE;
    const object = await this.storage.getObjectStream(pkg.sourceKey);
    await this.storage.putObjectStream(contentKey(pkg.id, filename), object.body, {
      contentLength: source.size,
      contentType,
    });

    await this.writeInventory(pkg.id, [{ packageId: pkg.id, path: filename, contentType, size: source.size }]);

    // Одиночный файл либо принят целиком, либо отвергнут выше — выбрасывать из него нечего.
    return { kind: 'file', entryPoint: filename, title: null, scormVersion: null, totalFiles: 1, totalSize: source.size, notes: [] };
  }

  private async writeInventory(packageId: string, rows: { packageId: string; path: string; contentType: string; size: number }[]) {
    // Перезаливка того же пакета (повторная обработка после зависания) не должна ловить конфликт
    // первичного ключа на путях, записанных прошлой попыткой.
    await this.db.delete(hrLearningPackageFiles).where(eq(hrLearningPackageFiles.packageId, packageId));
    for (let i = 0; i < rows.length; i += INVENTORY_BATCH) {
      await this.db.insert(hrLearningPackageFiles).values(rows.slice(i, i + INVENTORY_BATCH));
    }
  }

  /**
   * Первый готовый пакет курса становится текущим сам — иначе курс, только что залитый, никому
   * не открывается и причина неочевидна. Последующие версии переключает админ явно: подменять
   * контент под учащимися молча нельзя.
   */
  private async makeCurrentIfFirst(pkg: HrLearningPackageRow): Promise<void> {
    const [existing] = await this.db
      .select({ id: hrLearningPackages.id })
      .from(hrLearningPackages)
      .where(and(eq(hrLearningPackages.courseId, pkg.courseId), eq(hrLearningPackages.isCurrent, true)))
      .limit(1);
    if (existing) return;

    await this.db.update(hrLearningPackages).set({ isCurrent: true }).where(eq(hrLearningPackages.id, pkg.id));
  }

  private async fail(pkg: HrLearningPackageRow, error: unknown): Promise<void> {
    const message = describe(error);
    logger.warn({ err: error, packageId: pkg.id }, 'Пакет курса не принят');

    await this.db.update(hrLearningPackages).set({ status: 'failed', error: message }).where(eq(hrLearningPackages.id, pkg.id));

    // Полураспакованный пакет в бакете — мусор, который никто не найдёт: строк инвентаря на него нет.
    await this.db.delete(hrLearningPackageFiles).where(eq(hrLearningPackageFiles.packageId, pkg.id));
    await this.cleanupStorage(pkg);
  }

  /** Удаление контента пакета из бакета. Строки БД снимает вызывающий (или каскад). */
  async cleanupStorage(pkg: Pick<HrLearningPackageRow, 'id' | 'sourceKey'>): Promise<void> {
    await this.storage.deletePrefix(contentPrefix(pkg.id)).catch(error => {
      logger.warn({ err: error, packageId: pkg.id }, 'Не удалось убрать содержимое пакета из хранилища');
    });
    await this.storage.deleteObject(pkg.sourceKey).catch(() => {
      // Исходника может уже не быть — успешная обработка удаляет его сама.
    });
  }
}

/**
 * Замечание о выброшенном файле.
 *
 * Расширение в тексте названо явно: пропущено обычно не что попало, а один и тот же тип разом —
 * десяток `.psd` от дизайнера или `Thumbs.db` из каждой папки. Админу нужно понять, чего лишился
 * курс, а не читать список из ста путей.
 */
function noteSkipped(path: string): PackageNote {
  const dot = path.lastIndexOf('.');
  const extension = dot > path.lastIndexOf('/') ? path.slice(dot) : 'без расширения';
  return { kind: 'skipped-file', message: `Файл не принят: тип "${extension}" не раздаётся платформой`, location: path };
}

/** Как назвать формат в отказе. Админ должен понять, что именно он залил. */
const FORMAT_NAMES: Record<PackageFormat, string> = {
  scorm12: 'SCORM 1.2',
  scorm2004: 'SCORM 2004',
  cmi5: 'cmi5',
  xapi: 'xAPI (Tin Can)',
  aicc: 'AICC',
};

/** В `packages.error` уходит текст для человека, а не стек. */
function describe(error: unknown): string {
  if (error instanceof ArchiveRejected || error instanceof PackageParseError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return `Не удалось обработать пакет: ${message}`;
}
