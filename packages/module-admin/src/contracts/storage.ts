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
  /** Курсор следующей страницы; нет — страница последняя. Возвращается в query-параметр `cursor`. */
  nextToken?: string;
}

export interface StorageDeleteResult {
  deleted: number;
}

/** Тело `POST /storage/folder`: имя папки создаётся в текущем `prefix` из query. */
export interface StorageCreateFolderRequest {
  name: string;
}

/** Тело `POST /storage/move`: ключи (файлы или папки с `/` на конце) и папка назначения. */
export interface StorageMoveRequest {
  keys: string[];
  destination: string;
  /** Новое имя единственного перемещаемого элемента — переименование без смены папки. */
  name?: string;
}

/** Ответ `POST /storage/move`: сколько верхнеуровневых элементов перенесено. */
export interface StorageMoveResult {
  moved: number;
}

/**
 * Тело `DELETE /storage/objects`: пакетное удаление вместо одиночного `?key=`. Ключи приходят
 * из мультивыбора в UI, поэтому одним запросом удаляется всё выделенное.
 */
export interface StorageDeleteRequest {
  keys: string[];
}

/** Возможности страницы хранилища, которые задаёт деплой через env. */
export interface StorageConfig {
  /** Правка текста из превью; по умолчанию выключена (`STORAGE_EDIT_ENABLED`). */
  editEnabled: boolean;
}
