import { FilePreviewDialog, type FileViewerLabels, fileKindOf, formatBytes } from '@amplicada/file-viewer/frontend';
import {
  ApiError,
  QueryError,
  useApiClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useTranslation,
} from '@amplicada/platform-core/frontend';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@amplicada/platform-core/frontend/ui/breadcrumb';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ArrowUp } from 'lucide-react';
import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { StorageDeleteResult, StorageMoveResult, StorageObject } from '../../../../contracts/storage.js';
import { type StorageEntry, toEntries } from '../lib/entries.js';
import { formatDate } from '../lib/format.js';
import { moveBlockReason } from '../lib/move.js';
import { folderName, folderTrail, objectName, parentPrefix, storageDownloadUrl, storageViewUrl } from '../lib/paths.js';
import { adminStorageConfigQueryOptions, STORAGE_OBJECTS_QUERY_KEY, storageObjectsInfiniteQueryOptions } from '../lib/queries.js';
import { selectionReducer } from '../lib/selection.js';
import { type StorageSort, type StorageSortKey, sortEntries } from '../lib/sort.js';
import { StorageContextMenu, type StorageContextMenuState } from './storage-context-menu.js';
import {
  StorageDragPreview,
  StoragePointerSensor,
  storageKeyFromDragId,
  storagePrefixFromDropId,
  useStorageDroppable,
} from './storage-dnd.js';
import { type StorageEditing, StorageList } from './storage-list.js';
import { StorageMoveDialog } from './storage-move-dialog.js';
import { StoragePropertiesDialog } from './storage-properties-dialog.js';
import { StorageStatusBar } from './storage-status-bar.js';
import { StorageTiles } from './storage-tiles.js';
import { StorageToolbar, type StorageView } from './storage-toolbar.js';
import { StorageTree } from './storage-tree.js';

export { adminStorageConfigQueryOptions, storageObjectsInfiniteQueryOptions } from '../lib/queries.js';

/**
 * Пауза перед открытием строки. Она же — окно, в котором второй клик успевает стать двойным:
 * без паузы первый клик уже открыл бы превью/папку, и переименовать двойным кликом было бы нельзя.
 */
const OPEN_DELAY_MS = 250;

/**
 * Стратегия столкновений: под курсором — приоритет `pointerWithin`, иначе `rectIntersection`
 * (клавиатурное перетаскивание идёт без координат указателя). Массив стратегий установленный
 * `@dnd-kit/core` 6.3.1 не принимает — композиция руками.
 */
const storageCollisionDetection: CollisionDetection = args => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};

/**
 * Цель drop адресной строки (крошка или кнопка «вверх»). Рендер элемента передаётся функцией:
 * ref и подсветка должны лежать на самом `li`/кнопке — обёртка сломала бы разметку `ol > li`.
 * Валидная цель подсвечивается primary-кольцом, невалидная — destructive, как у строк, плиток
 * и дерева; бросок всё равно гасится проверкой в `onDragEnd`.
 */
function AddressDropTarget({
  destination,
  dragKeys,
  className,
  render,
}: {
  destination: string;
  dragKeys: string[] | null;
  className?: string;
  render: (props: { ref: (node: HTMLElement | null) => void; className: string }) => ReactNode;
}) {
  const { setNodeRef, isOver } = useStorageDroppable(destination);
  const invalid = isOver && dragKeys !== null && moveBlockReason(dragKeys, destination) !== null;
  const active = isOver && dragKeys !== null && !invalid;
  const classes = `${className ?? ''} ${active ? 'rounded-sm ring-1 ring-primary' : ''} ${
    invalid ? 'rounded-sm ring-1 ring-destructive' : ''
  }`.trim();
  return <>{render({ ref: setNodeRef, className: classes })}</>;
}

