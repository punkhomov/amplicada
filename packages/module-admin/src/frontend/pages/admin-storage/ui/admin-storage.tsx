import { FilePreviewDialog, type FileViewerLabels, fileKindOf, formatBytes } from '@amplicada/file-viewer/frontend';
import {
  type ApiClient,
  ApiError,
  QueryError,
  useApiClient,
  useMutation,
  useQuery,
  useQueryClient,
  useTranslation,
} from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@amplicada/platform-core/frontend/ui/empty';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { FolderPlus, LoaderCircle, Search, Upload } from 'lucide-react';
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  StorageConfig,
  StorageDeleteResult,
  StorageListing,
  StorageMoveResult,
  StorageObject,
} from '../../../../contracts/storage.js';
import { AdminBreadcrumbs, type BreadcrumbEntry } from '../../../widgets/admin-breadcrumbs/index.js';
import { type StorageEntry, toEntries } from '../lib/entries.js';
import { formatDate } from '../lib/format.js';
import { folderName, objectName, parentPrefix, storageDownloadUrl, storageViewUrl } from '../lib/paths.js';
import { selectionReducer } from '../lib/selection.js';
import { type StorageSort, type StorageSortKey, sortEntries } from '../lib/sort.js';
import { type StorageEditing, StorageList } from './storage-list.js';
import { StorageStatusBar } from './storage-status-bar.js';

const STORAGE_OBJECTS_QUERY_KEY = ['admin', 'storage', 'objects'] as const;
const STORAGE_CONFIG_QUERY_KEY = ['admin', 'storage', 'config'] as const;

export function adminStorageObjectsQueryOptions(api: ApiClient, prefix: string) {
  return {
    queryKey: [...STORAGE_OBJECTS_QUERY_KEY, prefix] as const,
    queryFn: () => api.get<StorageListing>('/admin/storage/objects', { query: { prefix } }),
  };
}

