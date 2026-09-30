import { fileKindOf, formatBytes } from '@amplicada/file-viewer/frontend';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Folder } from 'lucide-react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { StorageEntry } from '../lib/entries.js';
import type { SelectionState } from '../lib/selection.js';
import { useStorageDropTarget } from './storage-drop.js';
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
  /** Ключи текущего перетаскивания; `null` — перетаскивания нет. */
  dragKeys: string[] | null;
  onDragStart: (entry: StorageEntry, event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onRowContextMenu: (entry: StorageEntry, event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Drop на карточку-папку: destination — ключ папки. */
  onDropMove: (destination: string, keys: string[]) => void;
  /** Есть ли ещё страницы листинга; `false` — sentinel не рендерится. */
  hasNextPage: boolean;
  /** Идёт догрузка следующей страницы: sentinel показывает текст загрузки. */
  isFetchingNextPage: boolean;
  /** Запросить следующую страницу; зовётся sentinel-элементом при попадании в зону видимости. */
  onLoadMore: () => void;
  /** Догрузка упала: sentinel показывает «Повторить» вместо автозапроса. */
  loadMoreError?: boolean;
}

/** Плитка повторяет семантику списка (клик/модификаторы/чекбокс/двойной клик) другими средствами. */
export function StorageTiles(props: StorageTilesProps) {
  const { t } = useTranslation('admin');
  const selected = new Set(props.selection.keys);
  const drop = useStorageDropTarget(props.dragKeys, props.onDropMove);
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
      {props.entries.map(entry => {
        const isSelected = selected.has(entry.key);
        const renaming = props.editing?.mode === 'rename' && props.editing.key === entry.key;
        // Drop-цель — только карточка-папка; невалидная цель подсвечивается красным и не принимает drop.
        const isDropTarget = entry.kind === 'folder' && props.dragKeys !== null && drop.overPrefix === entry.key;
        const dropClass = isDropTarget
          ? drop.invalidFor(entry.key)
            ? 'border-destructive ring-1 ring-destructive'
            : 'border-primary ring-1 ring-primary'
          : '';
        const icon =
          entry.kind === 'folder' ? (
            <Folder className="size-8 text-muted-foreground" />
          ) : (
            <FileKindIcon kind={fileKindOf({ name: entry.key })} className="size-8 text-muted-foreground" />
          );
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: карточка — drag-обёртка, клики живут на вложенной кнопке
          <div
            key={entry.key}
            data-slot="storage-tile"
            data-state={isSelected ? 'selected' : undefined}
            draggable
            onContextMenu={event => props.onRowContextMenu(entry, event)}
            onDragStart={event => props.onDragStart(entry, event)}
            onDragEnd={props.onDragEnd}
            {...(entry.kind === 'folder' ? drop.handlersFor(entry.key) : {})}
            className={`relative flex cursor-pointer select-none flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors ${
              isSelected ? 'border-primary bg-accent' : 'hover:bg-accent/50'
            } ${dropClass}`}
          >
            <span className="absolute left-2 top-2">
              <Checkbox
                checked={isSelected}
                onCheckedChange={checked => props.onCheck(entry.key, checked)}
                aria-label={t('admin_list_select_row')}
              />
            </span>
            {renaming ? (
              <>
                {icon}
                <InlineNameInput
                  initial={entry.name}
                  className="h-7 w-full max-w-none text-xs"
                  onCommit={props.onCommitEdit}
                  onCancel={props.onCancelEdit}
                />
              </>
            ) : (
              // Карточка — настоящая кнопка: клавиатура получает Enter/Space бесплатно, а чекбокс
              // и инлайн-инпут отрисовываются соседями, а не вложенными интерактивными элементами.
              <button
                type="button"
                className="flex w-full flex-1 flex-col items-center gap-2"
                onClick={event => handleClick(entry, event)}
                onDoubleClick={() => props.onRenameStart(entry.key)}
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
      })}
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
