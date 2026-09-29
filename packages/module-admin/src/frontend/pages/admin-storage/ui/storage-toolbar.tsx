import { useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Download, FolderInput, FolderPlus, LayoutGrid, List, LoaderCircle, Pencil, RefreshCw, Search, Trash2, Upload } from 'lucide-react';

/** Режим отображения содержимого папки; живёт в состоянии страницы, а не в URL. */
export type StorageView = 'list' | 'tiles';

export interface StorageToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  uploading: boolean;
  onUpload: () => void;
  createFolderDisabled: boolean;
  onCreateFolder: () => void;
  /** Сколько ключей выбрано: от этого зависят доступность bulk-команд и переименования. */
  selectedCount: number;
  onRename: () => void;
  onMove: () => void;
  onDownload: () => void;
  onDelete: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  view: StorageView;
  onViewChange: (view: StorageView) => void;
}

export function StorageToolbar(props: StorageToolbarProps) {
  const { t } = useTranslation('admin');
  const hasSelection = props.selectedCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={props.onCreateFolder} disabled={props.createFolderDisabled}>
        <FolderPlus className="size-4" />
        {t('admin_storage_new_folder')}
      </Button>
      <Button onClick={props.onUpload} disabled={props.uploading}>
        {props.uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {props.uploading ? t('admin_storage_uploading') : t('admin_storage_upload')}
      </Button>

      <div className="mx-1 h-6 w-px bg-border" />

      {/* Переименование — операция ровно над одним ключом, остальные команды — над выбором. */}
      <Button variant="outline" onClick={props.onRename} disabled={props.selectedCount !== 1}>
        <Pencil className="size-4" />
        {t('admin_storage_rename')}
      </Button>
      <Button variant="outline" onClick={props.onMove} disabled={!hasSelection}>
        <FolderInput className="size-4" />
        {t('admin_storage_move')}
      </Button>
      <Button variant="outline" onClick={props.onDownload} disabled={!hasSelection}>
        <Download className="size-4" />
        {t('admin_storage_download')}
      </Button>
      <Button variant="outline" onClick={props.onDelete} disabled={!hasSelection}>
        <Trash2 className="size-4" />
        {t('admin_storage_delete')}
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={props.search}
            onChange={event => props.onSearchChange(event.target.value)}
            placeholder={t('admin_storage_search_placeholder')}
            className="w-64 pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          title={t('admin_storage_refresh')}
          aria-label={t('admin_storage_refresh')}
          onClick={props.onRefresh}
        >
          <RefreshCw className={`size-4 ${props.refreshing ? 'animate-spin' : ''}`} />
        </Button>
        {/* Две отдельные кнопки, а не select: режим переключается одним кликом и виден по нажатому состоянию. */}
        <div className="flex items-center rounded-md border p-0.5">
          <Button
            variant={props.view === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={props.view === 'list'}
            onClick={() => props.onViewChange('list')}
          >
            <List className="size-4" />
            {t('admin_storage_view_list')}
          </Button>
          <Button
            variant={props.view === 'tiles' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={props.view === 'tiles'}
            onClick={() => props.onViewChange('tiles')}
          >
            <LayoutGrid className="size-4" />
            {t('admin_storage_view_tiles')}
          </Button>
        </div>
      </div>
    </div>
  );
}