export function AdminStorage() {
  const { t } = useTranslation('admin');
  const viewerLabels: Partial<FileViewerLabels> = {
    zoomIn: t('admin_storage_zoom_in'),
    zoomOut: t('admin_storage_zoom_out'),
    zoomReset: t('admin_storage_zoom_reset'),
    openExternal: t('admin_storage_open_external'),
    download: t('admin_storage_download'),
    unavailableTitle: t('admin_storage_preview_unsupported_title'),
    unavailableDescription: t('admin_storage_preview_unsupported_description'),
    failed: t('admin_storage_preview_failed'),
    textTruncated: t('admin_storage_preview_truncated'),
    loadMore: t('admin_storage_load_more'),
    edit: t('admin_storage_edit'),
    save: t('admin_storage_save'),
    saved: t('admin_storage_saved'),
    retry: t('admin_storage_retry'),
  };
  const api = useApiClient();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<StorageObject | null>(null);
  const [selection, dispatchSelection] = useReducer(selectionReducer, { keys: [], anchor: null });
  const [sort, setSort] = useState<StorageSort>({ key: 'name', direction: 'asc' });
  const [editing, setEditing] = useState<StorageEditing>(null);
  const [view, setView] = useState<StorageView>('list');
  const [treeVersion, setTreeVersion] = useState(0);
  const [menu, setMenu] = useState<StorageContextMenuState | null>(null);
  const [moveKeys, setMoveKeys] = useState<string[] | null>(null);
  const [propertiesKey, setPropertiesKey] = useState<string | null>(null);
  const [dragKeys, setDragKeys] = useState<string[] | null>(null);

  // Порог 5px, а не 0: без него клик и двойной клик по строке превращались бы в перетаскивание,
  // а чекбокс нельзя было бы нажать. `StoragePointerSensor` не даёт drag'у стартовать с
  // интерактивных элементов строки (кнопки, чекбокс, инлайн-инпут). Enter — документированный
  // хоткей «открыть», поэтому клавиатурный drag начинается только Space (Enter завершает уже
  // идущий drag).
  const sensors = useSensors(
    useSensor(StoragePointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const prefix = searchParams.get('prefix') ?? '';
  const {
    data,
    isLoading,
    isError,
    error: queryError,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery(storageObjectsInfiniteQueryOptions(api, prefix));
  // Правка — опциональная возможность деплоя: пока конфиг не приехал, превью только для чтения.
  const { data: config } = useQuery(adminStorageConfigQueryOptions(api));
  const editEnabled = config?.editEnabled ?? false;

  const entries = useMemo(() => {
    const term = search.trim().toLowerCase();
    // Поиск остаётся клиентским по догруженным страницам: серверного поиска у листинга нет,
    // поэтому фильтр сужает то, что уже принесено, и не исчезает при обрыве догрузки.
    const all = data ? data.pages.flatMap(page => toEntries(page)) : [];
    const filtered = term ? all.filter(entry => entry.name.toLowerCase().includes(term)) : all;
    return sortEntries(filtered, sort);
  }, [data, search, sort]);
  const visibleKeys = useMemo(() => entries.map(entry => entry.key), [entries]);
  const selectedKeys = useMemo(() => new Set(selection.keys), [selection.keys]);
  const objectsByKey = useMemo(
    () => new Map((data?.pages ?? []).flatMap(page => page.objects).map(object => [object.key, object])),
    [data],
  );

  // Догрузку запускает sentinel в конце списка; стабильная ссылка нужна, чтобы наблюдатель
  // не пересоздавался на каждом рендере (возврат к первой странице делает сам queryKey).
  const loadMore = useCallback(() => {
    // Ошибку догрузки показываем строкой sentinel'а; reject гасим, чтобы не плодить unhandled rejection.
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage().catch(() => undefined);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Выбор переживает смену списка, поэтому его надо подрезать до видимых ключей: иначе поиск
  // или уход в другую папку оставят «тихо выбранные» строки, и bulk-операция заденет лишнее.
  useEffect(() => {
    dispatchSelection({ type: 'sync', visible: visibleKeys });
  }, [visibleKeys]);

  // Отложенное открытие одно на страницу (строка и плитка кликаются одинаково), и погасить таймер
  // должны уметь хоткеи, чекбоксы и смена папки — иначе превью всплывёт поверх начатой правки
  // или уже удалённого ключа.
  const pendingOpen = useRef<number | null>(null);
  const cancelPendingOpen = useCallback(() => {
    if (pendingOpen.current !== null) {
      window.clearTimeout(pendingOpen.current);
      pendingOpen.current = null;
    }
  }, []);
  useEffect(() => cancelPendingOpen, [cancelPendingOpen]);

  // Правка и отложенное открытие не переживают смену папки: префикс меняется не только через
  // `navigateTo`, но и крошками, деревом и кнопками браузера, а строка к ним уже не относится.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `prefix` — причина сброса, в теле эффекта он не читается
  useEffect(() => {
    setEditing(null);
    cancelPendingOpen();
  }, [prefix, cancelPendingOpen]);

  const selectedBytes = useMemo(() => {
    let total = 0;
    for (const entry of entries) {
      if (entry.kind === 'file' && selectedKeys.has(entry.key)) total += entry.size ?? 0;
    }
    return total;
  }, [entries, selectedKeys]);

  const invalidate = () => {
    // Дерево кэширует детей по узлам — после мутаций его раскрытые уровни надо перечитать вручную.
    setTreeVersion(version => version + 1);
    queryClient.invalidateQueries({ queryKey: STORAGE_OBJECTS_QUERY_KEY });
  };

  // Стабильный объект источника: `FilePreview` пересоздаёт `readText`/`edit` на каждый рендер,
  // а новый `source` каждый рендер заставлял бы превью перечитывать файл.
  const previewSource = useMemo(
    () =>
      preview ? { type: 'url' as const, url: storageViewUrl(api, preview.key), name: objectName(preview.key), size: preview.size } : null,
    [api, preview],
  );

  const navigateTo = (next: string) => {
    setSearch('');
    // Инлайн-правка не должна переезжать в другую папку: строка, к которой она относилась, исчезла.
    setEditing(null);
    setSearchParams(next ? { prefix: next } : {});
  };

  const uploadMutation = useMutation({
    mutationFn: async (selected: File[]) => {
      for (const file of selected) {
        const formData = new FormData();
        formData.append('file', file);
        await api.post('/admin/storage/objects', formData, { query: { prefix } });
      }
    },
    onSuccess: invalidate,
    onError: () => alert(t('admin_storage_upload_error')),
  });

  const saveObjectMutation = useMutation({
    // Форма правки сохраняет текст в уже существующий объект — ключ уходит в query, тело — JSON.
    mutationFn: ({ key, content }: { key: string; content: string }) =>
      api.put<StorageObject>('/admin/storage/objects', { content }, { query: { key } }),
    onSuccess: invalidate,
    onError: () => alert(t('admin_storage_save_error')),
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.post<StorageObject>('/admin/storage/folder', { name }, { query: { prefix } }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (error: unknown) => {
      // Строка-плейсхолдер остаётся при ошибке: 409 — папка уже есть, 400 — невалидное имя,
      // и в обоих случаях имя проще поправить, чем набирать заново.
      const exists = error instanceof ApiError && error.status === 409;
      alert(t(exists ? 'admin_storage_folder_exists' : 'admin_storage_invalid_name'));
    },
  });

  const renameMutation = useMutation({
    // Переименование — это move в ту же папку с новым именем: целевой ключ собирает бэкенд.
    mutationFn: ({ key, name }: { key: string; name: string }) =>
      api.post<StorageMoveResult>('/admin/storage/move', {
        keys: [key],
        // Корень бэкенд понимает как `/`, пустая строка не проходит валидацию destination.
        destination: parentPrefix(key) || '/',
        name,
      }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: () => alert(t('admin_storage_rename_error')),
  });

  const moveMutation = useMutation({
    // `destination: ''` — корень; пустую строку бэкенд не пропустит, ему нужен `/`.
    mutationFn: ({ keys, destination }: { keys: string[]; destination: string }) =>
      api.post<StorageMoveResult>('/admin/storage/move', { keys, destination: destination || '/' }),
    onSuccess: () => {
      dispatchSelection({ type: 'clear' });
      invalidate();
    },
  });

  const deleteKeysMutation = useMutation({
    // Папки сносятся рекурсивным роутом, файлы — пакетным: `DELETE /objects { keys }` удаляет
    // ровно перечисленные ключи, и от папки осталось бы содержимое без маркера.
    mutationFn: async (keys: string[]) => {
      const folders = keys.filter(key => key.endsWith('/'));
      const files = keys.filter(key => !key.endsWith('/'));
      let deleted = 0;
      if (files.length) {
        deleted += (await api.delete<StorageDeleteResult>('/admin/storage/objects', { body: { keys: files } })).deleted;
      }
      for (const folder of folders) {
        deleted += (await api.delete<StorageDeleteResult>('/admin/storage/folder', { query: { prefix: folder } })).deleted;
      }
      return deleted;
    },
    onSuccess: (deleted, keys) => {
      dispatchSelection({ type: 'clear' });
      invalidate();
      if (keys.length === 1 && keys[0].endsWith('/')) {
        alert(t('admin_storage_folder_deleted', { count: deleted }));
      }
    },
    onError: () => {
      // Часть ключей могла удалиться до ошибки: обновление покажет фактическое состояние,
      // а `sync` выкинет исчезнувшие ключи из выбора.
      invalidate();
      alert(t('admin_storage_delete_error'));
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selected.length) uploadMutation.mutate(selected);
  };

  const handleDownload = (key: string) => {
    // Проксируем через свой API, а не presigned S3-URL: хранилище живёт только во внутренней
    // сети (docker-hostname недоступен браузеру), плюс так скачивание остаётся под auth-guard'ом сессии.
    window.open(storageDownloadUrl(api, key), '_blank');
  };

  const handleDownloadSelected = () => {
    // У папки нет содержимого для скачивания — качаем только файлы выбора.
    for (const key of selection.keys) {
      if (!key.endsWith('/')) handleDownload(key);
    }
  };

  // Кнопка тулбара и пункт меню открывают диалог выбора папки; drag&drop переносит сразу.
  const handleMove = () => {
    if (selection.keys.length) setMoveKeys(selection.keys);
  };

  const handleDropMove = (destination: string, keys: string[]) => {
    setDragKeys(null);
    // DnD — прямая операция без диалога: ошибку сервера (коллизия) показываем алертом,
    // как и остальные мутации, а не открываем диалог задним числом.
    moveMutation.mutate({ keys, destination }, { onError: () => alert(t('admin_storage_move_error')) });
  };

  const handleDialogMove = async (destination: string) => {
    await moveMutation.mutateAsync({ keys: moveKeys ?? [], destination });
    setMoveKeys(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const key = storageKeyFromDragId(event.active.id);
    if (key === null) return;
    cancelPendingOpen();
    // Тащим выбор, если строка в нём; иначе — только эту строку: унести «тихий» старый выбор
    // вместе с невыбранной строкой под курсором было бы сюрпризом.
    setDragKeys(selection.keys.includes(key) ? selection.keys : [key]);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const keys = dragKeys;
    setDragKeys(null);
    if (!keys) return;
    const destination = storagePrefixFromDropId(event.over?.id);
    // Невалидные цели (папка в себя/потомка, no-op) гасим до мутации: сервер ответил бы 400/409.
    if (destination === null || moveBlockReason(keys, destination) !== null) return;
    handleDropMove(destination, keys);
  };

  const handleDragCancel = () => setDragKeys(null);

  const handleRowContextMenu = (entry: StorageEntry, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    // Строки гасят всплытие: меню пустого места не должно открываться поверх меню строки.
    event.stopPropagation();
    cancelPendingOpen();
    if (!selection.keys.includes(entry.key)) {
      dispatchSelection({ type: 'click', key: entry.key, additive: false, range: false, visible: visibleKeys });
    }
    setMenu({ x: event.clientX, y: event.clientY, entry });
  };

  const handleEmptyContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    cancelPendingOpen();
    setMenu({ x: event.clientX, y: event.clientY, entry: null });
  };

  const openEntry = (entry: StorageEntry, downloadFallback = false) => {
    // Строка могла исчезнуть за паузу перед открытием (смена папки/поиск): открывать нечего.
    if (!entries.some(item => item.key === entry.key)) return;
    if (entry.kind === 'folder') {
      navigateTo(entry.key);
      return;
    }
    const object = objectsByKey.get(entry.key);
    if (!object) return;
    if (fileKindOf({ name: entry.key }) !== 'other') {
      setPreview(object);
      return;
    }
    if (downloadFallback) {
      handleDownload(entry.key);
      return;
    }
    // Файл без предпросмотра кликом не «открыть» — выделяем строку, чтобы у клика была реакция;
    // Enter и кнопка скачивания дают доступ к содержимому.
    dispatchSelection({ type: 'click', key: entry.key, additive: false, range: false, visible: visibleKeys });
  };

  // Таймер должен выстрелить по свежему состоянию: между кликом и открытием мог поменяться
  // поиск или список, поэтому открываем через ref, а не через замыкание момента клика.
  const openEntryRef = useRef(openEntry);
  useEffect(() => {
    openEntryRef.current = openEntry;
  });
  const scheduleOpen = (entry: StorageEntry) => {
    cancelPendingOpen();
    pendingOpen.current = window.setTimeout(() => {
      pendingOpen.current = null;
      openEntryRef.current(entry);
    }, OPEN_DELAY_MS);
  };

  const handlePreview = (entry: StorageEntry) => {
    const object = objectsByKey.get(entry.key);
    if (object) setPreview(object);
  };

  const requestDelete = (keys: string[]) => {
    cancelPendingOpen();
    if (!keys.length || deleteKeysMutation.isPending) return;
    if (keys.length === 1) {
      const key = keys[0];
      const message = key.endsWith('/')
        ? t('admin_storage_delete_folder_confirm', { name: folderName(key, prefix) })
        : t('admin_storage_delete_file_confirm', { name: objectName(key) });
      if (confirm(message)) deleteKeysMutation.mutate(keys);
      return;
    }
    if (confirm(t('admin_storage_delete_selected_confirm', { count: keys.length }))) deleteKeysMutation.mutate(keys);
  };

  const handleRenameStart = (key: string) => {
    // Правка начинается поверх строки: отложенное открытие должно быть погашено до неё.
    cancelPendingOpen();
    setEditing({ mode: 'rename', key });
  };

  const handleCreateFolder = () => {
    cancelPendingOpen();
    setEditing({ mode: 'create' });
  };

  const handleCommitEdit = (name: string) => {
    // Повторный Enter, пока запрос в полёте, не должен запускать вторую папку/переименование.
    if (!editing || createFolderMutation.isPending || renameMutation.isPending) return;
    const trimmed = name.trim();
    if (editing.mode === 'create') {
      if (trimmed) createFolderMutation.mutate(trimmed);
      else setEditing(null);
      return;
    }
    const entry = entries.find(item => item.key === editing.key);
    // Пустое или прежнее имя — не операция, а отмена: бэкенд такое всё равно отклонит.
    if (!entry || !trimmed || trimmed === entry.name) {
      setEditing(null);
      return;
    }
    renameMutation.mutate({ key: editing.key, name: trimmed });
  };

  const handleRowClick = (entry: StorageEntry, event: ReactMouseEvent<HTMLElement>) => {
    cancelPendingOpen();
    dispatchSelection({
      type: 'click',
      key: entry.key,
      additive: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
      visible: visibleKeys,
    });
  };

  const handleCheck = (key: string, checked: boolean) => {
    cancelPendingOpen();
    dispatchSelection({ type: 'check', key, checked });
  };

  const handleCheckAll = (checked: boolean) => {
    cancelPendingOpen();
    dispatchSelection({ type: 'checkAll', keys: visibleKeys, checked });
  };

  const handleSort = (key: StorageSortKey) => {
    setSort(current =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' },
    );
  };

  // Хоткеи должны видеть свежие состояние и колбэки, но подписка на window на каждый рендер —
  // лишняя работа: держим снимок в ref, который обновляется после каждого рендера.
  const hotkeys = useRef({ menu, preview, editing, selection, entries, visibleKeys, openEntry, requestDelete, handleRenameStart });
  useEffect(() => {
    hotkeys.current = { menu, preview, editing, selection, entries, visibleKeys, openEntry, requestDelete, handleRenameStart };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = hotkeys.current;
      // Клавиатурное перетаскивание Start/End занимает Space/Enter: dnd-kit гасит событие
      // (`preventDefault`), и второй обработчик не должен открывать строку тем же нажатием.
      if (event.defaultPrevented) return;
      // Поля ввода не перехватываем: в инлайн-инпуте свои Enter/Esc, в поиске — правка текста.
      const target = event.target as HTMLElement | null;
      const isTextField =
        !!target &&
        (target.isContentEditable ||
          target.tagName === 'TEXTAREA' ||
          (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((target as HTMLInputElement).type)));
      if (isTextField) return;
      // Открытое контекстное меню забирает клавиатуру: Esc закрывает его и не снимает выбор,
      // который понадобится следующему открытому пункту.
      if (state.menu) {
        if (event.key === 'Escape') setMenu(null);
        return;
      }
      // Открытый превью-диалог забирает клавиатуру себе: Delete не должен удалять строки «под» ним.
      if (state.preview || (state.editing && event.key !== 'Escape')) return;
      // Любая горячая клавиша отменяет отложенное открытие: F2 начинает правку, Delete удаляет —
      // превью не должно всплыть ни поверх инпута, ни по уже удалённому ключу.
      cancelPendingOpen();

      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault();
          dispatchSelection({ type: 'checkAll', keys: state.visibleKeys, checked: true });
        }
        return;
      }

      switch (event.key) {
        case 'Escape':
          // Сначала отменяем правку, выбор — вторым шагом: Esc не должен терять оба состояния сразу.
          if (state.editing) setEditing(null);
          else dispatchSelection({ type: 'clear' });
          break;
        case 'Enter': {
          if (state.selection.keys.length !== 1) break;
          const entry = state.entries.find(item => item.key === state.selection.keys[0]);
          if (entry) state.openEntry(entry, true);
          break;
        }
        case 'Delete':
          state.requestDelete(state.selection.keys);
          break;
        case 'F2':
          if (state.selection.keys.length === 1) state.handleRenameStart(state.selection.keys[0]);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelPendingOpen]);

  // Полностраничная ошибка — только когда не загружено ни одной страницы: иначе падение догрузки
  // стирало бы уже показанный список (sentinel покажет «Повторить»).
  if (isError && !data) return <QueryError error={queryError} onRetry={refetch} />;

  const isEmpty = entries.length === 0 && editing?.mode !== 'create';
  const propertiesEntry = propertiesKey !== null ? (entries.find(entry => entry.key === propertiesKey) ?? null) : null;
  const propertiesObject = propertiesKey !== null ? objectsByKey.get(propertiesKey) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={storageCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full overflow-y-auto">
        <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-4">
          <div className="shrink-0 flex flex-col gap-3">
            <div>
              <h1 className="text-2xl font-bold">{t('admin_storage_title')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('admin_storage_summary', {
                  folders: entries.filter(entry => entry.kind === 'folder').length,
                  files: entries.filter(entry => entry.kind === 'file').length,
                })}
              </p>
            </div>
            <StorageToolbar
              search={search}
              onSearchChange={setSearch}
              uploading={uploadMutation.isPending}
              onUpload={() => fileInputRef.current?.click()}
              createFolderDisabled={editing?.mode === 'create'}
              onCreateFolder={handleCreateFolder}
              selectedCount={selection.keys.length}
              onRename={() => selection.keys.length === 1 && handleRenameStart(selection.keys[0])}
              onMove={handleMove}
              onDownload={handleDownloadSelected}
              onDelete={() => requestDelete(selection.keys)}
              refreshing={isFetching}
              onRefresh={() => refetch()}
              view={view}
              onViewChange={setView}
            />
          </div>

          <div className="flex items-start gap-4">
            <aside className="w-64 shrink-0 rounded-md border bg-card/50">
              <StorageTree prefix={prefix} onNavigate={navigateTo} version={treeVersion} dragKeys={dragKeys} />
            </aside>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {/* Адресная строка — вместо виджетных крошек: вверх + кликабельные сегменты пути. */}
              <div className="flex items-center gap-2">
                <AddressDropTarget
                  destination={parentPrefix(prefix)}
                  dragKeys={dragKeys}
                  className="size-8 shrink-0"
                  render={({ ref, className }) => (
                    <Button
                      ref={ref}
                      variant="outline"
                      size="icon"
                      className={className}
                      disabled={!prefix}
                      title={t('admin_storage_up')}
                      aria-label={t('admin_storage_up')}
                      onClick={() => navigateTo(parentPrefix(prefix))}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                  )}
                />
                <Breadcrumb>
                  <BreadcrumbList>
                    <AddressDropTarget
                      destination=""
                      dragKeys={dragKeys}
                      render={({ ref, className }) => (
                        <BreadcrumbItem ref={ref} className={className}>
                          {prefix ? (
                            <BreadcrumbLink render={<Link to="/admin/storage" onClick={() => setSearch('')} />}>
                              {t('admin_storage_title')}
                            </BreadcrumbLink>
                          ) : (
                            <BreadcrumbPage>{t('admin_storage_title')}</BreadcrumbPage>
                          )}
                        </BreadcrumbItem>
                      )}
                    />
                    {folderTrail(prefix).map((segment, index, trail) => {
                      const isLast = index === trail.length - 1;
                      return (
                        <Fragment key={segment.prefix}>
                          <BreadcrumbSeparator />
                          <AddressDropTarget
                            destination={segment.prefix}
                            dragKeys={dragKeys}
                            render={({ ref, className }) => (
                              <BreadcrumbItem ref={ref} className={className}>
                                {isLast ? (
                                  <BreadcrumbPage>{segment.name}</BreadcrumbPage>
                                ) : (
                                  <BreadcrumbLink
                                    render={
                                      <Link
                                        to={`/admin/storage?prefix=${encodeURIComponent(segment.prefix)}`}
                                        onClick={() => setSearch('')}
                                      />
                                    }
                                  >
                                    {segment.name}
                                  </BreadcrumbLink>
                                )}
                              </BreadcrumbItem>
                            )}
                          />
                        </Fragment>
                      );
                    })}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>

              {/* Пустое место принимает правый клик: меню «Новая папка/Загрузить/Обновить». */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: фон списка, а не интерактивный контрол */}
              <div className="flex min-h-40 flex-1 flex-col gap-2" onContextMenu={handleEmptyContextMenu}>
                {isLoading ? (
                  <div className="p-8 text-muted-foreground">{t('core:loading')}</div>
                ) : isEmpty ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>
                        {search
                          ? t('admin_storage_search_empty')
                          : prefix
                            ? t('admin_storage_empty_folder_title')
                            : t('admin_storage_empty_title')}
                      </EmptyTitle>
                      <EmptyDescription>
                        {prefix ? t('admin_storage_empty_folder_description') : t('admin_storage_empty_description')}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <>
                    {view === 'list' ? (
                      <StorageList
                        entries={entries}
                        sort={sort}
                        selection={selection}
                        editing={editing}
                        hasNextPage={hasNextPage}
                        isFetchingNextPage={isFetchingNextPage}
                        loadMoreError={isFetchNextPageError}
                        onLoadMore={loadMore}
                        onSort={handleSort}
                        onRowClick={handleRowClick}
                        onCheck={handleCheck}
                        onCheckAll={handleCheckAll}
                        onOpen={scheduleOpen}
                        onCommitEdit={handleCommitEdit}
                        onCancelEdit={() => setEditing(null)}
                        onRenameStart={handleRenameStart}
                        onDelete={entry => requestDelete([entry.key])}
                        onDownload={handleDownload}
                        onPreview={handlePreview}
                        dragKeys={dragKeys}
                        onRowContextMenu={handleRowContextMenu}
                      />
                    ) : (
                      <StorageTiles
                        entries={entries}
                        selection={selection}
                        editing={editing}
                        hasNextPage={hasNextPage}
                        isFetchingNextPage={isFetchingNextPage}
                        loadMoreError={isFetchNextPageError}
                        onLoadMore={loadMore}
                        onRowClick={handleRowClick}
                        onOpen={scheduleOpen}
                        onCheck={handleCheck}
                        onCommitEdit={handleCommitEdit}
                        onCancelEdit={() => setEditing(null)}
                        onRenameStart={handleRenameStart}
                        dragKeys={dragKeys}
                        onRowContextMenu={handleRowContextMenu}
                      />
                    )}
                    <StorageStatusBar selected={selection.keys.length} total={entries.length} selectedBytes={selectedBytes} />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />

        <FilePreviewDialog
          open={preview !== null}
          onOpenChange={open => !open && setPreview(null)}
          source={previewSource}
          description={preview ? `${formatBytes(preview.size)} · ${formatDate(preview.lastModified)}` : undefined}
          mode={editEnabled ? 'edit' : 'view'}
          onSave={
            editEnabled
              ? async content => {
                  // `mutateAsync` отдаёт обновлённый объект — `onSave` ждёт `void`, поэтому гасим результат.
                  await saveObjectMutation.mutateAsync({ key: preview?.key ?? '', content });
                }
              : undefined
          }
          labels={viewerLabels}
          actions={
            preview ? (
              <Button variant="outline" size="sm" onClick={() => handleDownload(preview.key)}>
                {t('admin_storage_download')}
              </Button>
            ) : null
          }
        />

        <StorageContextMenu
          state={menu}
          selectedKeys={selection.keys}
          onClose={() => setMenu(null)}
          onOpen={entry => openEntry(entry, true)}
          onDownload={handleDownloadSelected}
          onRename={handleRenameStart}
          onMove={handleMove}
          onDelete={() => requestDelete(selection.keys)}
          onProperties={entry => setPropertiesKey(entry.key)}
          onCreateFolder={handleCreateFolder}
          onUpload={() => fileInputRef.current?.click()}
          onRefresh={() => refetch()}
        />

        <StorageMoveDialog
          open={moveKeys !== null}
          keys={moveKeys ?? []}
          onOpenChange={open => !open && setMoveKeys(null)}
          onMove={handleDialogMove}
        />

        <StoragePropertiesDialog
          open={propertiesEntry !== null}
          entry={propertiesEntry}
          object={propertiesObject}
          onOpenChange={open => !open && setPropertiesKey(null)}
        />
      </div>
      {/* Оверлей показывает, что именно тащат: исходная строка/карточка — полупрозрачная. */}
      <DragOverlay dropAnimation={null}>{dragKeys ? <StorageDragPreview count={dragKeys.length} /> : null}</DragOverlay>
    </DndContext>
  );
}
