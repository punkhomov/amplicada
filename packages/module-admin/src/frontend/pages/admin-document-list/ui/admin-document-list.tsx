import type { FilterTree, ListFieldMeta } from '@amplicada/platform-core/contracts';
import { countFilterConditions, EMPTY_FILTER } from '@amplicada/platform-core/contracts';
import {
  type ApiClient,
  cn,
  i18n,
  keepPreviousData,
  QueryError,
  useApiClient,
  useInfiniteQuery,
  useLocalStorage,
  useMutation,
  useQuery,
  useQueryClient,
  useSwipeSelect,
  useTranslation,
} from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@amplicada/platform-core/frontend/ui/context-menu';
import {
  ExtTable,
  ExtTableBody,
  ExtTableCell,
  ExtTableHead,
  ExtTableHeader,
  ExtTableRow,
} from '@amplicada/platform-core/frontend/ui/ext-table';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  type ColumnDef,
  type ColumnResizeMode,
  type ColumnSizingState,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  flexRender,
  type PaginationState,
  type RowSelectionState,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
  type ColumnVisibilityState as VisibilityState,
} from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Params, useNavigate, useParams } from 'react-router-dom';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';
import { AdminColumnManager } from '../../../widgets/admin-column-manager/index.js';
import { AdminFilterDialog } from '../../../widgets/admin-filter-dialog/index.js';
import { AdminTablePagination } from '../../../widgets/admin-table-pagination/index.js';
import { AdminTableToolbar } from '../../../widgets/admin-table-toolbar/index.js';
import { buildListQuery, filtersForType } from '../lib/list-query.js';
import {
  ADMIN_TABLE_SETTINGS_KEY,
  columnOrderForType,
  columnSizingForType,
  columnVisibilityForType,
  DEFAULT_SETTINGS,
  stickyColumnsForType,
  type TableSettings,
} from '../lib/table-settings.js';

