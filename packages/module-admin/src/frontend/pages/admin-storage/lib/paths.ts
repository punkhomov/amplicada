import type { ApiClient } from '@amplicada/platform-core/frontend';

/** Имя файла из ключа: последний сегмент. */
export function objectName(key: string): string {
  return key.split('/').pop() || key;
}

/** Имя папки относительно текущего уровня: `learning/pkg/` при текущем `learning/` → `pkg`. */
export function folderName(prefix: string, parentPrefix: string): string {
  return prefix.slice(parentPrefix.length).replace(/\/+$/, '') || prefix;
}

/** Родительская папка: `a/b/` → `a/`; у папки верхнего уровня родитель — корень (`''`). */
export function parentPrefix(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? '' : trimmed.slice(0, index + 1);
}

/** Ключ после перемещения: имя элемента сохраняется, меняется только папка. */
export function moveTarget(key: string, destination: string): string {
  const folder = normalizePrefix(destination);
  const name = objectName(key.replace(/\/+$/, ''));
  return key.endsWith('/') ? `${folder}${name}/` : `${folder}${name}`;
}

/** Ключ после переименования: папка та же, меняется последний сегмент. */
export function renameTarget(key: string, name: string): string {
  const clean = name.replace(/\/+$/, '');
  return `${parentPrefix(key)}${clean}${key.endsWith('/') ? '/' : ''}`;
}

/**
 * `candidate` — сам `prefix` или ключ под ним. Сам префикс входит в поддерево намеренно: проверка
 * «нельзя бросить папку в себя» не требует отдельного сравнения ключей. Слэш на конце нормализуется,
 * иначе `a` считался бы префиксом `ab/file.txt`.
 */
export function isInside(prefix: string, candidate: string): boolean {
  const root = normalizePrefix(prefix);
  return root === '' || candidate.startsWith(root);
}

/** Сегменты текущего префикса с накопленным путём: `learning/pkg/` → `learning/`, `learning/pkg/`. */
export function folderTrail(prefix: string): { name: string; prefix: string }[] {
  const parts = prefix.split('/').filter(Boolean);
  return parts.map((part, index) => ({
    name: part,
    prefix: `${parts.slice(0, index + 1).join('/')}/`,
  }));
}

/** Префикс папки в каноническом виде — без ведущих слэшей и с завершающим: `b` и `/` → `b/` и `''`. */
function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function storageViewUrl(api: ApiClient, key: string): string {
  return `${api.baseUrl}/admin/storage/objects/view?key=${encodeURIComponent(key)}`;
}

export function storageDownloadUrl(api: ApiClient, key: string): string {
  return `${api.baseUrl}/admin/storage/objects/download?key=${encodeURIComponent(key)}`;
}
