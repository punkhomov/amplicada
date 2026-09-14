import { Readable } from 'node:stream';
import yauzl from 'yauzl';

/**
 * Чтение ZIP-архива с произвольным доступом.
 *
 * Пакет курса (в терминах спецификации — PIF, Package Interchange File) может весить сотни
 * мегабайт, потому что внутри видео. Читать его целиком в память нельзя, и раскладывать на диск
 * тоже незачем: central directory лежит в хвосте файла, а дальше каждая запись достаётся по
 * смещению. Отсюда {@link RandomAccessSource} — всё, что модуль обязан предоставить, это «дай
 * поток на диапазон байт»; поверх S3 это ровно один range-запрос.
 */

export interface RandomAccessSource {
  /** Полный размер архива. Без него не найти central directory. */
  readonly size: number;
  /** Поток байт `[start, end)`. Диапазон всегда непустой и лежит внутри `size`. */
  read(start: number, end: number): Readable;
  /** Освобождение ресурсов источника, если они есть. */
  close?(): void | Promise<void>;
}

export interface ZipEntry {
  /** Имя записи как оно лежит в архиве — без нормализации и без отрезанного корня пакета. */
  path: string;
  /** Заявленный в central directory размер. Проверяется при чтении, доверять до этого нельзя. */
  uncompressedSize: number;
  compressedSize: number;
  isDirectory: boolean;
  isEncrypted: boolean;
  lastModified: Date;
}

interface InternalEntry extends ZipEntry {
  readonly source: yauzl.Entry;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/** Открытый архив. Обязателен `close()` — источник живёт до него. */
export class ZipArchive {
  private constructor(
    private readonly zip: yauzl.ZipFile,
    private readonly source: RandomAccessSource,
    private readonly items: InternalEntry[],
  ) {}

  static async open(source: RandomAccessSource): Promise<ZipArchive> {
    if (source.size <= 0) throw new ZipError('Пустой файл не является ZIP-архивом');

    const zip = await openZipFile(new SourceReader(source), source.size);
    try {
      return new ZipArchive(zip, source, await readAllEntries(zip));
    } catch (error) {
      zip.close();
      throw error;
    }
  }

  /** Полный инвентарь архива, включая каталоги. Прочитан из central directory при открытии. */
  entries(): readonly ZipEntry[] {
    return this.items;
  }

  /**
   * Поток содержимого записи. Размер сверяется с заявленным по ходу чтения (`validateEntrySizes`),
   * поэтому архив, который врёт про размеры, оборвёт поток ошибкой, а не незаметно распакуется.
   */
  openStream(entry: ZipEntry): Promise<Readable> {
    const internal = this.items.find(item => item === entry) ?? this.items.find(item => item.path === entry.path);
    if (!internal) throw new ZipError(`Записи "${entry.path}" нет в этом архиве`);
    if (internal.isEncrypted) throw new ZipError(`Запись "${entry.path}" зашифрована — такие пакеты не поддерживаются`);

    return new Promise((resolve, reject) => {
      this.zip.openReadStream(internal.source, (error, stream) => {
        if (error || !stream) return reject(error ?? new ZipError(`Не удалось открыть "${entry.path}"`));
        resolve(stream);
      });
    });
  }

  /**
   * Содержимое записи целиком. Только для заведомо мелких файлов — манифеста и подобных;
   * `maxBytes` страхует от архива, который объявил 2 КБ, а отдаёт гигабайт.
   */
  async readFile(entry: ZipEntry, maxBytes: number): Promise<Buffer> {
    if (entry.uncompressedSize > maxBytes) {
      throw new ZipError(`Файл "${entry.path}" больше допустимых ${maxBytes} байт`);
    }

    const stream = await this.openStream(entry);
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) {
        stream.destroy();
        throw new ZipError(`Файл "${entry.path}" больше допустимых ${maxBytes} байт`);
      }
      chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks);
  }

  async close(): Promise<void> {
    this.zip.close();
    await this.source.close?.();
  }
}

function openZipFile(reader: yauzl.RandomAccessReader, size: number): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromRandomAccessReader(
      reader,
      size,
      // lazyEntries: читаем central directory сами и до конца — инвентарь нужен целиком раньше,
      // чем распаковка. autoClose: архив живёт, пока мы вытаскиваем из него файлы.
      { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) return reject(new ZipError(`Файл не читается как ZIP: ${error?.message ?? 'неизвестная причина'}`));
        resolve(zip);
      },
    );
  });
}

function readAllEntries(zip: yauzl.ZipFile): Promise<InternalEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: InternalEntry[] = [];

    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push({
        path: entry.fileName,
        uncompressedSize: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        // Каталог в ZIP — это запись, оканчивающаяся на `/`. Отдельного флага в формате нет.
        isDirectory: entry.fileName.endsWith('/'),
        isEncrypted: entry.isEncrypted(),
        lastModified: entry.getLastModDate(),
        source: entry,
      });
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    // Сюда же приходит отказ yauzl на небезопасных именах записей (`../`, абсолютный путь):
    // он проверяет их сам, ещё до нашей нормализации. Текст его ошибки информативен, оборачиваем как есть.
    zip.on('error', error => reject(new ZipError(`Оглавление архива не читается: ${error.message}`)));

    zip.readEntry();
  });
}

/**
 * Мост между yauzl и нашим источником. yauzl сам решает, какие куски файла ему нужны, и просит их
 * через `_readStreamForRange`; всё остальное (буферизация, разбор заголовков) — его забота.
 */
class SourceReader extends yauzl.RandomAccessReader {
  constructor(private readonly source: RandomAccessSource) {
    super();
  }

  _readStreamForRange(start: number, end: number): Readable {
    return this.source.read(start, end);
  }
}

/** Источник поверх готового буфера — для тестов и мелких архивов, уже лежащих в памяти. */
export function bufferSource(buffer: Buffer): RandomAccessSource {
  return {
    size: buffer.length,
    read(start, end) {
      // Массивом с одним элементом, а не самим буфером: `Readable.from(buffer)` итерирует его
      // побайтово и отдаёт поток чисел вместо потока чанков.
      return Readable.from([buffer.subarray(start, end)]);
    },
  };
}
