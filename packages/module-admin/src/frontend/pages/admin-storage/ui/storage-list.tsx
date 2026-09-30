import { type FileKind, fileExtension, fileKindOf, formatBytes } from '@amplicada/file-viewer/frontend';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { ArrowDown, ArrowUp, Download, Eye, File, FileAudio, FileImage, FileText, FileType, FileVideo, Folder, Trash2 } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { StorageEntry } from '../lib/entries.js';
import { formatDate } from '../lib/format.js';
import { moveBlockReason } from '../lib/move.js';
import type { SelectionState } from '../lib/selection.js';
import type { StorageSort, StorageSortKey } from '../lib/sort.js';
import { useStorageDraggable, useStorageDroppable } from './storage-dnd.js';

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
  /** Ключи текущего перетаскивания; `null` — перетаскивания нет. Нужны подсветке невалидных целей. */
  dragKeys: string[] | null;
  onRowContextMenu: (entry: StorageEntry, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  /** Есть ли ещё страницы листинга; `false` — sentinel-строка не рендерится. */
  hasNextPage: boolean;
  /** Идёт догрузка следующей страницы: sentinel показывает текст загрузки. */
  isFetchingNextPage: boolean;
  /** Догрузка упала: sentinel показывает «Повторить» вместо автозапроса. */
  loadMoreError?: boolean;
  /** Запросить следующую страницу; зовётся sentinel-строкой при попадании в зону видимости. */
  onLoadMore: () => void;
}

/** Общий контракт sentinel-элемента бесконечного скролла для списка и плиток. */
export interface StorageLoadMoreProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Догрузка упала: автоподхват выключается, sentinel показывает «Повторить» вместо запроса. */
  loadMoreError?: boolean;
}

/**
 * Наблюдатель sentinel-элемента: как только тот попадает в `rootMargin` вьюпорта, зовём
 * `onLoadMore`. Наблюдатель одноразовый — после срабатывания отключается, а эффект пересоздаёт
 * его только когда догрузка закончилась; так исчерпанный `nextToken` (`hasNextPage === false`)
 * гарантированно останавливает цикл запросов.
 */
export function useLoadMoreSentinel({ hasNextPage, isFetchingNextPage, onLoadMore, loadMoreError }: StorageLoadMoreProps) {
  const node = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = node.current;
    // При ошибке ждём ручного «Повторить»: иначе sentinel в зоне видимости зациклит падающие запросы.
    if (!element || !hasNextPage || isFetchingNextPage || loadMoreError) return;
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
  }, [hasNextPage, isFetchingNextPage, loadMoreError, onLoadMore]);
  // Колбэк-ref, а не `useRef`: sentinel появляется только с `hasNextPage`, и ссылка обязана
  // быть записана до пассивного эффекта того же рендера.
  return useCallback((element: HTMLElement | null) => {
    node.current = element;
  }, []);
}

