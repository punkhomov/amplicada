import { useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { ButtonGroup } from '@amplicada/platform-core/frontend/ui/button-group';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@amplicada/platform-core/frontend/ui/pagination';
import { RefreshCw } from 'lucide-react';
import type { RefObject } from 'react';

export interface AdminTablePaginationProps {
  paginationMode: 'infinite' | 'pages';
  total: number;
  selectedCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onPageChange: (page: number) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  canPreviousPage: boolean;
  canNextPage: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isFetchingNextPage: boolean;
  loadedCount: number;
  onRefresh: () => void;
}

export function AdminTablePagination({
  paginationMode,
  total,
  selectedCount,
  currentPage,
  totalPages,
  pageSize,
  onPageSizeChange,
  onPageChange,
  onPreviousPage,
  onNextPage,
  canPreviousPage,
  canNextPage,
  loadMoreRef,
  isFetchingNextPage,
  loadedCount,
  onRefresh,
}: AdminTablePaginationProps) {
  const { t } = useTranslation('admin');
  const refreshButton = (
    <Button variant="outline" size="icon" title={t('admin_table_refresh')} onClick={onRefresh}>
      <RefreshCw className="size-4" />
    </Button>
  );

  if (paginationMode === 'pages') {
    const pageNumbers = (() => {
      interface PageEntry {
        id: string;
        value: number | 'ellipsis';
      }
      if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => ({ id: String(i), value: i }));
      const pages: PageEntry[] = [{ id: '0', value: 0 }];
      const windowStart = Math.max(1, currentPage - 1);
      const windowEnd = Math.min(totalPages - 2, currentPage + 1);
      if (windowStart > 1) pages.push({ id: 'ellipsis-start', value: 'ellipsis' });
      for (let i = windowStart; i <= windowEnd; i++) pages.push({ id: String(i), value: i });
      if (windowEnd < totalPages - 2) pages.push({ id: 'ellipsis-end', value: 'ellipsis' });
      if (totalPages > 1) pages.push({ id: String(totalPages - 1), value: totalPages - 1 });
      return pages;
    })();

    return (
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{t('admin_table_summary', { total, selected: selectedCount })}</div>
        <div className="flex items-center gap-2">
          <ButtonGroup>
            {[25, 50, 75, 100].map(size => (
              <Button key={size} variant={pageSize === size ? 'default' : 'outline'} size="default" onClick={() => onPageSizeChange(size)}>
                {size}
              </Button>
            ))}
          </ButtonGroup>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  size="default"
                  text={t('admin_table_prev')}
                  className={!canPreviousPage ? 'pointer-events-none opacity-50' : undefined}
                  onClick={e => {
                    e.preventDefault();
                    onPreviousPage();
                  }}
                />
              </PaginationItem>
              {pageNumbers.map(({ id, value }) =>
                value === 'ellipsis' ? (
                  <PaginationItem key={id}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={id}>
                    <PaginationLink
                      href="#"
                      size="icon"
                      isActive={value === currentPage}
                      onClick={e => {
                        e.preventDefault();
                        onPageChange(value);
                      }}
                    >
                      {value + 1}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  size="default"
                  text={t('admin_table_next')}
                  className={!canNextPage ? 'pointer-events-none opacity-50' : undefined}
                  onClick={e => {
                    e.preventDefault();
                    onNextPage();
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          {refreshButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-muted-foreground">{t('admin_table_summary', { total, selected: selectedCount })}</div>
      <div className="flex items-center gap-2">
        <div ref={loadMoreRef} className="text-sm text-muted-foreground">
          {isFetchingNextPage ? t('core:loading') : loadedCount >= total && total > 0 ? t('admin_table_all_loaded') : ''}
        </div>
        {refreshButton}
      </div>
    </div>
  );
}
