import { type FileKind, FilePreviewDialog, type FileViewerLabels, fileKindOf, formatBytes } from '@amplicada/file-viewer/frontend';
import {
  type ApiClient,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import {
  Download,
  Eye,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileType,
  FileVideo,
  Folder,
  LoaderCircle,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { StorageConfig, StorageDeleteResult, StorageListing, StorageObject } from '../../../../contracts/storage.js';
import { AdminBreadcrumbs, type BreadcrumbEntry } from '../../../widgets/admin-breadcrumbs/index.js';
import { formatDate } from '../lib/format.js';
import { folderName, objectName, storageDownloadUrl, storageViewUrl } from '../lib/paths.js';

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

  const prefix = searchParams.get('prefix') ?? '';
  const { data, isLoading, isError, error: queryError, refetch } = useQuery(adminStorageObjectsQueryOptions(api, prefix));
  // Правка — опциональная возможность деплоя: пока конфиг не приехал, превью только для чтения.
  const { data: config } = useQuery(adminStorageConfigQueryOptions(api));
  const editEnabled = config?.editEnabled ?? false;

  const folders = useMemo(() => [...(data?.prefixes ?? [])].sort((a, b) => a.localeCompare(b)), [data]);
  const files = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.objects ?? [])
      .filter(object => !term || objectName(object.key).toLowerCase().includes(term))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [data, search]);

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

  const deleteObjectMutation = useMutation({
    mutationFn: (key: string) => api.delete('/admin/storage/objects', { query: { key } }),
    onSuccess: invalidate,
    onError: () => alert(t('admin_storage_delete_error')),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (folder: string) => api.delete<StorageDeleteResult>('/admin/storage/folder', { query: { prefix: folder } }),
    onSuccess: result => {
      invalidate();
      alert(t('admin_storage_folder_deleted', { count: result.deleted }));
    },
    onError: () => alert(t('admin_storage_delete_folder_error')),
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

  const handleDeleteObject = (key: string) => {
    if (!confirm(t('admin_storage_delete_file_confirm', { name: objectName(key) }))) return;
    deleteObjectMutation.mutate(key);
  };

  const handleDeleteFolder = (folder: string) => {
    if (!confirm(t('admin_storage_delete_folder_confirm', { name: folderName(folder, prefix) }))) return;
    deleteFolderMutation.mutate(folder);
  };

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

  const isEmpty = folders.length === 0 && files.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-4">
        <div className="shrink-0 flex flex-col gap-4">
          <AdminBreadcrumbs items={breadcrumbItems} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t('admin_storage_title')}</h1>
            <p className="text-sm text-muted-foreground">{t('admin_storage_summary', { folders: folders.length, files: files.length })}</p>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin_storage_col_name')}</TableHead>
                <TableHead className="w-32">{t('admin_storage_col_size')}</TableHead>
                <TableHead className="w-52">{t('admin_storage_col_modified')}</TableHead>
                <TableHead className="w-36">{t('admin_storage_col_actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {folders.map(folder => (
                <TableRow key={folder} className="cursor-pointer" onClick={() => navigateTo(folder)}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <Folder className="size-4 text-muted-foreground" />
                      {folderName(folder, prefix)}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell onClick={event => event.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="icon"
                      title={t('admin_storage_delete')}
                      disabled={deleteFolderMutation.isPending}
                      onClick={() => handleDeleteFolder(folder)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {files.map(object => {
                const kind = fileKindOf({ name: object.key });
                const previewable = kind !== 'other';
                return (
                  <TableRow
                    key={object.key}
                    className={previewable ? 'cursor-pointer' : undefined}
                    onClick={() => previewable && setPreview(object)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileKindIcon kind={kind} />
                        <span className="font-mono text-xs">{objectName(object.key)}</span>
                      </div>
                    </TableCell>
                    <TableCell>{formatBytes(object.size)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(object.lastModified)}</TableCell>
                    <TableCell onClick={event => event.stopPropagation()}>
                      <div className="flex gap-1">
                        {previewable && (
                          <Button variant="outline" size="icon" title={t('admin_storage_preview')} onClick={() => setPreview(object)}>
                            <Eye className="size-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          title={t('admin_storage_download')}
                          onClick={() => handleDownload(object.key)}
                        >
                          <Download className="size-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          title={t('admin_storage_delete')}
                          onClick={() => handleDeleteObject(object.key)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
              <Download className="size-4" />
              {t('admin_storage_download')}
            </Button>
          ) : null
        }
      />
    </div>
  );
}

function FileKindIcon({ kind }: { kind: FileKind }) {
  const className = 'size-4 text-muted-foreground';
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

/** Сегменты текущего префикса с накопленным путём: `learning/pkg/` → `learning/`, `learning/pkg/`. */
function folderTrail(prefix: string): { name: string; prefix: string }[] {
  const parts = prefix.split('/').filter(Boolean);
  return parts.map((part, index) => ({
    name: part,
    prefix: `${parts.slice(0, index + 1).join('/')}/`,
  }));
}