interface ListResponse {
  type: { id: string; label: string; creatable: boolean; deletable: boolean };
  columns: Record<string, ListFieldMeta>;
  items: Record<string, unknown>[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface ExportResponse {
  type: { id: string; label: string };
  /** module → key extension'а → поля (см. `DocumentExtension.key`). */
  items: Record<string, Record<string, Record<string, unknown>>>[];
  columns: Record<string, Record<string, Record<string, ListFieldMeta>>>;
}

// TableSettings/DEFAULT_SETTINGS/readAdminTableSettings живут в lib/table-settings.ts: это чистая
// работа с localStorage без React, и её же читает lib/list-query.ts — держать их в ui/ давало
// циклический импорт ui → lib → ui.

/**
 * Опции useInfiniteQuery для первой страницы списка. Общие с route loader'ом (module-admin/index.tsx) —
 * loader читает сохранённые в localStorage сортировку/фильтры/pageSize напрямую (без React), чтобы
 * ensureInfiniteQueryData засеяла тот же queryKey, что построит компонент при монтировании.
 */
export function adminDocumentListInfiniteQueryOptions(
  api: ApiClient,
  params: Params,
  { sorting, pageSize, filters }: { sorting: SortingState; pageSize: number; filters: FilterTree },
) {
  const type = params.type ?? '';
  return {
    queryKey: ['admin', 'documents', type, 'infinite', sorting, pageSize, filters] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      api.get<ListResponse>(`/admin/documents/${type}`, {
        query: buildListQuery({ filters, sorting, page: pageParam, pageSize }),
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage: ListResponse) =>
      lastPage.pagination.page < lastPage.pagination.totalPages ? lastPage.pagination.page + 1 : undefined,
  };
}

/**
 * Опции для режима постраничной пагинации. Вынесены из компонента рядом с infinite-вариантом,
 * чтобы два запроса за одними и теми же данными перестали расходиться в деталях сериализации.
 */
export function adminDocumentListPagesQueryOptions(
  api: ApiClient,
  params: Params,
  { sorting, pagination, filters }: { sorting: SortingState; pagination: PaginationState; filters: FilterTree },
) {
  const type = params.type ?? '';
  return {
    queryKey: ['admin', 'documents', type, 'pages', sorting, pagination, filters] as const,
    queryFn: () =>
      api.get<ListResponse>(`/admin/documents/${type}`, {
        query: buildListQuery({ filters, sorting, page: pagination.pageIndex + 1, pageSize: pagination.pageSize }),
      }),
  };
}

const features = tableFeatures({
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
});

export function AdminDocumentList() {
  const { t } = useTranslation('admin');
  const params = useParams<{ type: string }>();
  const { type } = params;
  if (!type) throw new Error('Missing type route parameter');
  const navigate = useNavigate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  const [filtersDialogOpen, setFiltersDialogOpen] = useState(false);
  const [filters, setFilters] = useState<FilterTree>(EMPTY_FILTER);
  const [settings, setSettings] = useLocalStorage<TableSettings>(ADMIN_TABLE_SETTINGS_KEY, DEFAULT_SETTINGS);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => columnSizingForType(settings, type ?? ''));
  const columnSizingRef = useRef(columnSizing);
  columnSizingRef.current = columnSizing;
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => columnVisibilityForType(settings, type ?? ''));
  const columnVisibilityRef = useRef(columnVisibility);
  columnVisibilityRef.current = columnVisibility;
  const [columnResizeMode] = useState<ColumnResizeMode>('onChange');

  const { paginationMode, pageSize } = settings;

  // Сброс всего per-type view state при смене document type (переход между /admin/:type).
  // Раньше это было 4 отдельных useEffect с зависимостями от settings.columnSizing/columnVisibility/etc —
  // из-за этого resize/toggle колонки на ТЕКУЩЕМ типе (setSettings с новым объектом columnSizing)
  // случайно ретриггерил сброс sorting/rowSelection/pagination. Правим на состояние во время рендера,
  // завязанное только на реальный триггер — смену type.
  const [prevType, setPrevType] = useState(type);
  if (type !== prevType) {
    setPrevType(type);
    setPagination({ pageIndex: 0, pageSize });
    setSorting([]);
    setRowSelection({});
    setColumnVisibility(columnVisibilityForType(settings, type ?? ''));
    setColumnSizing(columnSizingForType(settings, type ?? ''));
    setFilters(filtersForType(settings, type ?? ''));
    setColumnOrder(columnOrderForType(settings, type ?? ''));
  }

  // --- Queries ---

  const infiniteQuery = useInfiniteQuery({
    ...adminDocumentListInfiniteQueryOptions(api, params, { sorting, pageSize, filters }),
    enabled: !!type && paginationMode === 'infinite',
    placeholderData: keepPreviousData,
  });

  const pagesQuery = useQuery({
    ...adminDocumentListPagesQueryOptions(api, params, { sorting, pagination, filters }),
    enabled: !!type && paginationMode === 'pages',
    placeholderData: keepPreviousData,
  });

  const firstPage = infiniteQuery.data?.pages[0];
  const queryData = paginationMode === 'infinite' ? firstPage : pagesQuery.data;
  const items = useMemo(() => {
    if (paginationMode === 'infinite') {
      return infiniteQuery.data?.pages.flatMap((p: ListResponse) => p.items) ?? [];
    }
    return pagesQuery.data?.items ?? [];
  }, [paginationMode, infiniteQuery.data, pagesQuery.data]);

  const totalCount = queryData?.pagination?.total ?? 0;
  const isLoading = paginationMode === 'infinite' ? infiniteQuery.isLoading : pagesQuery.isLoading;
  const isError = paginationMode === 'infinite' ? infiniteQuery.isError : pagesQuery.isError;
  const queryError = paginationMode === 'infinite' ? infiniteQuery.error : pagesQuery.error;
  const refetch = paginationMode === 'infinite' ? infiniteQuery.refetch : pagesQuery.refetch;
  const isFetchingNextPage = paginationMode === 'infinite' ? infiniteQuery.isFetchingNextPage : false;
  const hasNextPage = paginationMode === 'infinite' ? (infiniteQuery.hasNextPage ?? false) : false;
  const fetchNextPage = infiniteQuery.fetchNextPage;

  // --- Mutations ---

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/documents/${type}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'documents', type] });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.delete(`/admin/documents/${type}`, { body: { ids } }),
    onSuccess: (_, ids) => {
      setRowSelection(prev => {
        const next = { ...prev };
        ids.forEach(id => {
          delete next[id];
        });
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'documents', type] });
    },
  });

  // --- Export ---

  const handleExport = async () => {
    if (!type) return;
    const data = await api.get<ExportResponse>(`/admin/documents/${type}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportView = async (format: 'csv' | 'json') => {
    if (!type) return;
    // page/pageSize намеренно не передаются — export-view стримит всю выборку целиком.
    const qs = new URLSearchParams(buildListQuery({ filters, sorting, columns: visibleColumnKeys, format })).toString();
    // Стриминг обязывает идти мимо ApiClient (он читает тело целиком), поэтому Accept-Language
    // проставляем руками — иначе заголовки колонок в выгрузке будут на языке браузера, а не на выбранном.
    const res = await fetch(`${api.baseUrl}/admin/documents/${type}/export-view?${qs}`, {
      credentials: 'include',
      headers: { 'Accept-Language': i18n.resolvedLanguage ?? i18n.language },
    });
    if (!res.ok || !res.body) {
      // Невалидный фильтр теперь 400 — молча ничего не делать здесь хуже, чем сказать что не так.
      const payload = await res.json().catch(() => null);
      alert(payload?.error ?? t('admin_export_failed'));
      return;
    }

    const ext = format === 'csv' ? 'csv' : 'json';
    const mimeType = format === 'csv' ? 'text/csv' : 'application/json';

    // File System Access API (Chrome/Edge) — стрим напрямую на диск
    if ('showSaveFilePicker' in window) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: File System Access API not in TS lib types
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `${type}-export.${ext}`,
          types: [{ description: mimeType, accept: { [mimeType]: [`.${ext}`] } }],
        });
        const writable = await handle.createWritable();
        await res.body.pipeTo(writable);
        return;
      } catch {
        return;
      }
    }

    // Фолбэк: blob download
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Columns ---

  const tableColumns = useMemo<ColumnDef<typeof features, Record<string, unknown>>[]>(() => {
    const cols: ColumnDef<typeof features, Record<string, unknown>>[] = [
      {
        id: 'select',
        size: 32,
        minSize: 32,
        maxSize: 32,
        enableSorting: false,
        enableResizing: false,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
            aria-label={t('admin_list_select_all')}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={value => row.toggleSelected(!!value)}
            aria-label={t('admin_list_select_row')}
          />
        ),
      },
    ];
    const columns = queryData?.columns ?? {};
    for (const [key, meta] of Object.entries(columns)) {
      cols.push({
        id: key,
        accessorKey: key,
        header: meta.label,
        enableSorting: true,
        ...(meta.size !== undefined ? { size: meta.size } : {}),
        ...(meta.minSize !== undefined ? { minSize: meta.minSize } : {}),
      });
    }
    return cols;
    // queryData целиком меняется на каждый рефетч (страница/сортировка/фильтр), а columns metadata
    // стабильна для одного document type — узкая зависимость не пересобирает cell/header-рендеры зря.
  }, [queryData?.columns, t]);

  // --- Column keys ---

  const allColumnKeys = useMemo(() => {
    return Object.keys(queryData?.columns ?? {});
  }, [queryData?.columns]);

  const currentSticky = useMemo(() => stickyColumnsForType(settings, type ?? ''), [settings, type]);

  const orderedColumnKeys = useMemo(() => {
    const left = currentSticky.left.filter(k => allColumnKeys.includes(k));
    const right = currentSticky.right.filter(k => allColumnKeys.includes(k));
    const leftSet = new Set(left);
    const rightSet = new Set(right);

    if (columnOrder.length) {
      const keySet = new Set(allColumnKeys);
      const ordered = columnOrder.filter(k => keySet.has(k) && !leftSet.has(k) && !rightSet.has(k));
      for (const k of allColumnKeys) {
        if (!ordered.includes(k) && !leftSet.has(k) && !rightSet.has(k)) ordered.push(k);
      }
      return [...left, ...ordered, ...right];
    }

    const unpinned = allColumnKeys.filter(k => !leftSet.has(k) && !rightSet.has(k));
    return [...left, ...unpinned, ...right];
  }, [allColumnKeys, columnOrder, currentSticky]);

  const unpinnedKeys = useMemo(() => {
    const leftSet = new Set(currentSticky.left);
    const rightSet = new Set(currentSticky.right);
    return orderedColumnKeys.filter(k => !leftSet.has(k) && !rightSet.has(k));
  }, [orderedColumnKeys, currentSticky]);

  const visibleColumnKeys = useMemo(
    () => orderedColumnKeys.filter(k => columnVisibility[k] !== false),
    [orderedColumnKeys, columnVisibility],
  );

  // --- Pin handlers ---

  const handlePinLeft = useCallback(
    (columnId: string) => {
      setSettings(s => {
        const current = s.stickyColumns?.[type ?? ''] ?? { left: [], right: [] };
        return {
          ...s,
          stickyColumns: {
            ...s.stickyColumns,
            [type ?? '']: {
              left: [...current.left.filter(id => id !== columnId), columnId],
              right: current.right.filter(id => id !== columnId),
            },
          },
        };
      });
    },
    [type, setSettings],
  );

  const handlePinRight = useCallback(
    (columnId: string) => {
      setSettings(s => {
        const current = s.stickyColumns?.[type ?? ''] ?? { left: [], right: [] };
        return {
          ...s,
          stickyColumns: {
            ...s.stickyColumns,
            [type ?? '']: {
              left: current.left.filter(id => id !== columnId),
              right: [...current.right.filter(id => id !== columnId), columnId],
            },
          },
        };
      });
    },
    [type, setSettings],
  );

  const handleUnpin = useCallback(
    (columnId: string) => {
      setSettings(s => {
        const current = s.stickyColumns?.[type ?? ''] ?? { left: [], right: [] };
        return {
          ...s,
          stickyColumns: {
            ...s.stickyColumns,
            [type ?? '']: {
              left: current.left.filter(id => id !== columnId),
              right: current.right.filter(id => id !== columnId),
            },
          },
        };
      });
    },
    [type, setSettings],
  );

  // --- Table ---

  const tableState = useMemo(
    () => ({
      sorting,
      ...(paginationMode === 'pages' ? { pagination } : {}),
      rowSelection,
      columnVisibility,
      columnSizing,
      ...(columnOrder.length > 0 || currentSticky.left.length > 0 || currentSticky.right.length > 0
        ? { columnOrder: ['select', ...orderedColumnKeys] }
        : {}),
    }),
    [
      sorting,
      paginationMode,
      pagination,
      rowSelection,
      columnVisibility,
      columnSizing,
      columnOrder,
      orderedColumnKeys,
      currentSticky.left.length,
      currentSticky.right.length,
    ],
  );

  const table = useTable({
    features,
    data: items,
    columns: tableColumns,
    columnResizeMode,
    defaultColumn: { size: 120, minSize: 36, maxSize: 600 },
    state: tableState,
    onSortingChange: setSorting,
    ...(paginationMode === 'pages' ? { onPaginationChange: setPagination } : {}),
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: updater => {
      const next = typeof updater === 'function' ? updater(columnVisibilityRef.current) : updater;
      columnVisibilityRef.current = next;
      setColumnVisibility(next);
      setSettings(s => ({
        ...s,
        columnVisibility: { ...s.columnVisibility, [type ?? '']: next },
      }));
    },
    onColumnSizingChange: updater => {
      const next = typeof updater === 'function' ? updater(columnSizingRef.current) : updater;
      columnSizingRef.current = next;
      setColumnSizing(next);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        setSettings(s => ({
          ...s,
          columnSizing: { ...s.columnSizing, [type ?? '']: next },
        }));
      }, 500);
    },
    getRowId: row => String(row.id ?? ''),
    ...(paginationMode === 'pages'
      ? { manualPagination: true, manualSorting: true, pageCount: queryData?.pagination?.totalPages ?? 0 }
      : {}),
  });

  const rows = table.getRowModel().rows;

  // --- Infinite scroll observer ---

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // --- Swipe select ---

  useSwipeSelect({
    containerRef: tableContainerRef,
    onToggle: (id: string, checked: boolean) => {
      setRowSelection(prev => {
        if (checked) return prev[id] === true ? prev : { ...prev, [id]: true };
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
  });

  useEffect(() => {
    if (paginationMode !== 'infinite') return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [paginationMode, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // --- Actions ---

  const openItem = (id: string) => navigate(`/admin/${type}/${id}`);
  const handleDeleteOne = (id: string) => {
    if (!confirm(t('admin_list_confirm_delete_one'))) return;
    deleteMutation.mutate(id);
  };
  const handleDeleteSelected = () => {
    const ids = Object.keys(rowSelection);
    if (ids.length === 0) return;
    if (!confirm(t('admin_list_confirm_delete_many', { count: ids.length }))) return;
    batchDeleteMutation.mutate(ids);
  };

  // --- DnD ---

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = unpinnedKeys.indexOf(String(active.id));
      const newIndex = unpinnedKeys.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      const newUnpinned = arrayMove(unpinnedKeys, oldIndex, newIndex);
      setColumnOrder(newUnpinned);
      setSettings(s => ({
        ...s,
        columnOrders: { ...s.columnOrders, [type ?? '']: newUnpinned },
      }));
    },
    [unpinnedKeys, type, setSettings],
  );

  // --- Table header (shared) ---

  const getStickySide = useCallback(
    (columnId: string): 'left' | 'right' | undefined => {
      if (columnId === 'select') return 'left';
      if (currentSticky.left.includes(columnId)) return 'left';
      if (currentSticky.right.includes(columnId)) return 'right';
      return undefined;
    },
    [currentSticky],
  );

  // --- Column labels ---

  const columnLabels = useMemo(() => {
    const result: Record<string, string> = {};
    if (queryData?.columns) {
      for (const [key, meta] of Object.entries(queryData.columns)) {
        result[key] = meta.label;
      }
    }
    return result;
  }, [queryData?.columns]);

  const hasSelection = Object.keys(rowSelection).length > 0;
  const creatable = queryData?.type.creatable ?? true;
  const deletable = queryData?.type.deletable ?? true;

  // --- Row renderer ---

  const renderRow = (row: (typeof rows)[number]) => (
    <ContextMenu key={row.id}>
      <ContextMenuTrigger
        render={
          <ExtTableRow
            data-swipe-item={row.id}
            data-swipe-checked={row.getIsSelected() ? 'true' : 'false'}
            data-state={row.getIsSelected() ? 'selected' : undefined}
            className="cursor-pointer"
            onClick={() => openItem(row.id)}
          />
        }
      >
        {row.getVisibleCells().map(cell => (
          <ExtTableCell
            key={cell.id}
            sticky={getStickySide(cell.column.id)}
            onClick={cell.column.id === 'select' ? (e: React.MouseEvent) => e.stopPropagation() : undefined}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </ExtTableCell>
        ))}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => openItem(row.id)}>{t('admin_list_open')}</ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={!deletable}
          title={deletable ? undefined : t('admin_toolbar_delete_disabled')}
          onClick={() => handleDeleteOne(row.id)}
        >
          {deletable ? t('core:common_delete') : t('admin_list_delete_disabled')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  // --- Table header rendering ---

  const tableHeader = (
    <ExtTableHeader sticky>
      {table.getHeaderGroups().map(headerGroup => (
        <ExtTableRow key={headerGroup.id} className="group">
          {headerGroup.headers.map(header => {
            const canSort = header.column.getCanSort();
            const sortDir = header.column.getIsSorted();
            const canResize = header.column.getCanResize();
            const isResizing = header.column.getIsResizing();
            return (
              <ExtTableHead
                key={header.id}
                sticky={getStickySide(header.column.id)}
                style={header.column.id !== 'select' ? { width: header.getSize() } : undefined}
              >
                {header.isPlaceholder ? null : canSort ? (
                  <Button variant="ghost" size="sm" className="px-1 -ml-1" onClick={header.column.getToggleSortingHandler()}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    <span className="ml-1 text-xs">{sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : ''}</span>
                  </Button>
                ) : (
                  flexRender(header.column.columnDef.header, header.getContext())
                )}
                {canResize && (
                  // biome-ignore lint/a11y/noStaticElementInteractions: column resize handle
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className={cn(
                      'absolute right-[0px] top-0 h-full w-[3px] cursor-col-resize touch-none select-none z-10',
                      isResizing ? 'bg-primary' : 'hover:bg-primary/50',
                    )}
                  />
                )}
              </ExtTableHead>
            );
          })}
        </ExtTableRow>
      ))}
    </ExtTableHeader>
  );

  // --- Table body ---

  const tableBody = (
    <ExtTableBody>
      {rows.length ? (
        rows.map(renderRow)
      ) : (
        <ExtTableRow>
          <ExtTableCell colSpan={tableColumns.length} className="h-24 text-center">
            {t('admin_list_empty')}
          </ExtTableCell>
        </ExtTableRow>
      )}
    </ExtTableBody>
  );

  // --- Loading ---

  if (isError) return <QueryError error={queryError} onRetry={() => refetch()} />;
  if (isLoading) return <div className="p-8 text-muted-foreground">{t('core:loading')}</div>;
  if (!queryData) return <div className="p-8 text-muted-foreground">{t('core:not_found')}</div>;

  // --- Render ---

  return (
    <div className="h-full">
      <div className="w-full max-w-screen-2xl mx-auto flex h-full flex-col px-8 py-4 gap-4">
        <div className="shrink-0 flex flex-col gap-4">
          <AdminBreadcrumbs items={[{ label: t('admin_breadcrumb_root'), to: '/admin' }, { label: queryData.type.label }]} />
          <AdminTableToolbar
            type={type}
            creatable={creatable}
            deletable={deletable}
            hasSelection={hasSelection}
            selectedCount={Object.keys(rowSelection).length}
            selectedIds={Object.keys(rowSelection)}
            refreshData={() => queryClient.invalidateQueries({ queryKey: ['admin', 'documents', type] })}
            paginationMode={paginationMode}
            searchQuery=""
            activeFilterCount={countFilterConditions(filters)}
            onCreate={() => navigate(`/admin/${type}/create`)}
            onDeleteSelected={handleDeleteSelected}
            onExport={handleExport}
            onExportView={handleExportView}
            onOpenColumns={() => setColumnsDialogOpen(true)}
            onOpenFilters={() => setFiltersDialogOpen(true)}
            onOpenViews={() => {}}
            onTogglePaginationMode={() =>
              setSettings(s => ({ ...s, paginationMode: s.paginationMode === 'infinite' ? 'pages' : 'infinite' }))
            }
            onSearchChange={() => {}}
          />
        </div>

        <div ref={tableContainerRef} className="overflow-hidden rounded-xl ring-1 ring-foreground/10 flex-1 min-h-0">
          <ExtTable resizable style={{ width: table.getTotalSize() }}>
            {tableHeader}
            {tableBody}
          </ExtTable>
        </div>

        <AdminTablePagination
          paginationMode={paginationMode}
          total={totalCount}
          selectedCount={Object.keys(rowSelection).length}
          currentPage={table.state.pagination.pageIndex}
          totalPages={table.getPageCount()}
          pageSize={pagination.pageSize}
          onPageSizeChange={size => setPagination(p => ({ ...p, pageSize: size, pageIndex: 0 }))}
          onPageChange={page => table.setPageIndex(page)}
          onPreviousPage={() => table.previousPage()}
          onNextPage={() => table.nextPage()}
          canPreviousPage={table.getCanPreviousPage()}
          canNextPage={table.getCanNextPage()}
          loadMoreRef={loadMoreRef}
          isFetchingNextPage={isFetchingNextPage}
          loadedCount={items.length}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ['admin', 'documents', type] })}
        />
      </div>

      <AdminColumnManager
        open={columnsDialogOpen}
        onOpenChange={setColumnsDialogOpen}
        allColumnKeys={allColumnKeys}
        unpinnedKeys={unpinnedKeys}
        currentSticky={currentSticky}
        columnLabels={columnLabels}
        onPinLeft={handlePinLeft}
        onPinRight={handlePinRight}
        onUnpin={handleUnpin}
        onDragEnd={handleDragEnd}
        getColumnVisibility={key => table.getColumn(key)?.getIsVisible() ?? true}
        toggleColumnVisibility={key => table.getColumn(key)?.toggleVisibility()}
      />

      <AdminFilterDialog
        open={filtersDialogOpen}
        onOpenChange={setFiltersDialogOpen}
        columns={queryData.columns}
        filters={filters}
        onApply={next => {
          setFilters(next);
          setPagination(p => ({ ...p, pageIndex: 0 }));
          setSettings(s => ({ ...s, filters: { ...s.filters, [type ?? '']: next } }));
        }}
        onReset={() => {
          setFilters(EMPTY_FILTER);
          setPagination(p => ({ ...p, pageIndex: 0 }));
          setSettings(s => ({ ...s, filters: { ...s.filters, [type ?? '']: EMPTY_FILTER } }));
        }}
      />
    </div>
  );
}
