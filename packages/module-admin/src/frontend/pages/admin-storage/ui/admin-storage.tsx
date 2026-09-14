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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@amplicada/platform-core/frontend/ui/table';
import { Download, Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';

interface StorageObject {
  key: string;
  size: number;
  etag?: string;
  lastModified?: string;
}

const STORAGE_OBJECTS_QUERY_KEY = ['admin', 'storage', 'objects'] as const;

export function adminStorageObjectsQueryOptions(api: ApiClient) {
  return {
    queryKey: STORAGE_OBJECTS_QUERY_KEY,
    queryFn: () => api.get<StorageObject[]>('/admin/storage/objects'),
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function AdminStorage() {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: objects = [], isLoading, isError, error: queryError, refetch } = useQuery(adminStorageObjectsQueryOptions(api));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: STORAGE_OBJECTS_QUERY_KEY });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post('/admin/storage/objects', formData);
    },
    onSuccess: invalidate,
    onError: () => alert(t('admin_storage_upload_error')),
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => api.delete(`/admin/storage/objects/${encodeURIComponent(key)}`),
    onSuccess: invalidate,
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) uploadMutation.mutate(file);
  };

  const handleDownload = (key: string) => {
    // Проксируем через свой API, а не presigned S3-URL: хранилище живёт только во внутренней
    // сети (docker-hostname недоступен браузеру), плюс так скачивание остаётся под auth-guard'ом сессии.
    window.open(`${api.baseUrl}/admin/storage/objects/${encodeURIComponent(key)}/download`, '_blank');
  };

  const handleDelete = (key: string) => {
    if (!confirm(t('admin_list_confirm_delete_one'))) return;
    deleteMutation.mutate(key);
  };

  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading) return <div className="p-8 text-muted-foreground">{t('core:loading')}</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-screen-2xl mx-auto flex flex-col px-8 py-4 gap-4">
        <div className="shrink-0 flex flex-col gap-4">
          <AdminBreadcrumbs items={[{ label: t('admin_breadcrumb_root'), to: '/admin' }, { label: t('admin_storage_title') }]} />
        </div>

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('admin_storage_title')}</h1>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
            <Upload className="size-4" />
            {t('admin_storage_upload')}
          </Button>
        </div>

        {objects.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('admin_storage_empty_title')}</EmptyTitle>
              <EmptyDescription>{t('admin_storage_empty_description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin_storage_col_key')}</TableHead>
                <TableHead>{t('admin_storage_col_size')}</TableHead>
                <TableHead>{t('admin_storage_col_modified')}</TableHead>
                <TableHead>{t('admin_storage_col_actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {objects.map(obj => (
                <TableRow key={obj.key}>
                  <TableCell className="font-mono text-xs">{obj.key}</TableCell>
                  <TableCell>{formatBytes(obj.size)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(obj.lastModified)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="outline" size="icon" title={t('admin_storage_download')} onClick={() => handleDownload(obj.key)}>
                        <Download className="size-4" />
                      </Button>
                      <Button variant="outline" size="icon" title={t('admin_storage_delete')} onClick={() => handleDelete(obj.key)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
