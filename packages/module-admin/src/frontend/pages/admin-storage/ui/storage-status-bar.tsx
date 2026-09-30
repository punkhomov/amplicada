import { formatBytes } from '@amplicada/file-viewer/frontend';
import { useTranslation } from '@amplicada/platform-core/frontend';

export interface StorageStatusBarProps {
  /** Сколько строк выбрано сейчас (видимых: скрытые ключи отсеивает `sync`). */
  selected: number;
  /** Сколько элементов в текущем списке. */
  total: number;
  /** Суммарный размер выбранных файлов; папки размера не имеют и его не добавляют. */
  selectedBytes: number;
}

/** Строка состояния под списком: выбрано / всего / суммарный размер выбранного. */
export function StorageStatusBar({ selected, total, selectedBytes }: StorageStatusBarProps) {
  const { t } = useTranslation('admin');

  return (
    <div className="flex items-center gap-4 border-t px-2 py-2 text-sm text-muted-foreground">
      <span>{t('admin_storage_selected_count', { count: selected })}</span>
      <span>{t('admin_storage_items_count', { count: total })}</span>
      <span>{formatBytes(selectedBytes)}</span>
    </div>
  );
}
