import type { Readable } from 'node:stream';

export interface StoragePutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoragePutStreamOptions extends StoragePutOptions {
  /**
   * Размер тела, если он известен заранее (например, из оглавления ZIP) — тогда объект уходит
   * одним PUT. Без него запись идёт multipart'ом: дороже по числу запросов, зато не требует
   * заранее знать длину и всё равно не держит тело в памяти.
   */
  contentLength?: number;
}

export interface StorageObjectInfo {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export interface StorageGetStreamOptions {
  /**
   * Значение HTTP-заголовка `Range` (RFC 9110), например `bytes=0-1023`. Уходит в S3 как есть —
   * разбирать его самим не нужно, включая суффиксную форму `bytes=-500`. Несколько диапазонов в
   * одном заголовке S3 не поддерживает: вернётся объект целиком.
   */
  range?: string;
}

/** Тело + метаданные, которых хватает, чтобы отдать `200` или `206` без повторного `headObject`. */
export interface StorageObjectStream {
  body: Readable;
  /** Длина именно этого ответа: у range-запроса — размер куска, а не всего объекта. */
  contentLength?: number;
  contentType?: string;
  /** Заголовок `Content-Range` от S3 (`bytes 0-1023/98765`). Есть только у частичного ответа — по нему и определяется, что отдавать `206`. */
  contentRange?: string;
  etag?: string;
  lastModified?: Date;
}

export interface BackendStorageService {
  putObject(key: string, body: Buffer | Uint8Array | string, options?: StoragePutOptions): Promise<void>;
  /**
   * Запись потоком — для того, что нельзя держать в памяти целиком: видео внутри пакета курса,
   * крупные вложения. Обычный `putObject` требует готовый Buffer и на файле в сотни мегабайт
   * стоит ровно столько же памяти.
   */
  putObjectStream(key: string, body: Readable, options?: StoragePutStreamOptions): Promise<void>;
  /** Читает объект целиком в память. Для крупных файлов (видео, пакеты курсов) — `getObjectStream`. */
  getObject(key: string): Promise<Buffer>;
  /**
   * Потоковое чтение с поддержкой частичных запросов — без этого браузер не умеет перематывать
   * медиа, а каждый читатель держал бы файл целиком в памяти процесса.
   * Диапазон вне размера объекта → ошибка со `statusCode = 416`.
   */
  getObjectStream(key: string, options?: StorageGetStreamOptions): Promise<StorageObjectStream>;
  deleteObject(key: string): Promise<void>;
  /**
   * Удаляет всё под префиксом пачками по 1000 (лимит `DeleteObjects`) и возвращает число ключей.
   * Поштучное удаление распакованного пакета — это тысячи round-trip'ов.
   */
  deletePrefix(prefix: string): Promise<number>;
  headObject(key: string): Promise<StorageObjectInfo | null>;
  /** Дочитывает все страницы листинга: `ListObjectsV2` отдаёт максимум 1000 ключей за вызов. */
  listObjects(prefix?: string): Promise<StorageObjectInfo[]>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
