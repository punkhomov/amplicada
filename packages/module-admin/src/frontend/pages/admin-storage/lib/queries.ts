import type { ApiClient } from '@amplicada/platform-core/frontend';
import type { StorageConfig, StorageListing } from '../../../../contracts/storage.js';

/** Ключи кэша страницы хранилища: по ним инвалидируются и листинги, и конфиг. */
export const STORAGE_OBJECTS_QUERY_KEY = ['admin', 'storage', 'objects'] as const;
export const STORAGE_CONFIG_QUERY_KEY = ['admin', 'storage', 'config'] as const;

/**
 * Опции листинга вынесены из страницы: диалог перемещения ходит тем же запросом за папками
 * назначения, а импорт «страница → диалог → страница» дал бы цикл модулей.
 */
export function adminStorageObjectsQueryOptions(api: ApiClient, prefix: string) {
  return {
    queryKey: [...STORAGE_OBJECTS_QUERY_KEY, prefix] as const,
    queryFn: () => api.get<StorageListing>('/admin/storage/objects', { query: { prefix } }),
  };
}

export function adminStorageConfigQueryOptions(api: ApiClient) {
  return {
    queryKey: STORAGE_CONFIG_QUERY_KEY,
    queryFn: () => api.get<StorageConfig>('/admin/storage/config'),
  };
}