export function adminStorageConfigQueryOptions(api: ApiClient) {
  return {
    queryKey: STORAGE_CONFIG_QUERY_KEY,
    queryFn: () => api.get<StorageConfig>('/admin/storage/config'),
  };
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

  const prefix = searchParams.get('prefix') ?? '';
  const { data, isLoading, isError, error: queryError, refetch } = useQuery(adminStorageObjectsQueryOptions(api, prefix));
  // Правка — опциональная возможность деплоя: пока конфиг не приехал, превью только для чтения.
  const { data: config } = useQuery(adminStorageConfigQueryOptions(api));
  const editEnabled = config?.editEnabled ?? false;

  const entries = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = data ? toEntries(data) : [];
    const filtered = term ? all.filter(entry => entry.name.toLowerCase().includes(term)) : all;
    return sortEntries(filtered, sort);
  }, [data, search, sort]);
  const visibleKeys = useMemo(() => entries.map(entry => entry.key), [entries]);
  const selectedKeys = useMemo(() => new Set(selection.keys), [selection.keys]);
  const objectsByKey = useMemo(() => new Map((data?.objects ?? []).map(object => [object.key, object])), [data]);

  // Выбор переживает смену списка, поэтому его надо подрезать до видимых ключей: иначе поиск
  // или уход в другую папку оставят «тихо выбранные» строки, и bulk-операция заденет лишнее.
  useEffect(() => {
    dispatchSelection({ type: 'sync', visible: visibleKeys });
  }, [visibleKeys]);

  const selectedBytes = useMemo(() => {
    let total = 0;
    for (const entry of entries) {
      if (entry.kind === 'file' && selectedKeys.has(entry.key)) total += entry.size ?? 0;
    }
    return total;
  }, [entries, selectedKeys]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: STORAGE_OBJECTS_QUERY_KEY });

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

  const handlePreview = (entry: StorageEntry) => {
    const object = objectsByKey.get(entry.key);
    if (object) setPreview(object);
  };

  const requestDelete = (keys: string[]) => {
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

  const handleRenameStart = (key: string) => setEditing({ mode: 'rename', key });

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

  const handleRowClick = (entry: StorageEntry, event: ReactMouseEvent<HTMLTableRowElement>) => {
    dispatchSelection({
      type: 'click',
      key: entry.key,
      additive: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
      visible: visibleKeys,
    });
  };

  const handleSort = (key: StorageSortKey) => {
    setSort(current =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' },
    );
  };

  // Хоткеи должны видеть свежие состояние и колбэки, но подписка на window на каждый рендер —
  // лишняя работа: держим снимок в ref, который обновляется после каждого рендера.
  const hotkeys = useRef({ preview, editing, selection, entries, visibleKeys, openEntry, requestDelete, handleRenameStart });
  useEffect(() => {
    hotkeys.current = { preview, editing, selection, entries, visibleKeys, openEntry, requestDelete, handleRenameStart };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = hotkeys.current;
      // Поля ввода не перехватываем: в инлайн-инпуте свои Enter/Esc, в поиске — правка текста.
      const target = event.target as HTMLElement | null;
      const isTextField =
        !!target &&
        (target.isContentEditable ||
          target.tagName === 'TEXTAREA' ||
          (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((target as HTMLInputElement).type)));
      if (isTextField) return;
      // Открытый превью-диалог забирает клавиатуру себе: Delete не должен удалять строки «под» ним.
      if (state.preview || (state.editing && event.key !== 'Escape')) return;

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
  }, []);

  const breadcrumbItems: BreadcrumbEntry[] = [
    { label: t('admin_breadcrumb_root'), to: '/admin' },
    { label: t('admin_storage_title'), to: '/admin/storage' },
    ...folderTrail(prefix).map((segment, index, trail) => ({
      label: segment.name,
      to: index === trail.length - 1 ? undefined : `/admin/storage?prefix=${encodeURIComponent(segment.prefix)}`,
    })),
  ];

  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading) return <div className="p-8 text-muted-foreground">{t('core:loading')}</div>;

  const isEmpty = entries.length === 0 && editing?.mode !== 'create';

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-4">
        <div className="shrink-0 flex flex-col gap-4">
          <AdminBreadcrumbs items={breadcrumbItems} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t('admin_storage_title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('admin_storage_summary', {
                folders: entries.filter(entry => entry.kind === 'folder').length,
                files: entries.filter(entry => entry.kind === 'file').length,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t('admin_storage_search_placeholder')}
                className="w-64 pl-8"
              />
            </div>
            <Button variant="outline" onClick={() => setEditing({ mode: 'create' })} disabled={editing?.mode === 'create'}>
              <FolderPlus className="size-4" />
              {t('admin_storage_new_folder')}
            </Button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploadMutation.isPending ? t('admin_storage_uploading') : t('admin_storage_upload')}
            </Button>
          </div>
        </div>

        {isEmpty ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {search ? t('admin_storage_search_empty') : prefix ? t('admin_storage_empty_folder_title') : t('admin_storage_empty_title')}
              </EmptyTitle>
              <EmptyDescription>
                {prefix ? t('admin_storage_empty_folder_description') : t('admin_storage_empty_description')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            <StorageList
              entries={entries}
              sort={sort}
              selection={selection}
              editing={editing}
              onSort={handleSort}
              onRowClick={handleRowClick}
              onCheck={(key, checked) => dispatchSelection({ type: 'check', key, checked })}
              onCheckAll={checked => dispatchSelection({ type: 'checkAll', keys: visibleKeys, checked })}
              onOpen={openEntry}
              onCommitEdit={handleCommitEdit}
              onCancelEdit={() => setEditing(null)}
              onRenameStart={handleRenameStart}
              onDelete={entry => requestDelete([entry.key])}
              onDownload={handleDownload}
              onPreview={handlePreview}
            />
            <StorageStatusBar selected={selection.keys.length} total={entries.length} selectedBytes={selectedBytes} />
          </div>
        )}
      </div>

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
    </div>
  );
}

/** Сегменты текущего префикса с накопленным путём: `learning/pkg/` → `learning/`, `learning/pkg/`. */
function folderTrail(prefix: string): { name: string; prefix: string }[] {
  const parts = prefix.split('/').filter(Boolean);
  return parts.map((part, index) => ({
    name: part,
    prefix: `${parts.slice(0, index + 1).join('/')}/`,
  }));
}
