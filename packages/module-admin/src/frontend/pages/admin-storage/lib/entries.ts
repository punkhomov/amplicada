import type { StorageListing } from '../../../../contracts/storage.js';
import { objectName } from './paths.js';

export interface StorageEntry {
  kind: 'folder' | 'file';
  key: string;
  name: string;
  size?: number;
  lastModified?: string;
}

/**
 * Плоский список строк для UI: папки из `prefixes`, файлы из `objects`. Маркеры папок бэк уже
 * отфильтровал, поэтому объект со слэшом на конце сюда не доходит.
 */
export function toEntries(listing: StorageListing): StorageEntry[] {
  const folders: StorageEntry[] = listing.prefixes.map(prefix => ({
    kind: 'folder',
    key: prefix,
    // Имя — последний сегмент, а не срез по `listing.prefix`: так хелпер переживёт вложенный префикс.
    name: objectName(prefix.replace(/\/+$/, '')),
  }));
  const files: StorageEntry[] = listing.objects.map(object => ({
    kind: 'file',
    key: object.key,
    name: objectName(object.key),
    size: object.size,
    lastModified: object.lastModified,
  }));
  // Папки первыми: тот же порядок, что даёт сортировка, — без неё список всё равно читается стабильно.
  return [...folders, ...files];
}