interface StorageRowProps {
  entry: StorageEntry;
  isSelected: boolean;
  renaming: boolean;
  dragKeys: string[] | null;
  onRowClick: (entry: StorageEntry, event: ReactMouseEvent<HTMLElement>) => void;
  onRenameStart: (key: string) => void;
  onRowContextMenu: (entry: StorageEntry, event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onCheck: (key: string, checked: boolean) => void;
  onCommitEdit: (name: string) => void;
  onCancelEdit: () => void;
  onDelete: (entry: StorageEntry) => void;
  onDownload: (key: string) => void;
  onPreview: (entry: StorageEntry) => void;
}

/**
 * Строка списка: собственный компонент, а не тело `map` — dnd-хуки обязаны вызываться на элемент
 * (у draggable и droppable свой ref), а хуки внутри цикла запрещены правилами React.
 */
function StorageRow({
  entry,
  isSelected,
  renaming,
  dragKeys,
  onRowClick,
  onRenameStart,
  onRowContextMenu,
  onCheck,
  onCommitEdit,
  onCancelEdit,
  onDelete,
  onDownload,
  onPreview,
}: StorageRowProps) {
  const { t } = useTranslation('admin');
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useStorageDraggable(entry);
  const isFolder = entry.kind === 'folder';
  const { setNodeRef: setDropRef, isOver } = useStorageDroppable(entry.key, isFolder);
  const previewable = entry.kind === 'file' && fileKindOf({ name: entry.key }) !== 'other';
  // Невалидная цель (папка в себя/потомка, no-op) — красная; ring, а не bg: фон выбранной строки
  // его перекрыл бы, а контур виден при любом состоянии строки.
  const over = isFolder && isOver && dragKeys !== null;
  const dropClass = over
    ? moveBlockReason(dragKeys, entry.key) !== null
      ? 'ring-1 ring-destructive bg-destructive/10'
      : 'ring-1 ring-primary bg-primary/10'
    : '';
  // Два ref на одной строке: источник перетаскивания и цель drop. У файла droppable выключен
  // флагом в хуке (dnd-kit регистрирует контейнеры безусловно). `useCallback` обязателен:
  // новый ref каждый рендер заставлял бы dnd-kit переподключать ResizeObserver к узлу.
  const setRefs = useCallback(
    (node: HTMLTableRowElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return (
    <TableRow
      ref={setRefs}
      data-state={isSelected ? 'selected' : undefined}
      className={`cursor-pointer select-none ${dropClass} ${isDragging ? 'opacity-50' : ''}`}
      onClick={event => onRowClick(entry, event)}
      onDoubleClick={() => onRenameStart(entry.key)}
      onContextMenu={event => onRowContextMenu(entry, event)}
      {...attributes}
      {...listeners}
    >
      <TableCell onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <Checkbox checked={isSelected} onCheckedChange={checked => onCheck(entry.key, checked)} aria-label={t('admin_list_select_row')} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {renaming ? (
            <InlineNameInput initial={entry.name} onCommit={onCommitEdit} onCancel={onCancelEdit} />
          ) : (
            <>
              {isFolder ? <Folder className="size-4 text-muted-foreground" /> : <FileKindIcon kind={fileKindOf({ name: entry.key })} />}
              <span className={entry.kind === 'file' ? 'font-mono text-xs' : 'font-medium'}>{entry.name}</span>
            </>
          )}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">{entry.kind === 'folder' ? '—' : formatBytes(entry.size ?? 0)}</TableCell>
      <TableCell className="text-muted-foreground">{entry.kind === 'folder' ? '—' : formatDate(entry.lastModified)}</TableCell>
      <TableCell className="text-muted-foreground uppercase">
        {entry.kind === 'folder' ? '—' : fileExtension(entry.name) || t('admin_storage_other')}
      </TableCell>
      <TableCell onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <div className="flex justify-end gap-1">
          {previewable && (
            <Button variant="outline" size="icon" title={t('admin_storage_preview')} onClick={() => onPreview(entry)}>
              <Eye className="size-4" />
            </Button>
          )}
          {entry.kind === 'file' && (
            <Button variant="outline" size="icon" title={t('admin_storage_download')} onClick={() => onDownload(entry.key)}>
              <Download className="size-4" />
            </Button>
          )}
          <Button variant="outline" size="icon" title={t('admin_storage_delete')} onClick={() => onDelete(entry)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function StorageList(props: StorageListProps) {
  const { t } = useTranslation('admin');
  const { entries, sort, selection, editing } = props;
  const loadMoreRef = useLoadMoreSentinel(props);

  const selected = new Set(selection.keys);
  const allSelected = entries.length > 0 && entries.every(entry => selected.has(entry.key));
  const someSelected = entries.some(entry => selected.has(entry.key));

  const handleRowClick = (entry: StorageEntry, event: ReactMouseEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      props.onRowClick(entry, event);
      return;
    }
    // Задержку «клик vs двойной клик» держит страница: таймер общий со плиткой, и его гасят
    // F2/Delete/чекбоксы, чтобы превью не всплыло поверх правки или удалённого ключа.
    props.onOpen(entry);
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

        {entries.map(entry => (
          <StorageRow
            key={entry.key}
            entry={entry}
            isSelected={selected.has(entry.key)}
            renaming={editing?.mode === 'rename' && editing.key === entry.key}
            dragKeys={props.dragKeys}
            onRowClick={handleRowClick}
            onRenameStart={props.onRenameStart}
            onRowContextMenu={props.onRowContextMenu}
            onCheck={props.onCheck}
            onCommitEdit={props.onCommitEdit}
            onCancelEdit={props.onCancelEdit}
            onDelete={props.onDelete}
            onDownload={props.onDownload}
            onPreview={props.onPreview}
          />
        ))}

        {/* Sentinel бесконечного скролла: пустая строка-маркер в конце, пока есть `nextToken`. */}
        {props.hasNextPage && (
          <TableRow ref={loadMoreRef} data-slot="storage-load-more">
            <TableCell colSpan={6} className="py-2 text-center text-sm text-muted-foreground">
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
