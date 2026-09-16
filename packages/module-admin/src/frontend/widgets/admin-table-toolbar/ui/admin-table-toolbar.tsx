import { useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@amplicada/platform-core/frontend/ui/dropdown-menu';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Columns3, Database, Download, Eye, Filter, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { getTableActions } from '../../../lib/admin-table-action-registry.js';
import { AdminImportDialog } from '../../admin-import-dialog/index.js';

export interface AdminTableToolbarProps {
  type: string;
  creatable?: boolean;
  deletable?: boolean;
  hasSelection: boolean;
  selectedCount: number;
  selectedIds: string[];
  paginationMode: 'infinite' | 'pages';
  searchQuery: string;
  activeFilterCount?: number;
  refreshData: () => void;
  onCreate: () => void;
  onDeleteSelected: () => void;
  onExport: () => void;
  onExportView: (format: 'csv' | 'json') => void;
  onOpenColumns: () => void;
  onOpenFilters: () => void;
  onOpenViews: () => void;
  onTogglePaginationMode: () => void;
  onSearchChange: (query: string) => void;
}

export function AdminTableToolbar({
  type,
  creatable = true,
  deletable = true,
  hasSelection,
  selectedCount,
  selectedIds,
  paginationMode,
  searchQuery,
  activeFilterCount = 0,
  refreshData,
  onCreate,
  onDeleteSelected,
  onExport,
  onExportView,
  onOpenColumns,
  onOpenFilters,
  onOpenViews,
  onTogglePaginationMode,
  onSearchChange,
}: AdminTableToolbarProps) {
  const { t } = useTranslation('admin');
  const tableActions = getTableActions(type);
  const bulkManageable = creatable && deletable;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="icon"
        title={creatable ? t('admin_toolbar_create') : t('admin_toolbar_create_disabled')}
        disabled={!creatable}
        onClick={onCreate}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        variant="destructive"
        size="icon"
        title={
          !deletable
            ? t('admin_toolbar_delete_disabled')
            : `${t('admin_toolbar_delete_selected')}${hasSelection ? ` (${selectedCount})` : ''}`
        }
        disabled={!hasSelection || !deletable}
        onClick={onDeleteSelected}
      >
        <span className="relative">
          <Trash2 className="size-4" />
          {hasSelection && deletable && (
            <span className="absolute -top-1.5 -right-1.5 bg-destructive-foreground text-destructive text-[10px] size-4 rounded-full flex items-center justify-center font-medium">
              {selectedCount}
            </span>
          )}
        </span>
      </Button>
      <AdminImportDialog type={type} disabled={!bulkManageable} />
      <Button
        variant="outline"
        size="icon"
        title={bulkManageable ? t('admin_toolbar_export') : t('admin_toolbar_export_disabled')}
        disabled={!bulkManageable}
        onClick={onExport}
      >
        <Download className="size-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              title={bulkManageable ? t('admin_toolbar_dump') : t('admin_toolbar_dump_disabled')}
              disabled={!bulkManageable}
            >
              <Database className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onExportView('json')}>JSON</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExportView('csv')}>CSV</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {tableActions.map(action => {
        const ActionComponent = action.component;
        return <ActionComponent key={action.id} documentType={type} selectedIds={selectedIds} refreshData={refreshData} />;
      })}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="icon" title={t('admin_toolbar_views')} onClick={onOpenViews}>
          <Eye className="size-4" />
        </Button>
        <Button variant="outline" size="icon" title={t('admin_toolbar_filters')} onClick={onOpenFilters}>
          <span className="relative">
            <Filter className="size-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] size-4 rounded-full flex items-center justify-center font-medium">
                {activeFilterCount}
              </span>
            )}
          </span>
        </Button>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            aria-label={t('admin_toolbar_search_placeholder')}
            placeholder={t('admin_toolbar_search_placeholder')}
            maxLength={200}
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="pl-8 h-8 w-56"
          />
        </div>
        <Button variant="outline" size="icon" title={t('admin_toolbar_columns')} onClick={onOpenColumns}>
          <Columns3 className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="icon" title={t('admin_toolbar_settings')}>
                <Settings2 className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onTogglePaginationMode}>
              {t('admin_toolbar_mode', {
                mode: paginationMode === 'infinite' ? t('admin_toolbar_mode_infinite') : t('admin_toolbar_mode_pages'),
              })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
