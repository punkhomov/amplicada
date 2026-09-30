import { formatBytes } from '@amplicada/file-viewer/frontend';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@amplicada/platform-core/frontend/ui/dialog';
import type { StorageObject } from '../../../../contracts/storage.js';
import type { StorageEntry } from '../lib/entries.js';
import { formatDate } from '../lib/format.js';

export interface StoragePropertiesDialogProps {
  open: boolean;
  entry: StorageEntry | null;
  /** Объект листинга: у папки его нет — ей достаточно ключа и типа. */
  object?: StorageObject;
  onOpenChange: (open: boolean) => void;
}

/** Свойства выбранного элемента: данные уже пришли с листингом, дополнительных запросов нет. */
export function StoragePropertiesDialog({ open, entry, object, onOpenChange }: StoragePropertiesDialogProps) {
  const { t } = useTranslation('admin');

  const rows = entry
    ? entry.kind === 'folder'
      ? [
          { label: t('admin_storage_key'), value: entry.key },
          { label: t('admin_storage_col_type'), value: t('admin_storage_folder') },
        ]
      : [
          { label: t('admin_storage_key'), value: entry.key },
          { label: t('admin_storage_size'), value: formatBytes(object?.size ?? entry.size ?? 0) },
          { label: t('admin_storage_col_type'), value: object?.contentType ?? '—' },
          { label: t('admin_storage_etag'), value: object?.etag ?? '—' },
          { label: t('admin_storage_modified'), value: formatDate(object?.lastModified ?? entry.lastModified) },
        ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin_storage_properties_title')}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {rows.map(row => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="break-all font-mono text-xs">{row.value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
