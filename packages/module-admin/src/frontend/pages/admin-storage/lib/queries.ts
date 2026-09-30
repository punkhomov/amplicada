import type { ApiClient } from '@amplicada/platform-core/frontend';
import type { StorageConfig, StorageListing } from '../../../../contracts/storage.js';

/** Ключи кэша страницы хранилища: по ним инвалидируются и листинги, и конфиг. */
export const STORAGE_OBJECTS_QUERY_KEY = ['admin', 'storage', 'objects'] as const;
export const STORAGE_CONFIG_QUERY_KEY = ['admin', 'storage', 'config'] as const;

/**
 * Первая страница листинга одним запросом. Не для скролла: диалог перемещения — навигатор
 * по папкам, и обрезанная страница спрятала бы от него часть подпапок. Поэтому просим потолок
 * `limit=1000`, а отправлять `nextToken` этот потребитель и не собирается.
 *
 * Ключ отличается от бесконечного (`first-page`): под одним ключом React Query не может держать
 * и `StorageListing`, и `InfiniteData` — читатель чужой формы падал бы на `prefixes.length`.
 */
export function adminStorageObjectsQueryOptions(api: ApiClient, prefix: string) {
  return {
    queryKey: [...STORAGE_OBJECTS_QUERY_KEY, 'first-page', prefix] as const,
    queryFn: () => api.get<StorageListing>('/admin/storage/objects', { query: { prefix, limit: 1000 } }),
  };
}

/**
 * Бесконечный листинг содержимого папки: `nextToken` предыдущей страницы передаётся курсором,
 * его отсутствие (`undefined`) помечает последнюю страницу. Префикс входит в queryKey —
 * смена папки автоматически начинает список страниц с нуля.
 */
export function storageObjectsInfiniteQueryOptions(api: ApiClient, prefix: string) {
  return {
    queryKey: [...STORAGE_OBJECTS_QUERY_KEY, prefix] as const,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<StorageListing>('/admin/storage/objects', { query: { prefix, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: StorageListing) => last.nextToken,
  };
}

export function adminStorageConfigQueryOptions(api: ApiClient) {
  return {
    queryKey: STORAGE_CONFIG_QUERY_KEY,
    queryFn: () => api.get<StorageConfig>('/admin/storage/config'),
  };
}
