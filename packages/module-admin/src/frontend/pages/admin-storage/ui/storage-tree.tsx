import { useApiClient, useTranslation } from '@amplicada/platform-core/frontend';
import { ChevronDown, ChevronRight, Folder, HardDrive, LoaderCircle } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { StorageListing } from '../../../../contracts/storage.js';
import { objectName } from '../lib/paths.js';

export interface StorageTreeProps {
  prefix: string;
  onNavigate: (prefix: string) => void;
  /** Счётчик изменений листинга: раскрытые узлы перечитывают детей после create/rename/delete. */
  version: number;
}

/**
 * Дерево папок слева. Дети узла тянутся лениво при раскрытии и кэшируются в состоянии компонента:
 * свёртывание не выкидывает уже загруженные уровни, а повторное раскрытие не ходит в API.
 */
export function StorageTree({ prefix, onNavigate, version }: StorageTreeProps) {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const [children, setChildren] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>(['']);
  const loaded = useRef(new Set<string>());

  const load = useCallback(
    async (nodePrefix: string) => {
      setLoading(current => (current.includes(nodePrefix) ? current : [...current, nodePrefix]));
      try {
        const listing = await api.get<StorageListing>('/admin/storage/objects', { query: { prefix: nodePrefix } });
        setChildren(current => ({ ...current, [nodePrefix]: listing.prefixes }));
      } catch {
        // Ошибку не помечаем загруженной: повторное раскрытие узла попробует ещё раз.
        loaded.current.delete(nodePrefix);
      } finally {
        setLoading(current => current.filter(item => item !== nodePrefix));
      }
    },
    [api],
  );

  // Ленивая загрузка раскрытых узлов: корень раскрыт по умолчанию, поэтому первый уровень виден сразу.
  useEffect(() => {
    for (const nodePrefix of expanded) {
      if (loaded.current.has(nodePrefix)) continue;
      loaded.current.add(nodePrefix);
      void load(nodePrefix);
    }
  }, [expanded, load]);

  // Мутации меняют содержимое папок: перечитываем только то, что уже раскрыто, — свёрнутые узлы
  // остаются нетронутыми, а раскрытое состояние и кэш при этом не теряются.
  useEffect(() => {
    if (version === 0) return;
    for (const nodePrefix of loaded.current) void load(nodePrefix);
  }, [version, load]);

  // Переход по глубокой ссылке/крошкам: раскрываем всех предков текущего префикса, иначе
  // подсвеченный узел просто не отрисован и «активный» ничего не значит.
  useEffect(() => {
    const parts = prefix.split('/').filter(Boolean);
    if (!parts.length) return;
    const ancestors = [''];
    for (let index = 0; index < parts.length - 1; index++) {
      ancestors.push(`${parts.slice(0, index + 1).join('/')}/`);
    }
    setExpanded(current => {
      const missing = ancestors.filter(item => !current.includes(item));
      return missing.length ? [...current, ...missing] : current;
    });
  }, [prefix]);

  const toggle = (nodePrefix: string) => {
    setExpanded(current => (current.includes(nodePrefix) ? current.filter(item => item !== nodePrefix) : [...current, nodePrefix]));
  };

  const renderNode = (nodePrefix: string, name: string, depth: number): ReactNode => {
    const isRoot = nodePrefix === '';
    const isExpanded = expanded.includes(nodePrefix);
    const isLoading = loading.includes(nodePrefix);
    const isActive = prefix === nodePrefix;
    return (
      <div key={nodePrefix || '\u0000root'}>
        <div
          data-tree-prefix={nodePrefix}
          className={`flex items-center gap-1 rounded-sm pr-1 ${isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            aria-expanded={isExpanded}
            onClick={() => toggle(nodePrefix)}
          >
            {isLoading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
            title={name}
            onClick={() => onNavigate(nodePrefix)}
          >
            {isRoot ? (
              <HardDrive className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className={`truncate ${isActive ? 'font-medium' : ''}`}>{name}</span>
          </button>
        </div>
        {isExpanded && (children[nodePrefix] ?? []).map(child => renderNode(child, objectName(child.replace(/\/+$/, '')), depth + 1))}
      </div>
    );
  };

  return (
    <nav className="max-h-[70vh] overflow-y-auto p-2 text-sm" aria-label={t('admin_storage_title')}>
      {renderNode('', t('admin_storage_title'), 0)}
    </nav>
  );
}
