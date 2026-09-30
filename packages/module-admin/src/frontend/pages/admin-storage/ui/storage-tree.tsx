import { useApiClient, useTranslation } from '@amplicada/platform-core/frontend';
import { ChevronDown, ChevronRight, Folder, HardDrive, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageListing } from '../../../../contracts/storage.js';
import { moveBlockReason } from '../lib/move.js';
import { objectName } from '../lib/paths.js';
import { useStorageDroppable } from './storage-dnd.js';

/** Пауза над свёрнутым узлом при перетаскивании, после которой узел раскрывается сам. */
const AUTO_EXPAND_DELAY_MS = 600;

export interface StorageTreeProps {
  prefix: string;
  onNavigate: (prefix: string) => void;
  /** Счётчик изменений листинга: раскрытые узлы перечитывают детей после create/rename/delete. */
  version: number;
  /** Ключи текущего перетаскивания; `null` — перетаскивания нет. Нужны подсветке невалидных целей. */
  dragKeys: string[] | null;
}

interface TreeNodeProps {
  nodePrefix: string;
  name: string;
  depth: number;
  activePrefix: string;
  expanded: string[];
  loading: string[];
  childNodesByPrefix: Record<string, string[]>;
  dragKeys: string[] | null;
  onToggle: (prefix: string) => void;
  onExpand: (prefix: string) => void;
  onNavigate: (prefix: string) => void;
}

/**
 * Узел дерева: собственный компонент, а не рекурсивная функция — dnd-хук требует один узел на
 * элемент, а хуки в рекурсивном рендере без компонента нарушают правила React.
 */
function TreeNode({
  nodePrefix,
  name,
  depth,
  activePrefix,
  expanded,
  loading,
  childNodesByPrefix,
  dragKeys,
  onToggle,
  onExpand,
  onNavigate,
}: TreeNodeProps) {
  const { setNodeRef, isOver } = useStorageDroppable(nodePrefix);
  const isRoot = nodePrefix === '';
  const isExpanded = expanded.includes(nodePrefix);
  const isLoading = loading.includes(nodePrefix);
  const isActive = activePrefix === nodePrefix;
  const childNodes = childNodesByPrefix[nodePrefix] ?? [];
  // Узел принимает drop; невалидная цель (папка в себя/потомка, no-op) — красная и not-allowed.
  const over = isOver && dragKeys !== null;
  const dropClass = over
    ? moveBlockReason(dragKeys, nodePrefix) !== null
      ? 'bg-destructive/10 ring-1 ring-destructive'
      : 'bg-primary/10 ring-1 ring-primary'
    : '';

  // Авто-раскрытие: задержался над свёрнутым узлом с детьми — раскрываем его. Корень не трогаем:
  // он раскрыт по умолчанию, а самопроизвольное раскрытие сверх этого — сюрприз. Таймер снимается
  // уходом курсора и размонтированием.
  const canAutoExpand = !isRoot && !isExpanded && childNodes.length > 0;
  useEffect(() => {
    if (!over || !canAutoExpand) return;
    const timer = window.setTimeout(() => onExpand(nodePrefix), AUTO_EXPAND_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [over, canAutoExpand, nodePrefix, onExpand]);

  return (
    <div>
      <div
        ref={setNodeRef}
        data-tree-prefix={nodePrefix}
        className={`flex items-center gap-1 rounded-sm pr-1 ${isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'} ${dropClass}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          aria-expanded={isExpanded}
          onClick={() => onToggle(nodePrefix)}
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
      {isExpanded &&
        childNodes.map(child => (
          <TreeNode
            key={child}
            nodePrefix={child}
            name={objectName(child.replace(/\/+$/, ''))}
            depth={depth + 1}
            activePrefix={activePrefix}
            expanded={expanded}
            loading={loading}
            childNodesByPrefix={childNodesByPrefix}
            dragKeys={dragKeys}
            onToggle={onToggle}
            onExpand={onExpand}
            onNavigate={onNavigate}
          />
        ))}
    </div>
  );
}

/**
 * Дерево папок слева. Дети узла тянутся лениво при раскрытии и кэшируются в состоянии компонента:
 * свёртывание не выкидывает уже загруженные уровни, а повторное раскрытие не ходит в API.
 */
export function StorageTree({ prefix, onNavigate, version, dragKeys }: StorageTreeProps) {
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
        // Дереву нужны все подпапки уровня, а не первая страница листинга: просим потолок
        // `limit=1000` и курсор дальше не ведём — обрезанное дерево врало бы о структуре.
        const listing = await api.get<StorageListing>('/admin/storage/objects', {
          query: { prefix: nodePrefix, limit: 1000 },
        });
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

  // Авто-раскрытие только раскрывает: «свернуть наведением» смысла не имеет, а `toggle` мог бы
  // свернуть узел, если пользователь успел кликнуть по нему во время паузы.
  const expand = useCallback((nodePrefix: string) => {
    setExpanded(current => (current.includes(nodePrefix) ? current : [...current, nodePrefix]));
  }, []);

  return (
    <nav className="max-h-[70vh] overflow-y-auto p-2 text-sm" aria-label={t('admin_storage_title')}>
      <TreeNode
        nodePrefix=""
        name={t('admin_storage_title')}
        depth={0}
        activePrefix={prefix}
        expanded={expanded}
        loading={loading}
        childNodesByPrefix={children}
        dragKeys={dragKeys}
        onToggle={toggle}
        onExpand={expand}
        onNavigate={onNavigate}
      />
    </nav>
  );
}
