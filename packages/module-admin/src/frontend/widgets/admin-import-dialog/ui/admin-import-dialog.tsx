import type { FieldMetadata } from '@amplicada/platform-core/contracts';
import { useApiClient, useMutation, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@amplicada/platform-core/frontend/ui/alert-dialog';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  ExtTable,
  ExtTableBody,
  ExtTableCell,
  ExtTableHead,
  ExtTableHeader,
  ExtTableRow,
} from '@amplicada/platform-core/frontend/ui/ext-table';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';

interface ImportResult {
  created: number;
  updated: number;
  errors: { index: number; error: string }[];
}

interface ImportPreview {
  items: Record<string, Record<string, unknown>>[];
  columns: Record<string, Record<string, FieldMetadata>>;
  typeName: string;
}

interface AdminImportDialogProps {
  type: string;
  disabled?: boolean;
}

export function AdminImportDialog({ type, disabled = false }: AdminImportDialogProps) {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: (items: Record<string, Record<string, unknown>>[]) => api.post<ImportResult>(`/admin/documents/${type}/import`, { items }),
    onSuccess: result => {
      setImportPreview(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'documents', type] });
      alert(
        t('admin_import_success', { created: result.created, updated: result.updated }) +
          (result.errors.length ? t('admin_import_errors_suffix', { count: result.errors.length }) : ''),
      );
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!parsed.items || !Array.isArray(parsed.items)) {
          alert(t('admin_import_invalid_format'));
          return;
        }
        setImportPreview({
          items: parsed.items,
          columns: parsed.columns ?? {},
          typeName: parsed.type?.label ?? type ?? '',
        });
      } catch {
        alert(t('admin_import_parse_error'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportConfirm = () => {
    if (!importPreview) return;
    importMutation.mutate(importPreview.items);
  };

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
      <Button
        variant="outline"
        size="icon"
        title={disabled ? t('admin_toolbar_import_disabled') : t('admin_toolbar_import')}
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="size-4" />
      </Button>

      <AlertDialog
        open={!!importPreview}
        onOpenChange={open => {
          if (!open) setImportPreview(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin_import_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {importPreview && t('admin_import_description', { count: importPreview.items.length, type: importPreview.typeName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {importPreview && (
            <div className="max-h-60 overflow-auto text-sm">
              <ExtTable>
                <ExtTableHeader>
                  <ExtTableRow>
                    {Object.entries(importPreview.columns).map(([mod, fields]) =>
                      Object.keys(fields).map(key => <ExtTableHead key={`${mod}:${key}`}>{fields[key].label}</ExtTableHead>),
                    )}
                  </ExtTableRow>
                </ExtTableHeader>
                <ExtTableBody>
                  {importPreview.items.slice(0, 10).map((item, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview items have no stable id
                    <ExtTableRow key={i}>
                      {Object.entries(importPreview.columns).map(([mod, fields]) =>
                        Object.keys(fields).map(key => (
                          <ExtTableCell key={`${mod}:${key}`}>{String((item[mod] as Record<string, unknown>)?.[key] ?? '')}</ExtTableCell>
                        )),
                      )}
                    </ExtTableRow>
                  ))}
                </ExtTableBody>
              </ExtTable>
              {importPreview.items.length > 10 && (
                <p className="text-muted-foreground text-center py-2">
                  {t('admin_import_more', { count: importPreview.items.length - 10 })}
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default">
              {t('core:common_cancel')}
            </AlertDialogCancel>
            <AlertDialogAction variant="default" size="sm" onClick={handleImportConfirm} disabled={importMutation.isPending}>
              {importMutation.isPending ? t('admin_import_pending') : t('admin_import_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
