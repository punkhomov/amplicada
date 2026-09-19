import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@amplicada/platform-core/frontend/ui/dialog';
import { ExternalLink } from 'lucide-react';
import type { FilePreviewDialogProps } from '../../contracts/index.js';
import { formatBytes } from '../lib/format.js';
import { openSourceExternal, sourceName, sourceSize } from '../lib/use-resolved-source.js';
import { FilePreview } from './file-preview.js';
import { DEFAULT_LABELS } from './labels.js';

/** Готовый диалог: шапка, поверхность предпросмотра и подвал с «открыть в новой вкладке». */
export function FilePreviewDialog({ open, onOpenChange, title, description, actions, ...preview }: FilePreviewDialogProps) {
  const labels = { ...DEFAULT_LABELS, ...preview.labels };
  const size = sourceSize(preview.source);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{title ?? sourceName(preview.source)}</DialogTitle>
          {(description ?? size) !== undefined && (
            <DialogDescription>{description ?? (size !== undefined ? formatBytes(size) : null)}</DialogDescription>
          )}
        </DialogHeader>
        {/* Высота задана в vh, а не flex-1/min-height: `h-full` у рендерера не резолвится
            против неопределённой высоты flex-элемента и картинка схлопывается в 0. */}
        <div className="h-[70vh] overflow-hidden rounded-md border bg-muted/30">
          <FilePreview {...preview} />
        </div>
        <DialogFooter className="items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => openSourceExternal(preview.source)}>
            <ExternalLink className="size-4" />
            {labels.openExternal}
          </Button>
          {actions}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
