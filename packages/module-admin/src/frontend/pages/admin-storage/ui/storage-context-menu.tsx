import { useTranslation } from '@amplicada/platform-core/frontend';
import { Download, Eye, FolderInput, FolderPlus, Info, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { StorageEntry } from '../lib/entries.js';

/** Где открылось меню: координаты курсора и строка под ним; `entry: null` — пустое место. */
export interface StorageContextMenuState {
  x: number;
  y: number;
  entry: StorageEntry | null;
}

export interface StorageContextMenuProps {
  state: StorageContextMenuState | null;
  /** Текущий выбор: пункты меню действуют на него, а не только на строку под курсором. */
  selectedKeys: string[];
  onClose: () => void;
  onOpen: (entry: StorageEntry) => void;
  onDownload: () => void;
  onRename: (key: string) => void;
  onMove: () => void;
  onDelete: () => void;
  onProperties: (entry: StorageEntry) => void;
  onCreateFolder: () => void;
  onUpload: () => void;
  onRefresh: () => void;
}

/**
 * Контекстное меню страницы хранилища. Позиционируется по курсору и не использует портал:
 * координаты `fixed`, а вложенные скролл-контейнеры не обрезают `fixed`-потомков без transform.
 */
export function StorageContextMenu(props: StorageContextMenuProps) {
  const { t } = useTranslation('admin');
  const { state, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  // Меню не должно вылезать за экран: после первого замера прижимаем его к краям окна.
  useLayoutEffect(() => {
    if (!state) return;
    const rect = menuRef.current?.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(state.x, window.innerWidth - (rect?.width ?? 0) - margin)),
      top: Math.max(margin, Math.min(state.y, window.innerHeight - (rect?.height ?? 0) - margin)),
    });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // capture + stopPropagation: Esc закрывает меню, а не снимает выбор страницы под ним.
      event.stopPropagation();
      onClose();
    };
    // Скролл любого контейнера уводит строку из-под меню — закрываем (capture ловит и вложенные).
    const onScroll = () => onClose();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  const entry = state.entry;
  const single = props.selectedKeys.length === 1;
  const allFiles = props.selectedKeys.length > 0 && props.selectedKeys.every(key => !key.endsWith('/'));
  const select = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <>
      {/* Клик мимо меню закрывает его; правый клик по подложке не должен открывать браузерное меню. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: невидимая подложка-ловушка кликов, не контрол */}
      <div
        className="fixed inset-0 z-40"
        onMouseDown={onClose}
        onContextMenu={event => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        className="fixed z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        style={{ left: position.left, top: position.top }}
      >
        {entry ? (
          <>
            <MenuItem icon={<Eye />} label={t('admin_storage_open')} disabled={!single} onSelect={select(() => props.onOpen(entry))} />
            <MenuItem icon={<Download />} label={t('admin_storage_download')} disabled={!allFiles} onSelect={select(props.onDownload)} />
            <MenuItem
              icon={<Pencil />}
              label={t('admin_storage_rename')}
              disabled={!single}
              onSelect={select(() => props.onRename(entry.key))}
            />
            <MenuItem
              icon={<FolderInput />}
              label={`${t('admin_storage_move')}…`}
              disabled={props.selectedKeys.length === 0}
              onSelect={select(props.onMove)}
            />
            <MenuItem
              icon={<Trash2 />}
              label={t('admin_storage_delete')}
              disabled={props.selectedKeys.length === 0}
              onSelect={select(props.onDelete)}
            />
            <div className="my-1 h-px bg-border" />
            <MenuItem
              icon={<Info />}
              label={t('admin_storage_properties')}
              disabled={!single}
              onSelect={select(() => props.onProperties(entry))}
            />
          </>
        ) : (
          <>
            <MenuItem icon={<FolderPlus />} label={t('admin_storage_new_folder')} onSelect={select(props.onCreateFolder)} />
            <MenuItem icon={<Upload />} label={t('admin_storage_upload')} onSelect={select(props.onUpload)} />
            <MenuItem icon={<RefreshCw />} label={t('admin_storage_refresh')} onSelect={select(props.onRefresh)} />
          </>
        )}
      </div>
    </>
  );
}

function MenuItem({
  icon,
  label,
  disabled = false,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground"
      onClick={onSelect}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
