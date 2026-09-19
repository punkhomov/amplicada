/** Объект хранилища в том виде, в каком его отдаёт листинг admin-API. */
export interface StorageObject {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

/**
 * Содержимое одной «папки». В S3 директорий нет: `prefixes` — это общие префиксы ключей до
 * следующего `/`, собранные из `CommonPrefixes`.
 */
export interface StorageListing {
  prefix: string;
  prefixes: string[];
  objects: StorageObject[];
}

export interface StorageDeleteResult {
  deleted: number;
}
