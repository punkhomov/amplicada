import { fileKindOf, formatBytes } from '@amplicada/file-viewer/frontend';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Folder } from 'lucide-react';
import { type MouseEvent as ReactMouseEvent, useCallback } from 'react';
import type { StorageEntry } from '../lib/entries.js';
import { moveBlockReason } from '../lib/move.js';
import type { SelectionState } from '../lib/selection.js';
import { useStorageDraggable, useStorageDroppable } from './storage-dnd.js';
import { FileKindIcon, InlineNameInput, type StorageEditing, useLoadMoreSentinel } from './storage-list.js';

export interface StorageTilesProps {
  entries: StorageEntry[];
  selection: SelectionState;
  editing: StorageEditing;
  /** Ctrl/Cmd- или Shift-клик — как в списке: страница решает, как перестроить выбор. */
  onRowClick: (entry: StorageEntry, event: ReactMouseEvent<HTMLElement>) => void;
  onOpen: (entry: StorageEntry) => void;
  onCheck: (key: string, checked: boolean) => void;
  onCommitEdit: (name: string) => void;
  onCancelEdit: () => void;
  onRenameStart: (key: string) => void;
  /** Ключи текущего перетаскивания; `null` — перетаскивания нет. Нужны подсветке невалидных целей. */
  dragKeys: string[] | null;
  onRowContextMenu: (entry: StorageEntry, event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Есть ли ещё страницы листинга; `false` — sentinel не рендерится. */
  hasNextPage: boolean;
  /** Идёт догрузка следующей страницы: sentinel показывает текст загрузки. */
  isFetchingNextPage: boolean;
  /** Запросить следующую страницу; зовётся sentinel-элементом при попадании в зону видимости. */
  onLoadMore: () => void;
  /** Догрузка упала: sentinel показывает «Повторить» вместо автозапроса. */
  loadMoreError?: boolean;
}

interface StorageTileProps {
  entry: StorageEntry;
  isSelected: boolean;
  renaming: boolean;
  dragKeys: string[] | null;
  onClick: (entry: StorageEntry, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRenameStart: (key: string) => void;
  onRowContextMenu: (entry: StorageEntry, event: ReactMouseEvent<HTMLDivElement>) => void;
  onCheck: (key: string, checked: boolean) => void;
  onCommitEdit: (name: string) => void;
  onCancelEdit: () => void;
}

/**
 * Карточка плитки: собственный компонент — dnd-хукам нужен один узел на элемент, а хуки в `.map`
 * запрещены. Клики живут на вложенной кнопке, перетаскивание — на карточке-обёртке.
 */
function StorageTile({
  entry,
  isSelected,
  renaming,
  dragKeys,
  onClick,
  onRenameStart,
  onRowContextMenu,
  onCheck,
  onCommitEdit,
  onCancelEdit,
}: StorageTileProps) {
  const { t } = useTranslation('admin');
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useStorageDraggable(entry);
  const isFolder = entry.kind === 'folder';
  const { setNodeRef: setDropRef, isOver } = useStorageDroppable(entry.key, isFolder);
  // Невалидная цель (папка в себя/потомка, no-op) — красная: drop всё равно гасится в onDragEnd.
  const over = isFolder && isOver && dragKeys !== null;
  const dropClass = over
    ? moveBlockReason(dragKeys, entry.key) !== null
      ? 'ring-1 ring-destructive bg-destructive/10'
      : 'ring-1 ring-primary bg-primary/10'
    : '';
  // Два ref на одной карточке: источник перетаскивания и цель drop. `useCallback` обязателен:
  // новый ref каждый рендер заставлял бы dnd-kit переподключать ResizeObserver к узлу.
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  const icon =
    entry.kind === 'folder' ? (
      <Folder className="size-8 text-muted-foreground" />
    ) : (
      <FileKindIcon kind={fileKindOf({ name: entry.key })} className="size-8 text-muted-foreground" />
    );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: карточка — drag-обёртка, клики живут на вложенной кнопке
    <div
      ref={setRefs}
      data-slot="storage-tile"
      data-state={isSelected ? 'selected' : undefined}
      onContextMenu={event => onRowContextMenu(entry, event)}
      className={`relative flex cursor-pointer select-none flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors ${
        isSelected ? 'border-primary bg-accent' : 'hover:bg-accent/50'
      } ${dropClass} ${isDragging ? 'opacity-50' : ''}`}
      {...attributes}
      {...listeners}
    >
      <span className="absolute left-2 top-2">
        <Checkbox checked={isSelected} onCheckedChange={checked => onCheck(entry.key, checked)} aria-label={t('admin_list_select_row')} />
      </span>
      {renaming ? (
        <>
          {icon}
          <InlineNameInput initial={entry.name} className="h-7 w-full max-w-none text-xs" onCommit={onCommitEdit} onCancel={onCancelEdit} />
        </>
      ) : (
        // Карточка — настоящая кнопка: клавиатура получает Enter/Space бесплатно, а чекбокс
        // и инлайн-инпут отрисовываются соседями, а не вложенными интерактивными элементами.
        // `data-dnd-drag-surface` оставляет её поверхностью drag: иначе guard интерактивных
        // целей запретил бы тащить плитку за единственную крупную область карточки.
        <button
          type="button"
          data-dnd-drag-surface
          className="flex w-full flex-1 flex-col items-center gap-2"
          onClick={event => onClick(entry, event)}
          onDoubleClick={() => onRenameStart(entry.key)}
          onKeyDown={event => {
            // Enter на кнопке открывает её же нативным кликом; страничный хоткей Enter
            // не должен обработать то же нажатие второй раз (и открыть другую строку).
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
          }}
        >
          {icon}
          <span className="w-full truncate text-sm" title={entry.name}>
            {entry.name}
          </span>
          <span className="text-xs text-muted-foreground">{entry.kind === 'folder' ? '—' : formatBytes(entry.size ?? 0)}</span>
        </button>
      )}
    </div>
  );
}

/** Плитка повторяет семантику списка (клик/модификаторы/чекбокс/двойной клик) другими средствами. */
export function StorageTiles(props: StorageTilesProps) {
  const { t } = useTranslation('admin');
  const selected = new Set(props.selection.keys);
  const loadMoreRef = useLoadMoreSentinel(props);

  const handleClick = (entry: StorageEntry, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      props.onRowClick(entry, event);
      return;
    }
    // Задержку открытия держит страница — таймер общий со списком и гасится хоткеями.
    props.onOpen(entry);
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3" data-slot="storage-tiles">
      {props.editing?.mode === 'create' && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-3" data-slot="storage-tile">
          <Folder className="size-8 text-muted-foreground" />
          <InlineNameInput
            initial=""
            placeholder={t('admin_storage_new_folder')}
            className="h-7 w-full max-w-none text-xs"
            onCommit={props.onCommitEdit}
            onCancel={props.onCancelEdit}
          />
        </div>
      )}
      {props.entries.map(entry => (
        <StorageTile
          key={entry.key}
          entry={entry}
          isSelected={selected.has(entry.key)}
          renaming={props.editing?.mode === 'rename' && props.editing.key === entry.key}
          dragKeys={props.dragKeys}
          onClick={handleClick}
          onRenameStart={props.onRenameStart}
          onRowContextMenu={props.onRowContextMenu}
          onCheck={props.onCheck}
          onCommitEdit={props.onCommitEdit}
          onCancelEdit={props.onCancelEdit}
        />
      ))}
      {/* Sentinel бесконечного скролла: на всю ширину сетки, пока есть `nextToken`. */}
      {props.hasNextPage && (
        <div ref={loadMoreRef} data-slot="storage-load-more" className="col-span-full py-2 text-center text-sm text-muted-foreground">
          {props.loadMoreError ? (
            <span className="inline-flex items-center gap-2">
              {t('admin_storage_load_more_error')}
              <button type="button" className="underline underline-offset-2" onClick={props.onLoadMore}>
                {t('admin_storage_retry')}
              </button>
            </span>
          ) : props.isFetchingNextPage ? (
            t('admin_storage_loading_more')
          ) : null}
        </div>
      )}
    </div>
  );
}
