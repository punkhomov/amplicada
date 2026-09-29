import { useApiClient, useQuery, useTranslation } from '@amplicada/platform-core/frontend';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@amplicada/platform-core/frontend/ui/breadcrumb';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@amplicada/platform-core/frontend/ui/dialog';
import { ArrowUp, Folder, LoaderCircle } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { moveBlockReason } from '../lib/move.js';
import { folderTrail, objectName, parentPrefix } from '../lib/paths.js';
import { adminStorageObjectsQueryOptions } from '../lib/queries.js';

export interface StorageMoveDialogProps {
  open: boolean;
  /** Перемещаемые ключи; диалог только показывает их количество. */
  keys: string[];
  onOpenChange: (open: boolean) => void;
  /** Перенос; отклонённый промис диалог показывает строкой ошибки и остаётся открытым. */
  onMove: (destination: string) => Promise<void>;
}

/**
 * Выбор папки назначения: навигатор по листингам, начиная с корня. Сервер сам решает коллизии,
 * а «папка в себя/потомка» известна клиенту заранее — на неё кнопка гаснет с подсказкой.
 */
export function StorageMoveDialog({ open, keys, onOpenChange, onMove }: StorageMoveDialogProps) {
  const { t } = useTranslation('admin');
  const api = useApiClient();
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // Каждое открытие начинается с корня: прошлое назначение не должно «прилипать» к новому выбору.
  useEffect(() => {
    if (!open) return;
    setDestination('');
    setError(null);
  }, [open]);

  const listing = useQuery({ ...adminStorageObjectsQueryOptions(api, destination), enabled: open });

  const blocked = moveBlockReason(keys, destination) === 'inside';
  const trail = folderTrail(destination);

  const go = (next: string) => {
    setError(null);
    setDestination(next);
  };

  const handleMove = async () => {
    setError(null);
    setMoving(true);
    try {
      await onMove(destination);
    } catch {
      setError(t('admin_storage_move_error'));
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin_storage_move_title')}</DialogTitle>
          <DialogDescription>{t('admin_storage_selected_count', { count: keys.length })}</DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-md border">
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Button
              variant="outline"
              size="icon"
              className="size-7 shrink-0"
              disabled={!destination}
              title={t('admin_storage_up')}
              aria-label={t('admin_storage_up')}
              onClick={() => go(parentPrefix(destination))}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {destination ? (
                    <BreadcrumbLink render={<button type="button" onClick={() => go('')} />}>{t('admin_storage_title')}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{t('admin_storage_title')}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {trail.map((segment, index) => {
                  const isLast = index === trail.length - 1;
                  return (
                    <Fragment key={segment.prefix}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        {isLast ? (
                          <BreadcrumbPage>{segment.name}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink render={<button type="button" onClick={() => go(segment.prefix)} />}>
                            {segment.name}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <div className="max-h-56 min-h-24 overflow-y-auto p-1">
            {listing.isLoading ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {t('core:loading')}
              </div>
            ) : (listing.data?.prefixes.length ?? 0) === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">{t('admin_storage_empty_folder_title')}</div>
            ) : (
              listing.data?.prefixes.map(prefix => (
                <button
                  key={prefix}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => go(prefix)}
                >
                  <Folder className="size-4 text-muted-foreground" />
                  <span className="truncate">{objectName(prefix.replace(/\/+$/, ''))}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <DialogFooter className="items-center">
          <div className="mr-auto text-xs">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : blocked ? (
              <span className="text-muted-foreground">{t('admin_storage_move_here_hint')}</span>
            ) : null}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('core:common_cancel')}
          </Button>
          <Button onClick={handleMove} disabled={blocked || moving}>
            {moving && <LoaderCircle className="size-4 animate-spin" />}
            {t('admin_storage_move_here')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
