import { type FileKind, fileExtension, fileKindOf, formatBytes } from '@amplicada/file-viewer/frontend';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { ArrowDown, ArrowUp, Download, Eye, File, FileAudio, FileImage, FileText, FileType, FileVideo, Folder, Trash2 } from 'lucide-react';
import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { StorageEntry } from '../lib/entries.js';
import { formatDate } from '../lib/format.js';
import type { SelectionState } from '../lib/selection.js';
import type { StorageSort, StorageSortKey } from '../lib/sort.js';
import { useStorageDropTarget } from './storage-drop.js';

/** Состояние инлайн-правки: одна строка на страницу — либо создание папки, либо переименование. */
export type StorageEditing = { mode: 'create' } | { mode: 'rename'; key: string } | null;

export interface StorageListProps {
  entries: StorageEntry[];
  sort: StorageSort;
  selection: SelectionState;
  editing: StorageEditing;
  onSort: (key: StorageSortKey) => void;
  /** Ctrl/Cmd- или Shift-клик: страница решает, как перестроить выбор. */
  onRowClick: (entry: StorageEntry, event: ReactMouseEvent<HTMLElement>) => void;
  onCheck: (key: string, checked: boolean) => void;
  onCheckAll: (checked: boolean) => void;
  onOpen: (entry: StorageEntry) => void;
  onCommitEdit: (name: string) => void;
  onCancelEdit: () => void;
  onRenameStart: (key: string) => void;
  onDelete: (entry: StorageEntry) => void;
  onDownload: (key: string) => void;
  onPreview: (entry: StorageEntry) => void;
  /** Ключи текущего перетаскивания; `null` — перетаскивания нет. */
  dragKeys: string[] | null;
  onDragStart: (entry: StorageEntry, event: ReactDragEvent<HTMLTableRowElement>) => void;
  onDragEnd: () => void;
  onRowContextMenu: (entry: StorageEntry, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  /** Drop на папку-строку: destination — ключ папки. */
  onDropMove: (destination: string, keys: string[]) => void;
  /** Есть ли ещё страницы листинга; `false` — sentinel-строка не рендерится. */
  hasNextPage: boolean;
  /** Идёт догрузка следующей страницы: sentinel показывает текст загрузки. */
  isFetchingNextPage: boolean;
  /** Запросить следующую страницу; зовётся sentinel-строкой при попадании в зону видимости. */
  onLoadMore: () => void;
}

/** Общий контракт sentinel-элемента бесконечного скролла для списка и плиток. */
export interface StorageLoadMoreProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

/**
 * Наблюдатель sentinel-элемента: как только тот попадает в `rootMargin` вьюпорта, зовём
 * `onLoadMore`. Наблюдатель одноразовый — после срабатывания отключается, а эффект пересоздаёт
 * его только когда догрузка закончилась; так исчерпанный `nextToken` (`hasNextPage === false`)
 * гарантированно останавливает цикл запросов.
 */
export function useLoadMoreSentinel({ hasNextPage, isFetchingNextPage, onLoadMore }: StorageLoadMoreProps) {
  const node = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = node.current;
    if (!element || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        // Отключаемся до запроса: одно появление в зоне видимости — один fetch.
        observer.disconnect();
        onLoadMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);
  // Колбэк-ref, а не `useRef`: sentinel появляется только с `hasNextPage`, и ссылка обязана
  // быть записана до пассивного эффекта того же рендера.
  return useCallback((element: HTMLElement | null) => {
    node.current = element;
  }, []);
}

export function StorageList(props: StorageListProps) {
  const { t } = useTranslation('admin');
  const { entries, sort, selection, editing } = props;
  const drop = useStorageDropTarget(props.dragKeys, props.onDropMove);
  const loadMoreRef = useLoadMoreSentinel(props);

  const selected = new Set(selection.keys);
  const allSelected = entries.length > 0 && entries.every(entry => selected.has(entry.key));
  const someSelected = entries.some(entry => selected.has(entry.key));

  const handleRowClick = (entry: StorageEntry, event: ReactMouseEvent<HTMLTableRowElement>) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      props.onRowClick(entry, event);
      return;
    }
    // Задержку «клик vs двойной клик» держит страница: таймер общий со плиткой, и его гасят
    // F2/Delete/чекбоксы, чтобы превью не всплыло поверх правки или удалённого ключа.
    props.onOpen(entry);
  };

  const handleRowDoubleClick = (entry: StorageEntry) => {
    props.onRenameStart(entry.key);
  };

  const renderName = (entry: StorageEntry) => {
    if (editing?.mode === 'rename' && editing.key === entry.key) {
      return <InlineNameInput initial={entry.name} onCommit={props.onCommitEdit} onCancel={props.onCancelEdit} />;
    }
    return (
      <>
        {entry.kind === 'folder' ? (
          <Folder className="size-4 text-muted-foreground" />
        ) : (
          <FileKindIcon kind={fileKindOf({ name: entry.key })} />
        )}
        <span className={entry.kind === 'file' ? 'font-mono text-xs' : 'font-medium'}>{entry.name}</span>
      </>
    );
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={allSelected}
              // Частичный выбор в шапке — промежуточное состояние, а не «все выбраны».
              indeterminate={someSelected && !allSelected}
              onCheckedChange={checked => props.onCheckAll(checked)}
              aria-label={t('admin_list_select_all')}
            />
          </TableHead>
          <SortableHead label={t('admin_storage_col_name')} sortKey="name" sort={sort} onSort={props.onSort} />
          <SortableHead label={t('admin_storage_col_size')} sortKey="size" sort={sort} onSort={props.onSort} className="w-28" />
          <SortableHead label={t('admin_storage_col_modified')} sortKey="modified" sort={sort} onSort={props.onSort} className="w-52" />
          <SortableHead label={t('admin_storage_col_type')} sortKey="type" sort={sort} onSort={props.onSort} className="w-28" />
          <TableHead className="w-36 text-right">{t('admin_storage_col_actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {editing?.mode === 'create' && (
          <TableRow className="bg-muted/40">
            <TableCell />
            <TableCell>
              <div className="flex items-center gap-2">
                <Folder className="size-4 text-muted-foreground" />
                <InlineNameInput
                  initial=""
                  placeholder={t('admin_storage_new_folder')}
                  onCommit={props.onCommitEdit}
                  onCancel={props.onCancelEdit}
                />
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell />
          </TableRow>
        )}

        {entries.map(entry => {
          const isSelected = selected.has(entry.key);
          const previewable = entry.kind === 'file' && fileKindOf({ name: entry.key }) !== 'other';
          // Drop-цель — только папка-строка: файл-цель бэкенд отвергнет коллизией.
          const isDropTarget = entry.kind === 'folder' && props.dragKeys !== null && drop.overPrefix === entry.key;
          const dropClass = isDropTarget ? (drop.invalidFor(entry.key) ? 'bg-destructive/10' : 'bg-accent') : '';
          return (
            <TableRow
              key={entry.key}
              draggable
              data-state={isSelected ? 'selected' : undefined}
              className={`cursor-pointer select-none ${dropClass}`}
              onClick={event => handleRowClick(entry, event)}
              onDoubleClick={() => handleRowDoubleClick(entry)}
              onContextMenu={event => props.onRowContextMenu(entry, event)}
              onDragStart={event => props.onDragStart(entry, event)}
              onDragEnd={props.onDragEnd}
              {...(entry.kind === 'folder' ? drop.handlersFor(entry.key) : {})}
            >
              <TableCell onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={checked => props.onCheck(entry.key, checked)}
                  aria-label={t('admin_list_select_row')}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">{renderName(entry)}</div>
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {entry.kind === 'folder' ? '—' : formatBytes(entry.size ?? 0)}
              </TableCell>
              <TableCell className="text-muted-foreground">{entry.kind === 'folder' ? '—' : formatDate(entry.lastModified)}</TableCell>
              <TableCell className="text-muted-foreground uppercase">
                {entry.kind === 'folder' ? '—' : fileExtension(entry.name) || t('admin_storage_other')}
              </TableCell>
              <TableCell onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
                <div className="flex justify-end gap-1">
                  {previewable && (
                    <Button variant="outline" size="icon" title={t('admin_storage_preview')} onClick={() => props.onPreview(entry)}>
                      <Eye className="size-4" />
                    </Button>
                  )}
                  {entry.kind === 'file' && (
                    <Button variant="outline" size="icon" title={t('admin_storage_download')} onClick={() => props.onDownload(entry.key)}>
                      <Download className="size-4" />
                    </Button>
                  )}
                  <Button variant="outline" size="icon" title={t('admin_storage_delete')} onClick={() => props.onDelete(entry)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}

        {/* Sentinel бесконечного скролла: пустая строка-маркер в конце, пока есть `nextToken`. */}
        {props.hasNextPage && (
          <TableRow ref={loadMoreRef} data-slot="storage-load-more">
            <TableCell colSpan={6} className="py-2 text-center text-sm text-muted-foreground">
              {props.isFetchingNextPage ? t('admin_storage_loading_more') : null}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: StorageSortKey;
  sort: StorageSort;
  onSort: (key: StorageSortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead className={className}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(sortKey)}>
        {label}
        {active && (sort.direction === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
      </button>
    </TableHead>
  );
}

export function InlineNameInput({
  initial,
  placeholder,
  className = 'h-7 max-w-64 text-xs',
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  className?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Input
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      className={className}
      onChange={event => setValue(event.target.value)}
      // Клик по инпуту не должен засчитываться строке: иначе открытие строки сработает поверх правки.
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      // Enter/Esc обрабатывает сам инпут, а не глобальные хоткеи страницы: подсветка и
      // подсказки оставлены браузеру, клавиши не всплывают к обработчику списка.
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export function FileKindIcon({ kind, className = 'size-4 text-muted-foreground' }: { kind: FileKind; className?: string }) {
  switch (kind) {
    case 'image':
      return <FileImage className={className} />;
    case 'video':
      return <FileVideo className={className} />;
    case 'audio':
      return <FileAudio className={className} />;
    case 'pdf':
      return <FileType className={className} />;
    case 'text':
      return <FileText className={className} />;
    default:
      return <File className={className} />;
  }
}
