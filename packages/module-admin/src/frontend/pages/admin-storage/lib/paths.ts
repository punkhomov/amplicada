import type { ApiClient } from '@amplicada/platform-core/frontend';

/** Имя файла из ключа: последний сегмент. */
export function objectName(key: string): string {
  return key.split('/').pop() || key;
}

/** Имя папки относительно текущего уровня: `learning/pkg/` при текущем `learning/` → `pkg`. */
export function folderName(prefix: string, parentPrefix: string): string {
  return prefix.slice(parentPrefix.length).replace(/\/+$/, '') || prefix;
}

export function storageViewUrl(api: ApiClient, key: string): string {
  return `${api.baseUrl}/admin/storage/objects/view?key=${encodeURIComponent(key)}`;
}

export function storageDownloadUrl(api: ApiClient, key: string): string {
  return `${api.baseUrl}/admin/storage/objects/download?key=${encodeURIComponent(key)}`;
}
