import type { StorageEntry } from './entries.js';

export type StorageSortKey = 'name' | 'size' | 'modified' | 'type';

export interface StorageSort {
  key: StorageSortKey;
  direction: 'asc' | 'desc';
}

/**
 * Папки всегда выше файлов — как в проводнике: сортировка по колонке не должна разбрасывать их
 * по списку. Равенство по выбранному полю разрешается именем по возрастанию, чтобы при равных
 * размерах/датах порядок оставался предсказуемым, а не зависел от порядка листинга.
 */
export function sortEntries(entries: StorageEntry[], sort: StorageSort): StorageEntry[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const primary = compareBy(a, b, sort.key) * factor;
    return primary !== 0 ? primary : a.name.localeCompare(b.name);
  });
}

function compareBy(a: StorageEntry, b: StorageEntry, key: StorageSortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'size':
      // У папки размера нет: внутри своей группы она ведёт себя как пустая, а не прыгает в конец.
      return (a.size ?? 0) - (b.size ?? 0);
    case 'modified':
      // ISO-даты сравнимы строками; отсутствующая дата — самая старая.
      return compareText(a.lastModified ?? '', b.lastModified ?? '');
    case 'type':
      return compareText(extensionOf(a.name), extensionOf(b.name));
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Расширение из имени: `.gitignore` и имя без точки — без расширения. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
